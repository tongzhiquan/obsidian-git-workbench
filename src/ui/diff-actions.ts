import { Prec, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter, lineNumbers, type DecorationSet } from '@codemirror/view';
import { getChunks, getOriginalDoc } from '@codemirror/merge';
import { Menu, setIcon, setTooltip } from 'obsidian';
import { lineBlocks, type LineBlock, type LineEdit, type LineEdits } from '../git/line-edits';
import type { StagingMode } from '../types';
import { button, el } from './common';

export type LineAction = 'stage' | 'unstage' | 'restore';
const refreshActions = StateEffect.define<void>();
const refreshBlockRanges = StateEffect.define<void>();
type Side = 'left' | 'right';
type BlockPosition = 'single' | 'start' | 'middle' | 'end';
interface Row { edit?: LineEdit; actions: LineAction[]; ids?: number[]; block?: LineBlock; blockPosition?: BlockPosition }

class ActionsMarker extends GutterMarker {
  constructor(private owner: DiffLineActions, private rows: Row[], private disabled: boolean, private selected: string) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof ActionsMarker && this.disabled === other.disabled && this.selected === other.selected && JSON.stringify(this.rows) === JSON.stringify(other.rows); }
  toDOM(): HTMLElement {
    const group = document.createElement('div'); group.className = 'gp-line-action-group';
    for (const { edit, actions, ids, block, blockPosition } of this.rows) {
      const row = el(group, 'div', 'gp-line-action-row');
      if (blockPosition && block) {
        row.classList.add('gp-block-boundary', `gp-block-${blockPosition}`);
        row.dataset.gpBlockId = String(block.edits[0].id);
      }
      if (edit && actions.length) {
        row.classList.toggle('is-selected', this.owner.selected.has(edit.id));
        for (const action of actions) {
          const actionLabel = action === 'stage' ? (ids ? '暂存此修改块' : '暂存此处修改') : action === 'restore' ? (ids ? '还原此修改块' : '还原此处修改') : (ids ? '取消暂存此修改块' : '取消暂存此处修改');
          const label = ids && block ? `${actionLabel}（${this.owner.blockRangeLabel(block)}）` : actionLabel;
          const control = button(row, '', () => this.owner.invoke(action, ids ?? [edit.id]), 'gp-line-action gp-' + (ids ? 'block' : 'line') + '-' + action);
          control.dataset.lineEdit = String(edit.id); control.dataset.beforeLine = String(edit.beforeIndex + 1); control.dataset.afterLine = String(edit.afterIndex + 1);
          if (ids && block) {
            control.dataset.blockEdits = ids.join(','); control.dataset.blockId = String(edit.id);
            control.setAttribute('aria-label', label);
            control.addEventListener('pointerenter', () => this.owner.setActiveBlock(edit.id));
            control.addEventListener('focus', () => this.owner.setActiveBlock(edit.id));
            const clear = () => queueMicrotask(() => this.owner.clearActiveBlock(edit.id));
            control.addEventListener('pointerleave', clear); control.addEventListener('blur', clear);
          }
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
  private activeBlock?: number;
  constructor(private model: LineEdits, private stageable: 'stage' | 'unstage', parent: HTMLElement, private blocked: () => boolean, public invoke: (action: LineAction, ids: number[]) => unknown, private mode: StagingMode = 'line') {
    this.blocks = lineBlocks(model);
    this.bar = el(parent, 'div', 'gp-line-selection'); this.bar.hidden = true; this.disabled = blocked();
  }
  setMode(mode: StagingMode): void {
    if (this.mode === mode) return;
    this.mode = mode; this.activeBlock = undefined; this.selected.clear(); this.last = undefined; this.refresh();
  }
  blockRangeLabel(block: LineBlock): string {
    const range = (side: string, start: number, count: number, empty: string) => count
      ? `${side}第 ${start + 1} 至 ${start + count} 行`
      : `${side}无修改行（${empty}第 ${start + 1} 行）`;
    return `${range('左侧', block.beforeIndex, block.beforeCount, '插入点')} → ${range('右侧', block.afterIndex, block.afterCount, '删除点')}`;
  }
  setActiveBlock(id?: number, clearIf?: number): void {
    if (clearIf !== undefined && this.activeBlock !== clearIf) return;
    const next = this.mode === 'block' && id !== undefined && this.blocks.some(block => block.edits[0].id === id) ? id : undefined;
    if (this.activeBlock === next) return;
    this.activeBlock = next;
    for (const view of this.views) view.dispatch({ effects: refreshBlockRanges.of() });
  }
  clearActiveBlock(id: number): void {
    for (const view of this.views) {
      const controls = view.dom.querySelectorAll<HTMLButtonElement>(`[data-block-id="${id}"]`);
      if ([...controls].some(control => control.matches(':hover, :focus'))) return;
    }
    this.setActiveBlock(undefined, id);
  }
  decorationsFor(view: EditorView, side: Side): DecorationSet {
    if (this.mode !== 'block') return Decoration.none;
    const decorations = [];
    for (const block of this.blocks) {
      const first = side === 'left' ? block.beforeIndex : block.afterIndex;
      const count = side === 'left' ? block.beforeCount : block.afterCount;
      for (let offset = 0; offset < count; offset++) {
        const index = first + offset;
        if (index < 0 || index >= view.state.doc.lines) continue;
        const classes = ['gp-block-range'];
        if (offset === 0) classes.push('gp-block-range-start');
        if (offset === count - 1) classes.push('gp-block-range-end');
        if (block.edits[0].id === this.activeBlock) classes.push('gp-block-range-hover');
        decorations.push(Decoration.line({ class: classes.join(' ') }).range(view.state.doc.line(index + 1).from));
      }
    }
    return decorations.length ? Decoration.set(decorations, true) : Decoration.none;
  }
  syncBlockRanges(view: EditorView, unified: boolean): void {
    if (!this.alive) return;
    for (const row of view.dom.querySelectorAll<HTMLElement>('.gp-block-boundary')) {
      row.classList.toggle('gp-block-boundary-active', this.mode === 'block' && row.dataset.gpBlockId === String(this.activeBlock));
    }
    if (!unified) return;
    const chunks = getChunks(view.state)?.chunks ?? [], original = getOriginalDoc(view.state);
    for (const widget of view.dom.querySelectorAll<HTMLElement>('.cm-deletedChunk')) {
      const position = view.posAtDOM(widget), chunk = chunks.find(part => part.fromB === position);
      if (!chunk) continue;
      const first = original.lineAt(chunk.fromA).number - 1;
      for (const [offset, line] of [...widget.querySelectorAll<HTMLElement>('.cm-deletedLine')].entries()) {
        const index = first + offset;
        const block = this.mode === 'block' ? this.blocks.find(part => part.beforeCount > 0 && part.beforeIndex <= index && index < part.beforeIndex + part.beforeCount) : undefined;
        line.classList.toggle('gp-block-range', !!block);
        line.classList.toggle('gp-block-range-start', !!block && index === block.beforeIndex);
        line.classList.toggle('gp-block-range-end', !!block && index === block.beforeIndex + block.beforeCount - 1);
        line.classList.toggle('gp-block-range-hover', !!block && block.edits[0].id === this.activeBlock);
        if (block) line.dataset.gpBlockId = String(block.edits[0].id); else delete line.dataset.gpBlockId;
      }
    }
  }
  private blockPosition(block: LineBlock, side: Side, index: number): BlockPosition {
    const first = side === 'left' ? block.beforeIndex : block.afterIndex;
    const count = side === 'left' ? block.beforeCount : block.afterCount;
    return count === 1 ? 'single' : index === first ? 'start' : index === first + count - 1 ? 'end' : 'middle';
  }
  private blockRow(block: LineBlock, side: Side, unified: boolean, position: BlockPosition, allowAction = true): Row {
    const atStart = position === 'single' || position === 'start';
    const actions: LineAction[] = !atStart || !allowAction ? [] : this.stageable === 'unstage' ? (side === 'left' || unified ? ['unstage'] : [])
      : unified ? ['restore', 'stage'] : [side === 'left' ? 'restore' : 'stage'];
    // Unified replacements share one bracket across their old and new rows.
    const boundary = !unified || !block.beforeCount || !block.afterCount ? position
      : side === 'left' ? (position === 'single' ? 'start' : position === 'end' ? 'middle' : position)
      : position === 'single' ? 'end' : position === 'start' ? 'middle' : position;
    return { edit: actions.length ? block.edits[0] : undefined, ids: actions.length ? block.edits.map(edit => edit.id) : undefined, actions, block, blockPosition: boundary };
  }
  private marker(rows: Row[]): GutterMarker | null {
    return rows.some(row => row.blockPosition || row.edit && row.actions.length) ? new ActionsMarker(this, rows, this.disabled, [...this.selected].join(',')) : null;
  }
  private operations(edit: LineEdit, side: Side, unified: boolean, deleted = false): LineAction[] {
    if (this.stageable === 'unstage') return side === 'left' || unified && edit.before === undefined ? ['unstage'] : [];
    if (!unified) return [side === 'left' ? 'restore' : 'stage'];
    return deleted ? ['restore', ...(edit.after === undefined ? ['stage' as const] : [])] : [...(edit.before === undefined ? ['restore' as const] : []), 'stage'];
  }
  extension(side: Side, unified = false): Extension {
    const owner = this;
    const blockRanges = ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = owner.decorationsFor(view, side);
        queueMicrotask(() => owner.syncBlockRanges(view, unified));
      }
      update(update: import('@codemirror/view').ViewUpdate): void {
        if (update.docChanged || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshActions) || effect.is(refreshBlockRanges)))) this.decorations = owner.decorationsFor(update.view, side);
      }
    }, { decorations: value => value.decorations });
    return [blockRanges, Prec.high(gutter({
      class: 'gp-line-actions', renderEmptyElements: true,
      lineMarker: (view, line) => {
        this.views.add(view);
        const index = view.state.doc.lineAt(line.from).number - 1;
        if (this.mode === 'block') {
          const block = this.blocks.find(part => {
            const first = side === 'left' ? part.beforeIndex : part.afterIndex, count = side === 'left' ? part.beforeCount : part.afterCount;
            return count > 0 && index >= first && index < first + count;
          });
          return block ? this.marker([this.blockRow(block, side, unified, this.blockPosition(block, side, index))]) : null;
        }
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
              const index = first + i;
              const block = this.blocks.find(part => part.beforeIndex <= index && index < part.beforeIndex + part.beforeCount);
              return block ? this.blockRow(block, 'left', true, this.blockPosition(block, 'left', index), block.afterCount === 0) : { actions: [] };
            }
            const edit = this.model.edits.find(edit => edit.before !== undefined && edit.beforeIndex === first + i);
            return { edit, actions: edit ? this.operations(edit, 'left', true, true) : [] };
          }));
        }
        const index = view.state.doc.lineAt(block.from).number - 1;
        if (this.mode === 'block') return this.marker(this.blocks.filter(part => side === 'left' ? part.beforeCount === 0 && (part.beforeIndex === index || block.from === view.state.doc.length && part.beforeIndex === index + 1) : part.afterCount === 0 && (part.afterIndex === index || block.from === view.state.doc.length && part.afterIndex === index + 1)).map(part => this.blockRow(part, side, false, 'single')));
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
    }), EditorView.updateListener.of(update => { queueMicrotask(() => this.syncBlockRanges(update.view, unified)); })];
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
    this.model = model ?? { before: [], after: [], edits: [] }; this.activeBlock = undefined; this.selected.clear(); this.last = undefined;
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
