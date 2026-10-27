import { Prec, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, lineNumbers } from '@codemirror/view';
import { getChunks, getOriginalDoc } from '@codemirror/merge';
import { Menu, setIcon, setTooltip } from 'obsidian';
import { lineBlocks, type LineBlock, type LineEdit, type LineEdits } from '../git/line-edits';
import type { StagingMode } from '../types';
import { button, el } from './common';

export type LineAction = 'stage' | 'unstage' | 'restore';
const refreshActions = StateEffect.define<void>();
type Side = 'left' | 'right';
interface Row { edit?: LineEdit; actions: LineAction[]; ids?: number[] }

class ActionsMarker extends GutterMarker {
  constructor(private owner: DiffLineActions, private rows: Row[], private disabled: boolean, private selected: string) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof ActionsMarker && this.disabled === other.disabled && this.selected === other.selected && JSON.stringify(this.rows) === JSON.stringify(other.rows); }
  toDOM(): HTMLElement {
    const group = document.createElement('div'); group.className = 'gp-line-action-group';
    for (const { edit, actions, ids } of this.rows) {
      const row = el(group, 'div', 'gp-line-action-row');
      if (edit) {
        row.classList.toggle('is-selected', this.owner.selected.has(edit.id));
        for (const action of actions) {
          const label = ids ? (action === 'stage' ? '暂存此修改块' : action === 'restore' ? '还原此修改块' : '取消暂存此修改块') : (action === 'stage' ? '暂存此处修改' : action === 'restore' ? '还原此处修改' : '取消暂存此处修改');
          const control = button(row, '', () => this.owner.invoke(action, ids ?? [edit.id]), 'gp-line-action gp-' + (ids ? 'block' : 'line') + '-' + action);
          control.dataset.lineEdit = String(edit.id); control.dataset.beforeLine = String(edit.beforeIndex + 1); control.dataset.afterLine = String(edit.afterIndex + 1);
          if (ids) control.dataset.blockEdits = ids.join(',');
          setIcon(control, action === 'stage' ? 'plus' : action === 'restore' ? 'rotate-ccw' : 'minus'); setTooltip(control, label);
          control.disabled = this.disabled;
        }
      }
    }
    return group;
  }
}

