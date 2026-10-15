import { editorInfoField } from 'obsidian';
import { StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { diffLines } from 'diff';
import type GitPlus from './main';
import { INDEX, type BlameLine } from './types';
import { BlamePopover } from './ui/blame-popover';
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
export function changeLines(before: string, after: string): Map<number, string> {
  const result = new Map<number, string>(); const chunks = diffLines(before, after); let line = 1;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]; const count = chunk.count ?? 0;
    if (chunk.removed) {
      if (chunks[i + 1]?.added) { const add = chunks[++i]; for (let n = 0; n < (add.count ?? 0); n++) result.set(line++, n < count ? 'change' : 'add'); }
      else result.set(Math.max(1, line), 'delete');
    } else if (chunk.added) for (let n = 0; n < count; n++) result.set(line++, 'add');
    else line += count;
  }
  return result;
}
export function editorExtensions(plugin: GitPlus): Extension {
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
        this.head = head; this.schedule();
      }); this.schedule();
    }
    update(update: ViewUpdate): void {
      const path = update.state.field(editorInfoField, false)?.file?.path;
      if (update.docChanged || path !== this.filePath) { this.filePath = path; this.popover.close(); this.blame = []; this.changes.clear(); this.decorations = Decoration.none; this.schedule(); }
      else if (update.selectionSet || update.viewportChanged || update.transactions.some(t => t.effects.some(e => e.is(loaded)))) this.draw();
      this.popover.validate();
    }
    schedule(): void {
      clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), 500);
    }
    async refresh(): Promise<void> {
      const request = ++this.request; const file = this.view.state.field(editorInfoField, false)?.file;
      if (!file || !plugin.git.repo) return; const path = plugin.git.repoPath(file.path); const text = this.view.state.doc.toString();
      if (text.length > 2 * 1024 * 1024) return;
      try {
        const [blame, baseline] = await Promise.all([
          plugin.settings.inlineBlame || plugin.settings.fullBlame ? plugin.controller.blame(path, text) : Promise.resolve([]),
          plugin.settings.gutter ? plugin.git.file(path, INDEX) : Promise.resolve(undefined),
        ]);
        if (!this.alive || request !== this.request || this.view.state.doc.toString() !== text || this.view.state.field(editorInfoField, false)?.file?.path !== file.path) return;
        this.blame = blame; this.changes = baseline ? changeLines(baseline.text, text) : new Map();
        this.view.dispatch({ effects: loaded.of() });
      } catch { if (this.alive && request === this.request) { this.blame = []; this.changes.clear(); this.view.dispatch({ effects: loaded.of() }); } }
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
