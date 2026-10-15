import { setIcon } from 'obsidian';
import type { BlameLine, BlameChange } from '../types';
import { popoverPosition, type Point } from './popover-position';

interface PopoverHost {
  openCommit(hash: string): Promise<void>;
  openHistory(path: string): Promise<void>;
  controller: { lineChange(path: string, blame: BlameLine, contents: string): Promise<BlameChange> };
}
interface BlameTarget { element: HTMLElement; blame: BlameLine; path: string; contents: () => string }
const activeCards = new WeakMap<Document, BlamePopover>();
let nextId = 0;

/** One hover surface per window, independent of CodeMirror's line hover lifetime. */
export class BlamePopover {
  private target?: BlameTarget;
  private pending?: BlameTarget;
  private pointer?: Point;
  private popup?: HTMLElement;
  private overTrigger = false;
  private overCard = false;
  private disposed = false;
  private keyboardFocus = false;
  private openTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private cleanups: (() => void)[] = [];
  private readonly id = `git-plus-blame-${++nextId}`;
  constructor(private host: PopoverHost, private doc: Document) {}

  hover(target: BlameTarget, pointer: Point): void {
    if (this.disposed) return;
    this.overTrigger = true;
    clearTimeout(this.closeTimer);
    if (this.target?.element === target.element && this.popup) return;
    clearTimeout(this.openTimer);
    this.pending = target; this.pointer = pointer;
    this.openTimer = setTimeout(() => {
      const pending = this.pending, point = this.pointer;
      this.pending = undefined;
      if (pending?.element.isConnected && point) this.show(pending, point);
    }, 400);
  }
  move(element: HTMLElement, pointer: Point): void {
    if (this.pending?.element === element) this.pointer = pointer;
  }
  leave(element: HTMLElement, related: EventTarget | null): void {
    if (this.pending?.element === element) { clearTimeout(this.openTimer); this.pending = undefined; }
    if (this.target?.element !== element) return;
    this.overTrigger = false;
    if (this.isInside(this.popup, related)) { this.overCard = true; clearTimeout(this.closeTimer); }
    else this.delayClose();
  }
  focusLeave(related: EventTarget | null): void {
    if (!this.isInside(this.popup, related) && related !== this.target?.element) { this.keyboardFocus = false; this.overTrigger = false; this.delayClose(); }
  }
  validate(): void { if (this.target && !this.target.element.isConnected) this.close(); }