export class DiffLineActions {
  readonly selected = new Set<number>();
  private views = new Set<EditorView>();
  private bar: HTMLElement;
  private last?: number;
  private disabled: boolean;
  private alive = true;
  private blocks: LineBlock[];
  constructor(private model: LineEdits, private stageable: 'stage' | 'unstage', parent: HTMLElement, private blocked: () => boolean, public invoke: (action: LineAction, ids: number[]) => unknown, private mode: StagingMode = 'line') {
    this.blocks = lineBlocks(model);
    this.bar = el(parent, 'div', 'gp-line-selection'); this.bar.hidden = true; this.disabled = blocked();
  }
  setMode(mode: StagingMode): void {
    if (this.mode === mode) return;
    this.mode = mode; this.selected.clear(); this.last = undefined; this.refresh();
  }
  private blockRow(block: LineBlock, side: Side, unified: boolean): Row {
    const actions: LineAction[] = this.stageable === 'unstage' ? (side === 'left' || unified ? ['unstage'] : [])
      : unified ? ['restore', 'stage'] : [side === 'left' ? 'restore' : 'stage'];
    return { edit: block.edits[0], ids: block.edits.map(edit => edit.id), actions };
  }
  private marker(rows: Row[]): GutterMarker | null {
    return rows.some(row => row.edit && row.actions.length) ? new ActionsMarker(this, rows, this.disabled, [...this.selected].join(',')) : null;
  }
  private operations(edit: LineEdit, side: Side, unified: boolean, deleted = false): LineAction[] {
    if (this.stageable === 'unstage') return side === 'left' || unified && edit.before === undefined ? ['unstage'] : [];
    if (!unified) return [side === 'left' ? 'restore' : 'stage'];
    return deleted ? ['restore', ...(edit.after === undefined ? ['stage' as const] : [])] : [...(edit.before === undefined ? ['restore' as const] : []), 'stage'];
  }
  extension(side: Side, unified = false): Extension {
    return [Prec.high(gutter({
      class: 'gp-line-actions', renderEmptyElements: true,
      lineMarker: (view, line) => {
        this.views.add(view);
        const index = view.state.doc.lineAt(line.from).number - 1;
        if (this.mode === 'block') return this.marker(this.blocks.filter(block => side === 'left' ? block.beforeCount > 0 && block.beforeIndex === index : block.afterCount > 0 && block.afterIndex === index).map(block => this.blockRow(block, side, unified)));
        const edits = this.model.edits.filter(edit => side === 'left' ? edit.before !== undefined && edit.beforeIndex === index : edit.after !== undefined && edit.afterIndex === index);
        return this.marker(edits.map(edit => ({ edit, actions: this.operations(edit, side, unified) })));
      },
      widgetMarker: (view, _widget, block) => {
        this.views.add(view);
        if (unified) {
          const chunk = getChunks(view.state)?.chunks.find(chunk => chunk.fromB === block.from && chunk.toA > chunk.fromA);
          if (!chunk) return null;
          const original = getOriginalDoc(view.state), first = original.lineAt(chunk.fromA).number - 1;
          const last = original.lineAt(Math.max(chunk.fromA, chunk.endA)).number - 1;
          return this.marker(Array.from({ length: last - first + 1 }, (_, i) => {
            if (this.mode === 'block') {
              const block = this.blocks.find(block => block.beforeIndex === first + i && block.afterCount === 0);
              return block ? this.blockRow(block, 'left', true) : { actions: [] };
            }
            const edit = this.model.edits.find(edit => edit.before !== undefined && edit.beforeIndex === first + i);
            return { edit, actions: edit ? this.operations(edit, 'left', true, true) : [] };
          }));
        }
        const index = view.state.doc.lineAt(block.from).number - 1;
        if (this.mode === 'block') return this.marker(this.blocks.filter(part => side === 'left' ? part.beforeCount === 0 && (part.beforeIndex === index || block.from === view.state.doc.length && part.beforeIndex === index + 1) : part.afterCount === 0 && (part.afterIndex === index || block.from === view.state.doc.length && part.afterIndex === index + 1)).map(part => this.blockRow(part, side, false)));
        const edits = this.model.edits.filter(edit => side === 'left' ? edit.before === undefined && (edit.beforeIndex === index || block.from === view.state.doc.length && edit.beforeIndex === index + 1) : edit.after === undefined && (edit.afterIndex === index || block.from === view.state.doc.length && edit.afterIndex === index + 1));
        return this.marker(edits.map(edit => ({ edit, actions: this.operations(edit, side, false) })));
      },
      lineMarkerChange: update => update.docChanged || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshActions))),
    })), lineNumbers({ domEventHandlers: { mousedown: (view, line, event) => {
      if (this.mode === 'block') return false;
      const index = view.state.doc.lineAt(line.from).number - 1;
      const edit = this.model.edits.find(edit => side === 'left' ? edit.before !== undefined && edit.beforeIndex === index : edit.after !== undefined && edit.afterIndex === index);
      if (!edit || this.blocked()) return false;
      event.preventDefault();
      if ((event as MouseEvent).shiftKey && this.last !== undefined) for (let i = Math.min(this.last, edit.id); i <= Math.max(this.last, edit.id); i++) this.selected.add(i);
      else { if (this.selected.has(edit.id)) this.selected.delete(edit.id); else this.selected.add(edit.id); this.last = edit.id; }
      this.refresh(); return true;
    } } }), EditorView.updateListener.of(update => {
      this.views.add(update.view);
      if (!update.selectionSet || update.docChanged) return;
      queueMicrotask(() => {
        if (!this.alive || this.mode === 'block' || this.blocked()) return;
        const selected = this.fromSelection(update.view, side);
        if (selected.size) { this.selected.clear(); selected.forEach(id => this.selected.add(id)); this.refresh(); }
      });
    }), EditorView.domEventHandlers({
      mouseup: (_event, view) => {
        if (this.mode === 'block' || !unified || this.blocked()) return false;
        const native = view.dom.ownerDocument.getSelection(); if (!native || native.isCollapsed || !native.rangeCount) return false;
        const range = native.getRangeAt(0), selected = this.fromSelection(view, side), original = getOriginalDoc(view.state);
        for (const dom of view.dom.querySelectorAll('.cm-deletedChunk')) {
          if (!range.intersectsNode(dom)) continue;
          const position = view.posAtDOM(dom), chunk = getChunks(view.state)?.chunks.find(chunk => chunk.fromB === position);
          if (!chunk) continue; const first = original.lineAt(chunk.fromA).number - 1;
          Array.from(dom.querySelectorAll('.cm-deletedLine')).forEach((line, index) => {
            if (range.intersectsNode(line)) this.model.edits.filter(edit => edit.before !== undefined && edit.beforeIndex === first + index).forEach(edit => selected.add(edit.id));
          });
        }
        if (selected.size) { this.selected.clear(); selected.forEach(id => this.selected.add(id)); queueMicrotask(() => { if (this.alive) this.refresh(); }); }
        return false;
      },
      contextmenu: event => {
        if (!this.selected.size || this.blocked()) return false;
        const menu = new Menu(); this.menuItems((title, action) => menu.addItem(item => item.setTitle(title).onClick(action)));
        menu.showAtPosition({ x: event.clientX, y: event.clientY }, this.bar.ownerDocument); event.preventDefault(); return true;
      },
    })];
  }
  private fromSelection(view: EditorView, side: Side): Set<number> {
    const ids = new Set<number>();
    for (const range of view.state.selection.ranges) {
      if (range.empty) continue;
      const first = view.state.doc.lineAt(range.from).number - 1, last = view.state.doc.lineAt(Math.max(range.from, range.to - 1)).number - 1;
      this.model.edits.filter(edit => { const index = side === 'left' ? edit.beforeIndex : edit.afterIndex; return (side === 'left' ? edit.before : edit.after) !== undefined && index >= first && index <= last; }).forEach(edit => ids.add(edit.id));
    }
    return ids;
  }
  private menuItems(add: (title: string, action: () => unknown) => unknown): void {
    const ids = [...this.selected];
    if (this.stageable === 'stage') add('还原所选修改', () => this.invoke('restore', ids));
    add(this.stageable === 'stage' ? '暂存所选修改' : '取消暂存所选修改', () => this.invoke(this.stageable!, ids));
  }
  syncDisabled(): void { const next = this.blocked(); if (this.disabled !== next) { this.disabled = next; this.refresh(); } }
  replaceModel(model?: LineEdits): void {
    this.model = model ?? { before: [], after: [], edits: [] }; this.selected.clear(); this.last = undefined;
    this.blocks = lineBlocks(this.model);
    this.disabled = this.blocked(); this.refresh();
  }
  private refresh(): void {
    if (!this.alive) return;
    this.bar.replaceChildren(); this.bar.hidden = this.selected.size === 0;
    if (this.selected.size) {
      el(this.bar, 'span', 'gp-muted', `已选 ${this.selected.size} 处修改`);
      button(this.bar, '清除', () => { this.selected.clear(); this.refresh(); });
      this.menuItems((title, action) => { button(this.bar, title, action).disabled = this.disabled; });
    }
    for (const view of this.views) view.dispatch({ effects: refreshActions.of() });
  }
  destroy(): void { this.alive = false; this.views.clear(); }
}
