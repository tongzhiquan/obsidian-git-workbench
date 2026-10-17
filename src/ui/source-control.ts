import { ItemView, Menu, Notice, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian';
import type GitPlus from '../main';
import { EMPTY, HEAD, INDEX, WORKTREE, type FileStatus } from '../types';
import { button, ConfirmModal, el, empty, virtualList } from './common';
import { GIT_PLUS_ICON } from './icon';
import { formatCommitMessage } from '../commit-message';
import { statusBadge } from './status';
import { sourceRows, type SourceRow } from './source-tree';
export const SOURCE_CONTROL = 'git-plus-source-control';
export class SourceControlView extends ItemView {
  private unsubscribe?: () => void;
  private disposeList?: () => void;
  private commitMessage = '';
  private focused = false;
  private amend = false;
  private collapsed = new Set<string>();
  private scrollTop = 0;
  constructor(leaf: WorkspaceLeaf, public plugin: GitPlus) { super(leaf); }
  getViewType(): string { return SOURCE_CONTROL; }
  getDisplayText(): string { return 'Git Plus · 源代码管理'; }
  getIcon(): string { return GIT_PLUS_ICON; }
  async onOpen(): Promise<void> {
    this.containerEl.addClass('gp-container');
    this.unsubscribe = this.plugin.controller.subscribe(() => {
      if (!this.focused) this.render();
      else { this.renderFeedback(); this.updateControls(); this.renderFiles(); }
    }); this.render();
  }
  async onClose(): Promise<void> { this.unsubscribe?.(); this.disposeList?.(); }
  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => unknown, cls = ''): HTMLButtonElement {
    const control = button(parent, '', action, `gp-icon-button ${cls}`); setIcon(control, icon); setTooltip(control, label); return control;
  }
  fillBackupMessage(): void {
    const fill = () => {
      this.commitMessage = this.plugin.backupMessage();
      const textarea = this.contentEl.querySelector<HTMLTextAreaElement>('.gp-commit-input');
      if (textarea) { textarea.value = this.commitMessage; this.resizeMessage(textarea); textarea.dispatchEvent(new Event('input')); textarea.focus(); }
    };
    if (this.commitMessage.trim()) new ConfirmModal(this.app, '替换当前提交消息？', '将使用设置中的备份提交消息模板替换已输入的内容，只填入消息，不会暂存或提交文件。', fill, '替换消息').open();
    else fill();
  }
  private resizeMessage(text: HTMLTextAreaElement): void { text.style.height = 'auto'; text.style.height = `${Math.min(96, Math.max(38, text.scrollHeight))}px`; }
  async setLayout(layout: 'tree' | 'list'): Promise<void> {
    this.plugin.settings.sourceControlLayout = layout; this.scrollTop = 0;
    const scroll = this.contentEl.querySelector('.gp-sc-list .gp-virtual'); if (scroll) scroll.scrollTop = 0;
    this.renderFiles(); this.updateLayoutButton(); await this.plugin.persistSettings();
  }
  private updateLayoutButton(): void {
    const control = this.contentEl.querySelector<HTMLButtonElement>('.gp-sc-layout'); if (!control) return;
    const tree = this.plugin.settings.sourceControlLayout === 'tree';
    setIcon(control, tree ? 'list' : 'list-tree'); setTooltip(control, tree ? '以列表形式查看' : '以树形式查看');
  }
  private showCommitMenu(anchor: HTMLElement): void {
    const menu = new Menu(), busy = this.plugin.controller.busy;
    menu.addItem(i => i.setTitle('填入备份消息').setIcon('wand-sparkles').setDisabled(busy).onClick(() => this.fillBackupMessage()));
    menu.addItem(i => i.setTitle('修改上次提交（Amend）').setIcon('git-commit-horizontal').setChecked(this.amend).setDisabled(busy).onClick(() => { this.amend = !this.amend; this.render(); }));
    menu.addItem(i => i.setTitle('Amend 的作用').setIcon('circle-help').onClick(() => this.plugin.previewText('Amend：修改上次提交', '普通提交：新增一条提交记录。\n\nAmend：用当前消息和暂存区内容替换最近一次提交。适合补上漏掉的文件或修正提交消息，提交总数不会增加，但 SHA 会改变。\n\n当前插件会将输入框中的消息作为新提交消息；需要保留原消息时，请填写原消息。\n\n已推送的提交通常不要使用 Amend，因为改写后会与远程历史不同。')));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.right, y: rect.bottom }, anchor.ownerDocument);
  }
  private showViewMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    for (const [layout, title, icon] of [['list', '以列表形式查看', 'list'], ['tree', '以树形式查看', 'list-tree']] as const) menu.addItem(i => i.setTitle(title).setIcon(icon).setChecked(this.plugin.settings.sourceControlLayout === layout).onClick(() => this.setLayout(layout)));
    menu.addItem(i => i.setTitle('全部展开').setIcon('unfold-vertical').onClick(() => { this.collapsed.clear(); this.renderFiles(); }));
    menu.addItem(i => i.setTitle('折叠所有文件夹').setIcon('fold-vertical').onClick(() => {
      for (const row of sourceRows(this.plugin.controller.status?.files ?? [], 'tree', new Set())) if (row.kind === 'folder') this.collapsed.add(row.key);
      this.renderFiles();
    }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('打开 Git Plus 工作台').setIcon(GIT_PLUS_ICON).onClick(() => this.plugin.openWorkbench()));
    menu.addItem(i => i.setTitle('仓库操作…').setIcon('git-branch').onClick(() => this.plugin.repositoryMenu(anchor)));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.right, y: rect.bottom }, anchor.ownerDocument);
  }
  private commit(): void {
    if (this.plugin.controller.busy) return;
    const work = async () => {
      await this.plugin.flushEditors(); await this.plugin.git.commit(formatCommitMessage(this.commitMessage), this.amend); this.commitMessage = ''; this.amend = false;
      const input = this.contentEl.querySelector<HTMLTextAreaElement>('.gp-commit-input'); if (input) { input.value = ''; this.resizeMessage(input); }
    };
    if (this.amend) new ConfirmModal(this.app, '修改最后一次提交？', 'Amend 会生成新的提交 SHA。已推送的提交可能需要额外处理。', () => this.plugin.run('修改提交', work)).open(); else void this.plugin.run('提交', work);
  }
  render(): void {
    this.scrollTop = this.contentEl.querySelector('.gp-sc-list .gp-virtual')?.scrollTop ?? this.scrollTop;
    this.disposeList?.(); this.disposeList = undefined;
    this.contentEl.replaceChildren(); this.contentEl.className = 'view-content gp-source-control'; const c = this.plugin.controller;
    const header = el(this.contentEl, 'div', 'gp-sc-header'); el(header, 'strong', '', '源代码管理');
    this.iconButton(header, 'list', '以列表形式查看', () => this.setLayout(this.plugin.settings.sourceControlLayout === 'tree' ? 'list' : 'tree'), 'gp-sc-layout'); this.updateLayoutButton();
    this.iconButton(header, 'refresh-cw', '刷新仓库', () => c.refresh(), 'gp-sc-refresh').disabled = c.busy;
    const more = this.iconButton(header, 'ellipsis', '更多源代码管理操作', () => this.showViewMenu(more), 'gp-sc-more');
    if (!this.plugin.git.repo) { empty(this.contentEl, '未连接 Git', c.error || '打开工作台初始化仓库'); button(this.contentEl, '打开工作台', () => this.plugin.openWorkbench()); return; }
    const s = c.status, branch = s?.branch === '(detached)' ? s.head.slice(0, 7) : s?.branch ?? '读取中…';
    const repo = el(this.contentEl, 'div', 'gp-sc-repository');
    const branchLabel = el(repo, 'div', 'gp-sc-branch'); setIcon(el(branchLabel, 'span', 'gp-sc-branch-icon'), 'git-branch'); el(branchLabel, 'span', 'gp-sc-branch-name', branch);
    el(branchLabel, 'span', 'gp-sc-tracking', `↑${s?.ahead ?? 0} ↓${s?.behind ?? 0}`);
    setTooltip(branchLabel, `整个仓库：${this.plugin.git.repo.root.replace(/\\/g, '/')}\n分支：${branch}${s?.upstream ? `\n上游：${s.upstream}` : ''}`);
    const network = el(repo, 'div', 'gp-sc-network');
    for (const [key, icon, label] of [['fetch', 'cloud-download', '获取远程变化（Fetch）'], ['pull', 'arrow-down', '拉取，仅快进（Pull）'], ['push', 'arrow-up', '推送（Push）']] as const) this.iconButton(network, icon, label, () => this.plugin.network(key)).disabled = c.busy;
    el(this.contentEl, 'div', 'gp-sc-feedback'); this.renderFeedback();
    const messageBox = el(this.contentEl, 'div', 'gp-sc-message');
    const text = el(messageBox, 'textarea', 'gp-commit-input'); text.rows = 1; text.placeholder = '消息（Ctrl/Cmd+Enter 提交）'; text.setAttribute('aria-label', '提交消息'); text.value = this.commitMessage;
    const template = this.iconButton(messageBox, 'wand-sparkles', '填入备份消息', () => this.fillBackupMessage(), 'gp-fill-backup-message'); template.disabled = c.busy;
    const commitBar = el(this.contentEl, 'div', 'gp-commit-controls');
    const submit = button(commitBar, this.amend ? '修改上次提交' : '提交', () => this.commit(), 'mod-cta gp-submit');
    const commitMenu = this.iconButton(commitBar, 'chevron-down', '提交选项', () => this.showCommitMenu(commitMenu), 'mod-cta gp-commit-menu');
    this.updateControls();
    text.onfocus = () => this.focused = true;
    text.onblur = () => { this.focused = false; };
    text.oninput = () => { this.commitMessage = text.value; this.resizeMessage(text); this.updateControls(); };
    text.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!submit.disabled) this.commit(); } };
    this.resizeMessage(text);
    if (s?.operation) { const banner = el(this.contentEl, 'div', 'gp-operation'); el(banner, 'strong', '', `正在 ${s.operation}`); button(banner, '继续', () => this.plugin.run('继续操作', () => this.plugin.git.continueOperation(s.operation!))); button(banner, '中止', () => new ConfirmModal(this.app, '中止当前操作？', `Git 将中止 ${s.operation}，请先保留手动编辑的结果。`, () => this.plugin.run('中止操作', () => this.plugin.git.continueOperation(s.operation!, true))).open()); }
    el(this.contentEl, 'div', 'gp-sc-list'); this.renderFiles();
  }
  private renderFeedback(): void {
    const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-feedback'); if (!parent) return;
    parent.replaceChildren(); const c = this.plugin.controller;
    if (c.busy || c.error) el(parent, 'p', c.error ? 'gp-error gp-sc-notice' : 'gp-muted gp-sc-notice', c.error || c.message + '…');
    if (c.automationPaused) el(parent, 'p', 'gp-error gp-sc-notice', '自动备份已暂停，在设置中恢复。');
  }
  private updateControls(): void {
    const busy = this.plugin.controller.busy;
    for (const control of this.contentEl.querySelectorAll<HTMLButtonElement>('.gp-sc-network button, .gp-sc-refresh, .gp-fill-backup-message, .gp-commit-menu')) control.disabled = busy;
    const submit = this.contentEl.querySelector<HTMLButtonElement>('.gp-submit');
    if (submit) { submit.disabled = busy || !this.commitMessage.trim(); submit.textContent = this.amend ? '修改上次提交' : '提交'; }
  }
  private toggle(row: SourceRow): void {
    if (this.collapsed.has(row.key)) this.collapsed.delete(row.key); else this.collapsed.add(row.key);
    this.renderFiles();
    Array.from(this.contentEl.querySelectorAll<HTMLButtonElement>('[data-collapse-key]')).find(node => node.dataset.collapseKey === row.key)?.focus();
  }
  private renderFiles(): void {
    const list = this.contentEl.querySelector<HTMLElement>('.gp-sc-list'); if (!list) return;
    this.scrollTop = list.querySelector('.gp-virtual')?.scrollTop ?? this.scrollTop;
    this.disposeList?.(); list.replaceChildren();
    const layout = this.plugin.settings.sourceControlLayout, rows = sourceRows(this.plugin.controller.status?.files ?? [], layout, this.collapsed);
    list.dataset.layout = layout;
    if (!rows.length) { this.disposeList = undefined; empty(list, '工作区干净', '所有变化已提交。'); return; }
    this.disposeList = virtualList(list, rows, 28, (row, data) => {
      row.style.setProperty('--gp-depth', String(data.depth));
      if (data.kind !== 'file') {
        row.classList.add(data.kind === 'group' ? 'gp-group-heading' : 'gp-sc-folder');
        const expanded = !this.collapsed.has(data.key);
        const toggle = button(row, '', () => this.toggle(data), 'gp-sc-toggle');
        toggle.dataset.collapseKey = data.key; toggle.setAttribute('aria-expanded', String(expanded));
        setIcon(el(toggle, 'span', 'gp-sc-chevron'), expanded ? 'chevron-down' : 'chevron-right');
        if (data.kind === 'folder') { row.dataset.folder = data.path; row.dataset.group = data.type; setIcon(el(toggle, 'span', 'gp-sc-folder-icon'), expanded ? 'folder-open' : 'folder'); setTooltip(toggle, data.path); }
        el(toggle, 'span', 'gp-sc-row-name', data.kind === 'group' ? data.title : data.name);
        el(row, 'span', 'gp-sc-count', String(data.files.length));
        if (data.type !== 'conflict') this.iconButton(row, data.type === 'index' ? 'minus' : 'plus', `${data.type === 'index' ? '取消暂存' : '暂存'}${data.kind === 'group' ? '全部' : '此文件夹'}（${data.files.length}）`, () => this.stage(data.files, data.type === 'index'), 'gp-sc-stage').disabled = this.plugin.controller.busy;
        return;
      }
      this.renderFile(row, data);
    });
    const scroll = list.querySelector('.gp-virtual')!;
    scroll.scrollTop = this.scrollTop; scroll.dispatchEvent(new Event('scroll'));
  }
  private renderFile(row: HTMLElement, data: Extract<SourceRow, { kind: 'file' }>): void {
    const { file, type } = data, s = this.plugin.controller.status;
    row.classList.add('gp-sc-file'); row.dataset.path = file.path; row.dataset.group = type;
    const outside = this.plugin.git.vaultPath(file.path) === undefined;
    const open = () => type === 'conflict' ? this.plugin.openConflict(file.path) : this.plugin.openDiff(file.path, type === 'index' ? s?.head === '(initial)' ? EMPTY : HEAD : file.untracked ? EMPTY : INDEX, type === 'index' ? INDEX : WORKTREE, type === 'index' && file.oldPath ? file.oldPath : file.path);
    const link = button(row, '', open, 'gp-file-link'); setIcon(el(link, 'span', 'gp-sc-file-icon'), 'file-text'); el(link, 'span', 'gp-sc-filename', data.name);
    if (this.plugin.settings.sourceControlLayout === 'list' && data.directory) el(link, 'span', 'gp-sc-directory', data.directory);
    setTooltip(link, `${outside ? '当前笔记库外 · ' : ''}${file.path}${file.oldPath ? ` ← ${file.oldPath}` : ''}`);
    if (outside) el(row, 'span', 'gp-outside', '库外'); statusBadge(row, type === 'index' ? file.index : file.worktree, type === 'conflict' || type === 'untracked' ? type : undefined);
    if (type !== 'conflict') this.iconButton(row, type === 'index' ? 'minus' : 'plus', type === 'index' ? '取消暂存' : '暂存', () => this.stage([file], type === 'index'), 'gp-sc-stage').disabled = this.plugin.controller.busy;
    row.oncontextmenu = e => {
      e.preventDefault(); const menu = new Menu(); menu.addItem(i => i.setTitle('查看文件历史').setIcon('history').onClick(() => void this.plugin.openHistory(file.path)));
      if (!outside) menu.addItem(i => i.setTitle('在 Obsidian 打开').onClick(() => void this.plugin.openNote(file.path)));
      if (type === 'worktree' || type === 'untracked') menu.addItem(i => i.setTitle('丢弃工作区修改…').setDisabled(this.plugin.controller.busy).onClick(() => this.plugin.confirmDiscard([file.path]))); menu.showAtMouseEvent(e);
    };
  }
  private stage(files: FileStatus[], unstage: boolean): Promise<unknown> {
    const paths = [...new Set(files.flatMap(f => f.oldPath ? [f.oldPath, f.path] : [f.path]))];
    if (paths.some(path => this.plugin.indexDrafts.has(path) || this.plugin.worktreeDrafts.has(path))) { new Notice('请先保存或放弃这些文件的比较草稿，再调整暂存状态'); return Promise.resolve(); }
    return this.plugin.run(unstage ? '取消暂存' : '暂存', async () => { if (!unstage) await this.plugin.flushEditors(); if (unstage) await this.plugin.git.unstage(paths); else await this.plugin.git.stage(paths); });
  }
}