  private isInside(parent: HTMLElement | undefined, target: EventTarget | null): boolean {
    return !!parent && !!target && 'nodeType' in target && parent.contains(target as Node);
  }
  private delayClose(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      const focused = this.doc.activeElement;
      if (!this.overCard && !this.overTrigger && !(this.keyboardFocus && this.isInside(this.popup, focused))) this.close();
    }, 500);
  }
  private node<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const element = this.doc.createElement(tag); element.className = cls;
    if (text !== undefined) element.textContent = text;
    parent.appendChild(element); return element;
  }
  private action(parent: HTMLElement, label: string, icon: string, callback: () => void | Promise<void>, cls = ''): HTMLButtonElement {
    const button = this.node(parent, 'button', cls); button.type = 'button'; button.setAttribute('aria-label', label);
    const glyph = this.node(button, 'span', 'gp-blame-card-icon'); glyph.setAttribute('aria-hidden', 'true'); setIcon(glyph, icon);
    if (label) this.node(button, 'span', '', label);
    button.addEventListener('click', () => {
      Promise.resolve().then(callback).catch(error => {
        const status = parent.closest('.gp-blame-card')?.querySelector<HTMLElement>('.gp-blame-card-feedback');
        if (status) { status.hidden = false; status.textContent = error instanceof Error ? error.message : String(error); }
      });
    }); return button;
  }
  private listen(target: EventTarget, event: string, callback: EventListener, capture = false): void {
    target.addEventListener(event, callback, capture);
    this.cleanups.push(() => target.removeEventListener(event, callback, capture));
  }
  private show(target: BlameTarget, pointer: Point): void {
    if (this.disposed || !target.element.isConnected) return;
    clearTimeout(this.openTimer); clearTimeout(this.closeTimer); this.pending = undefined;
    if (this.target?.element === target.element && this.popup) return;
    activeCards.get(this.doc)?.close(); this.close();
    this.target = target; this.overTrigger = true; activeCards.set(this.doc, this);
    const { blame, path } = target;
    const card = this.node(this.doc.body, 'div', 'gp-blame-card'); this.popup = card;
    card.id = this.id; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', blame.uncommitted ? '此行尚未提交' : '此行的提交信息');
    target.element.setAttribute('aria-describedby', this.id);
    const header = this.node(card, 'div', 'gp-blame-card-header');
    const author = this.node(header, 'div', 'gp-blame-card-author');
    this.node(author, 'span', 'gp-blame-card-avatar', blame.uncommitted ? '·' : Array.from(blame.author)[0] ?? '?');
    this.node(author, 'strong', '', blame.uncommitted ? '未提交的修改' : blame.author);
    const controls = this.node(header, 'div', 'gp-blame-card-controls');
    const closeButton = this.action(controls, '', 'x', () => this.close(true), 'gp-blame-card-close'); closeButton.setAttribute('aria-label', '关闭卡片');
    if (!blame.uncommitted) this.node(card, 'div', 'gp-blame-card-date', new Date(blame.date).toLocaleString());
    this.node(card, 'div', 'gp-blame-card-subject', blame.uncommitted ? '此行内容已修改，还没有对应的提交。' : blame.subject);
    this.node(card, 'div', 'gp-blame-card-context', `${path} · 第 ${blame.line} 行`);
    const preview = this.node(card, 'section', 'gp-blame-card-diff'); preview.setAttribute('aria-label', '此行变更');
    this.node(preview, 'div', 'gp-blame-card-diff-heading', '此行变更');
    this.node(preview, 'div', 'gp-blame-card-diff-loading', '正在读取行差异…'); preview.setAttribute('aria-busy', 'true');
    const actions = this.node(card, 'div', 'gp-blame-card-actions');
    const commit = this.action(actions, '查看提交', 'git-commit-horizontal', async () => { await this.host.openCommit(blame.hash); this.close(); }, 'gp-blame-card-primary'); commit.disabled = blame.uncommitted;
    this.action(actions, '文件历史', 'history', async () => { await this.host.openHistory(path); this.close(); }, 'gp-blame-card-history');
    if (!blame.uncommitted) {
      const copy = this.action(actions, blame.hash.slice(0, 7), 'copy', async () => {
        await this.doc.defaultView!.navigator.clipboard.writeText(blame.hash);
        if (!card.isConnected) return;
        const feedback = card.querySelector<HTMLElement>('.gp-blame-card-feedback')!; feedback.hidden = false; feedback.textContent = '已复制完整 SHA';
      }, 'gp-blame-card-copy'); copy.setAttribute('aria-label', `复制完整提交 SHA：${blame.hash}`);
    }
    const feedback = this.node(card, 'div', 'gp-blame-card-feedback'); feedback.setAttribute('aria-live', 'polite'); feedback.hidden = true;
    const win = this.doc.defaultView!;
    card.style.maxWidth = `${Math.max(1, win.innerWidth - 24)}px`; card.style.maxHeight = `${Math.max(1, win.innerHeight - 24)}px`;
    const position = popoverPosition(pointer, { width: card.offsetWidth, height: card.offsetHeight }, { width: win.innerWidth, height: win.innerHeight });
    card.style.left = `${position.left}px`; card.style.top = `${position.top}px`;
    this.listen(card, 'pointerenter', () => { this.overCard = true; clearTimeout(this.closeTimer); });
    this.listen(card, 'pointerdown', () => { this.keyboardFocus = false; });
    this.listen(card, 'pointerleave', () => { this.overCard = false; this.overTrigger = false; this.delayClose(); });
    this.listen(card, 'focusin', () => clearTimeout(this.closeTimer));
    this.listen(card, 'focusout', event => this.focusLeave((event as FocusEvent).relatedTarget));
    this.listen(this.doc, 'keydown', event => {
      if ((event as KeyboardEvent).key === 'Tab') this.keyboardFocus = true;
      if ((event as KeyboardEvent).key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
    }, true);
    this.listen(this.doc, 'pointerdown', event => { if (!this.isInside(card, event.target) && !this.isInside(target.element, event.target)) this.close(); }, true);
    this.listen(this.doc, 'scroll', event => { if (!this.isInside(card, event.target)) this.close(); }, true);
    this.listen(win, 'resize', () => this.close());
    this.listen(win, 'blur', () => this.close());
    void this.loadChange(card, preview, target);
  }
  private async loadChange(card: HTMLElement, preview: HTMLElement, target: BlameTarget): Promise<void> {
    try {
      const change = await this.host.controller.lineChange(target.path, target.blame, target.contents());
      if (this.popup !== card || !card.isConnected) return;
      preview.replaceChildren(); this.node(preview, 'div', 'gp-blame-card-diff-heading', '此行变更');
      this.node(preview, 'div', 'gp-blame-card-diff-label', change.label);
      const lines = this.node(preview, 'div', 'gp-blame-card-diff-lines');
      for (const row of change.lines) {
        const entry = this.node(lines, 'div', `gp-blame-change gp-blame-change-${row.kind}${row.selected ? ' is-current' : ''}`);
        const prefix = row.kind === 'delete' ? '−' : row.kind === 'add' ? '+' : ' ';
        this.node(entry, 'span', 'gp-blame-change-sign', prefix).setAttribute('aria-hidden', 'true');
        this.node(entry, 'span', 'gp-blame-change-number', String(row.line));
        this.node(entry, 'code', 'gp-blame-change-text', row.text || ' ');
        entry.setAttribute('aria-label', `${row.kind === 'delete' ? '删除' : row.kind === 'add' ? '新增' : '未变化'}，第 ${row.line} 行${row.selected ? '，当前行' : ''}：${row.text}`);
      }
      if (change.notice) this.node(lines, 'div', 'gp-blame-card-diff-notice', change.notice);
      if (change.truncated) this.node(lines, 'div', 'gp-blame-card-diff-notice', '已省略部分内容，可查看提交详情');
      const current = lines.querySelector<HTMLElement>('.is-current');
      if (current) {
        const rowBounds = current.getBoundingClientRect(), listBounds = lines.getBoundingClientRect();
        if (rowBounds.bottom > listBounds.bottom) lines.scrollTop += rowBounds.bottom - listBounds.bottom + 8;
      }
    } catch {
      if (this.popup !== card || !card.isConnected) return;
      preview.replaceChildren(); this.node(preview, 'div', 'gp-blame-card-diff-heading', '此行变更');
      this.node(preview, 'div', 'gp-blame-card-diff-notice', '无法读取行差异，仍可查看提交或文件历史');
    } finally { if (this.popup === card) preview.setAttribute('aria-busy', 'false'); }
  }
  close(restoreFocus = false): void {
    clearTimeout(this.openTimer); clearTimeout(this.closeTimer); this.pending = undefined;
    const element = this.target?.element;
    element?.removeAttribute('aria-describedby');
    this.cleanups.forEach(cleanup => cleanup()); this.cleanups = [];
    this.popup?.remove(); this.popup = undefined; this.target = undefined;
    this.overCard = false; this.overTrigger = false; this.keyboardFocus = false;
    if (activeCards.get(this.doc) === this) activeCards.delete(this.doc);
    if (restoreFocus && element?.isConnected) element.closest('.cm-editor')?.querySelector<HTMLElement>('.cm-content')?.focus({ preventScroll: true });
  }
  dispose(): void { this.disposed = true; this.close(); }
}
