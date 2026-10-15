import { App, Modal, Notice } from 'obsidian';
export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; parent.appendChild(node); return node;
}
export function button(parent: HTMLElement, text: string, action: () => unknown | Promise<unknown>, cls = ''): HTMLButtonElement {
  const b = el(parent, 'button', cls, text); b.type = 'button'; b.onclick = () => { Promise.resolve().then(action).catch(error => new Notice(error instanceof Error ? error.message : String(error), 9000)); }; return b;
}
export function input(parent: HTMLElement, placeholder: string, value = '', type = 'text'): HTMLInputElement { const i = el(parent, 'input'); i.type = type; i.placeholder = placeholder; i.value = value; i.setAttribute('aria-label', placeholder); return i; }
export function select(parent: HTMLElement, options: [string, string][], value: string, change: (value: string) => void): HTMLSelectElement {
  const s = el(parent, 'select'); options.forEach(([key, label]) => { const o = el(s, 'option', '', label); o.value = key; }); s.value = value; s.onchange = () => change(s.value); return s;
}
export function empty(parent: HTMLElement, title: string, detail = ''): void { const box = el(parent, 'div', 'gp-empty'); el(box, 'div', 'gp-empty-icon', '◇'); el(box, 'h3', '', title); if (detail) el(box, 'p', 'gp-muted', detail); }
export function date(value: string | number): string { return new Date(value).toLocaleString(); }
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export class PromptModal extends Modal {
  constructor(app: App, private title: string, private fields: { label: string; value?: string; multiline?: boolean }[], private submit: (values: string[]) => Promise<unknown> | unknown) { super(app); }
  onOpen(): void {
    this.titleEl.textContent = this.title; const controls = this.fields.map(field => {
      const label = el(this.contentEl, 'label', 'gp-field'); el(label, 'span', '', field.label);
      const node = field.multiline ? el(label, 'textarea') : el(label, 'input'); node.value = field.value ?? ''; return node;
    });
    const footer = el(this.contentEl, 'div', 'gp-actions'); button(footer, '取消', () => this.close());
    button(footer, '确定', async () => { await this.submit(controls.map(c => c.value)); this.close(); }, 'mod-cta');
    controls[0]?.focus();
  }
}
export class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private detail: string, private submit: () => Promise<unknown> | unknown, private accept = '确认') { super(app); }
  onOpen(): void {
    this.titleEl.textContent = this.title; el(this.contentEl, 'p', 'gp-confirm-detail', this.detail);
    const footer = el(this.contentEl, 'div', 'gp-actions'); button(footer, '取消', () => this.close());
    button(footer, this.accept, async () => { await this.submit(); this.close(); }, 'mod-warning');
  }
}
export function virtualList<T>(parent: HTMLElement, items: T[], height: number, render: (parent: HTMLElement, item: T, index: number) => void, cls = ''): () => void {
  const scroll = el(parent, 'div', 'gp-virtual ' + cls); const spacer = el(scroll, 'div', 'gp-virtual-spacer'); spacer.style.height = `${items.length * height}px`;
  const viewport = el(spacer, 'div', 'gp-virtual-content'); let last = -1; let frame = 0;
  const draw = () => {
    const start = Math.max(0, Math.floor(scroll.scrollTop / height) - 5); const end = Math.min(items.length, start + Math.ceil((scroll.clientHeight || 600) / height) + 12);
    if (start === last && viewport.childElementCount === end - start) return; last = start; viewport.replaceChildren(); viewport.style.top = `${start * height}px`;
    for (let i = start; i < end; i++) { const row = el(viewport, 'div', 'gp-virtual-row'); row.style.height = `${height}px`; render(row, items[i], i); }
  };
  scroll.onscroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  const observer = new ResizeObserver(() => { last = -1; draw(); }); observer.observe(scroll); draw();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); scroll.onscroll = null; };
}
