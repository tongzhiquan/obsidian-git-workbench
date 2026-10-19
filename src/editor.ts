import { editorInfoField } from 'obsidian';
import { StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type GitWorkbench from './main';
import { INDEX, type BlameLine } from './types';
import { BlamePopover } from './ui/blame-popover';
import { changeLines } from './editor-changes';
const loaded = StateEffect.define<void>();
class BlameWidget extends WidgetType {
  constructor(private text: string, private line: number, private hash: string) { super(); }
  eq(other: BlameWidget): boolean { return this.text === other.text && this.line === other.line && this.hash === other.hash; }
  toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement('span'); span.className = 'gp-inline-blame'; span.textContent = this.text;
    span.dataset.gpLine = String(this.line); return span;
  }
  ignoreEvent(): boolean { return true; }
}
class ChangeMarker extends GutterMarker {
  constructor(public kind: string) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof ChangeMarker && other.kind === this.kind; }
  toDOM(): HTMLElement { const span = document.createElement('span'); span.className = 'gp-gutter-mark gp-gutter-' + this.kind; span.title = this.kind === 'add' ? '新增行' : this.kind === 'delete' ? '此处删除了行' : '修改行'; return span; }
}
export function editorExtensions(plugin: GitWorkbench): Extension {
  const feature = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    blame: BlameLine[] = [];
    changes = new Map<number, string>();
    private timer?: ReturnType<typeof setTimeout>;
    private request = 0;
    private alive = true;
    private unsubscribe: () => void;
    private readonly popover: BlamePopover;
    private readonly eventCleanups: (() => void)[] = [];
    private filePath?: string;
    private head?: string;
    private baseline?: string;
    private baselineRequest = 0;
    constructor(public view: EditorView) {
      this.filePath = view.state.field(editorInfoField, false)?.file?.path;
      this.head = plugin.controller.status?.head;
      this.popover = new BlamePopover(plugin, view.dom.ownerDocument);
      const target = (event: Event) => {
        const element = event.target as HTMLElement | null;
        const annotation = element?.closest?.<HTMLElement>('.gp-inline-blame');
        const path = this.view.state.field(editorInfoField, false)?.file?.path;
        const blame = annotation ? this.blame[Number(annotation.dataset.gpLine) - 1] : undefined;
        return annotation && blame && path && plugin.git.repo ? { element: annotation, blame, path: plugin.git.repoPath(path), contents: () => this.view.state.doc.toString() } : undefined;
      };
      const listen = (name: string, fn: EventListener) => { view.dom.addEventListener(name, fn); this.eventCleanups.push(() => view.dom.removeEventListener(name, fn)); };
      listen('pointerover', event => { const hit = target(event), e = event as PointerEvent; if (hit && !(e.relatedTarget instanceof view.dom.ownerDocument.defaultView!.Node && hit.element.contains(e.relatedTarget))) this.popover.hover(hit, { x: e.clientX, y: e.clientY }); });
      listen('pointermove', event => { const hit = target(event), e = event as PointerEvent; if (hit) this.popover.move(hit.element, { x: e.clientX, y: e.clientY }); });
      listen('pointerout', event => { const hit = target(event), e = event as PointerEvent; if (hit && !(e.relatedTarget instanceof view.dom.ownerDocument.defaultView!.Node && hit.element.contains(e.relatedTarget))) this.popover.leave(hit.element, e.relatedTarget); });
      this.unsubscribe = plugin.controller.subscribe(() => {
        const head = plugin.controller.status?.head;
        if (head !== this.head || !plugin.settings.inlineBlame && !plugin.settings.fullBlame) this.popover.close();
        this.head = head; void this.refreshBaseline(); this.schedule();
      }); void this.refreshBaseline(); this.schedule();
    }
    update(update: ViewUpdate): void {
      const path = update.state.field(editorInfoField, false)?.file?.path;
      if (update.docChanged || path !== this.filePath) {
        const changedFile = path !== this.filePath;
        this.filePath = path; this.request++; this.popover.close(); this.blame = []; this.decorations = Decoration.none;
        if (changedFile) { this.baseline = undefined; this.changes.clear(); void this.refreshBaseline(); }
        this.updateChanges(); this.schedule();
      }
      else if (update.selectionSet || update.viewportChanged || update.transactions.some(t => t.effects.some(e => e.is(loaded)))) this.draw();
      this.popover.validate();
    }
    schedule(): void {
      clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), 500);
    }
    updateChanges(): void {
      const text = this.view.state.doc.toString();
      this.changes = plugin.settings.gutter && this.baseline !== undefined && text.length <= 2 * 1024 * 1024 ? changeLines(this.baseline, text) : new Map();
    }
    async refreshBaseline(): Promise<void> {
      const request = ++this.baselineRequest, file = this.view.state.field(editorInfoField, false)?.file;
      if (!file || !plugin.git.repo || !plugin.settings.gutter) {
        this.baseline = undefined; this.changes.clear();
        queueMicrotask(() => { if (this.alive) this.view.dispatch({ effects: loaded.of() }); });
        return;
      }
      try {
        const content = await plugin.git.file(plugin.git.repoPath(file.path), INDEX);
        if (!this.alive || request !== this.baselineRequest || this.view.state.field(editorInfoField, false)?.file?.path !== file.path) return;
        this.baseline = content.binary || content.large ? undefined : content.text;
        this.updateChanges(); this.view.dispatch({ effects: loaded.of() });
      } catch { /* Retain the last known index while another Git operation holds a lock. */ }
    }
    async refresh(): Promise<void> {
      const request = ++this.request; const file = this.view.state.field(editorInfoField, false)?.file;
      if (!file || !plugin.git.repo) return; const path = plugin.git.repoPath(file.path); const text = this.view.state.doc.toString();
      if (text.length > 2 * 1024 * 1024) return;
      try {
        const blame = plugin.settings.inlineBlame || plugin.settings.fullBlame ? await plugin.controller.blame(path, text) : [];
        if (!this.alive || request !== this.request || this.view.state.doc.toString() !== text || this.view.state.field(editorInfoField, false)?.file?.path !== file.path) return;
        this.blame = blame;
        this.view.dispatch({ effects: loaded.of() });
      } catch { if (this.alive && request === this.request) { this.blame = []; this.view.dispatch({ effects: loaded.of() }); } }
    }
    draw(): void {
      const ranges: ReturnType<Decoration['range']>[] = []; const current = this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
      if (plugin.settings.inlineBlame || plugin.settings.fullBlame) {
        for (const viewport of this.view.visibleRanges) {
          const first = this.view.state.doc.lineAt(viewport.from).number, last = this.view.state.doc.lineAt(viewport.to).number;
          for (let n = first; n <= last; n++) {
            if (!plugin.settings.fullBlame && n !== current) continue;
            const line = this.view.state.doc.line(n); const blame = this.blame[n - 1]; if (!blame) continue;
            const label = blame.uncommitted ? '未提交的修改' : `${blame.author} · ${new Date(blame.date).toLocaleDateString()} · ${blame.subject}`;
            ranges.push(Decoration.widget({ widget: new BlameWidget(label, n, blame.hash), side: 1 }).range(line.to));
          }
        }
      }
      this.decorations = Decoration.set(ranges, true);
    }
    destroy(): void { this.alive = false; this.request++; clearTimeout(this.timer); this.unsubscribe(); this.eventCleanups.forEach(cleanup => cleanup()); this.popover.dispose(); }
  }, { decorations: value => value.decorations });
  return [feature, gutter({
    class: 'gp-change-gutter',
    lineMarker: (view, line) => { if (!plugin.settings.gutter) return null; const number = view.state.doc.lineAt(line.from).number; const kind = view.plugin(feature)?.changes.get(number); return kind ? new ChangeMarker(kind) : null; },
    lineMarkerChange: update => update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(loaded))),
    initialSpacer: () => new ChangeMarker('spacer'),
  })];
}
