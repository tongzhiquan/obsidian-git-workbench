import { ItemView, Menu, Notice, setIcon, setTooltip, TFile, type WorkspaceLeaf } from 'obsidian';
import type GitWorkbench from '../main';
import { EMPTY, HEAD, INDEX, WORKTREE, type FileStatus, type Operation } from '../types';
import { button, ConfirmModal, el, empty, virtualList } from './common';
import { GIT_WORKBENCH_ICON } from './icon';
import { formatCommitMessage } from '../commit-message';
import { statusBadge } from './status';
import { scopedSourceFiles, sourcePaths, sourceRows, type SourceRow } from './source-tree';
export const SOURCE_CONTROL = 'git-workbench-source-control';
export class SourceControlView extends ItemView {
  private unsubscribe?: () => void;
  private disposeList?: () => void;
  private commitMessage = '';
  private connected?: boolean;
  private filesKey?: string;
  private feedbackKey?: string;
  private operation?: Operation;
  private amend = false;
  private collapsed = new Set<string>();
  private scrollTop = 0;
  constructor(leaf: WorkspaceLeaf, public plugin: GitWorkbench) { super(leaf); }
  getViewType(): string { return SOURCE_CONTROL; }
  getDisplayText(): string { return 'Git Workbench · 源代码管理'; }
  getIcon(): string { return GIT_WORKBENCH_ICON; }
  async onOpen(): Promise<void> {
    this.containerEl.addClass('gp-container');
    this.unsubscribe = this.plugin.controller.subscribe(() => this.render()); this.render();
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
  async generateAiMessage(): Promise<void> {
    if (this.plugin.controller.busy) return;
    const message = await this.plugin.generateAiCommitMessage();
    if (message === undefined) return;
    this.commitMessage = message;
    const textarea = this.contentEl.querySelector<HTMLTextAreaElement>('.gp-commit-input');
    if (textarea) { textarea.value = message; this.resizeMessage(textarea); textarea.dispatchEvent(new Event('input')); textarea.focus(); }
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
    for (const selector of ['.gp-sc-collapse', '.gp-sc-expand']) {
      const action = this.contentEl.querySelector<HTMLButtonElement>(selector); if (action) action.disabled = !tree;
    }
  }
  private visibleFiles(): FileStatus[] {
    return scopedSourceFiles(this.plugin.controller.status?.files ?? [], this.plugin.git.repo?.vaultPrefix ?? '', this.plugin.settings.sourceControlVaultOnly);
  }
  async setVaultOnly(value: boolean): Promise<void> {
    this.plugin.settings.sourceControlVaultOnly = value; this.scrollTop = 0;
    const scroll = this.contentEl.querySelector('.gp-sc-list .gp-virtual'); if (scroll) scroll.scrollTop = 0;
    this.renderFiles(); this.updateFilterButton(); await this.plugin.persistSettings();
  }
  private updateFilterButton(): void {
    const control = this.contentEl.querySelector<HTMLButtonElement>('.gp-sc-filter'); if (!control) return;
    const active = this.plugin.settings.sourceControlVaultOnly;
    control.setAttribute('aria-pressed', String(active)); control.classList.toggle('is-active', active);
    setTooltip(control, active ? '仅显示当前笔记库的变更（已开启）' : '仅显示当前笔记库的变更');
  }
  private showCommitMenu(anchor: HTMLElement): void {
    const menu = new Menu(), busy = this.plugin.controller.busy;
    menu.addItem(i => i.setTitle('填入当前时间备份消息').setIcon('calendar-clock').setDisabled(busy).onClick(() => this.fillBackupMessage()));
    menu.addItem(i => i.setTitle('修改上次提交（Amend）').setIcon('git-commit-horizontal').setChecked(this.amend).setDisabled(busy).onClick(() => { this.amend = !this.amend; this.render(); }));
    menu.addItem(i => i.setTitle('Amend 的作用').setIcon('circle-help').onClick(() => this.plugin.previewText('Amend：修改上次提交', '普通提交：新增一条提交记录。\n\nAmend：用当前消息和暂存区内容替换最近一次提交。适合补上漏掉的文件或修正提交消息，提交总数不会增加，但 SHA 会改变。\n\n当前插件会将输入框中的消息作为新提交消息；需要保留原消息时，请填写原消息。\n\n已推送的提交通常不要使用 Amend，因为改写后会与远程历史不同。')));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.right, y: rect.bottom }, anchor.ownerDocument);
  }
  private showViewMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    for (const [layout, title, icon] of [['list', '以列表形式查看', 'list'], ['tree', '以树形式查看', 'list-tree']] as const) menu.addItem(i => i.setTitle(title).setIcon(icon).setChecked(this.plugin.settings.sourceControlLayout === layout).onClick(() => this.setLayout(layout)));
    menu.addItem(i => i.setTitle('仅显示当前笔记库的变更').setIcon('filter').setChecked(this.plugin.settings.sourceControlVaultOnly).onClick(() => this.setVaultOnly(!this.plugin.settings.sourceControlVaultOnly)));
    menu.addItem(i => i.setTitle('全部展开').setIcon('chevrons-up-down').onClick(() => this.expandAll()));
    menu.addItem(i => i.setTitle('折叠所有文件夹').setIcon('chevrons-down-up').onClick(() => this.collapseAll()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('打开 Git Workbench 工作台').setIcon(GIT_WORKBENCH_ICON).onClick(() => this.plugin.openWorkbench()));
    menu.addItem(i => i.setTitle('仓库操作…').setIcon('git-branch').onClick(() => this.plugin.repositoryMenu(anchor)));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.right, y: rect.bottom }, anchor.ownerDocument);
  }
  private expandAll(): void { this.collapsed.clear(); this.renderFiles(); }
  private collapseAll(): void {
    for (const row of sourceRows(this.visibleFiles(), 'tree', new Set())) if (row.kind === 'folder') this.collapsed.add(row.key);
    this.renderFiles();
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
    const connected = !!this.plugin.git.repo;
    if (this.connected === connected && this.contentEl.querySelector('.gp-sc-header')) { this.update(); return; }
    this.connected = connected; this.filesKey = undefined; this.feedbackKey = undefined; this.operation = undefined;
    this.scrollTop = this.contentEl.querySelector('.gp-sc-list .gp-virtual')?.scrollTop ?? this.scrollTop;
    this.disposeList?.(); this.disposeList = undefined;
    this.contentEl.replaceChildren(); this.contentEl.className = 'view-content gp-source-control'; const c = this.plugin.controller;
    const header = el(this.contentEl, 'div', 'gp-sc-header'); el(header, 'strong', '', '源代码管理');
    this.iconButton(header, 'list', '以列表形式查看', () => this.setLayout(this.plugin.settings.sourceControlLayout === 'tree' ? 'list' : 'tree'), 'gp-sc-layout');
    this.iconButton(header, 'chevrons-down-up', '折叠所有文件夹', () => this.collapseAll(), 'gp-sc-collapse');
    this.iconButton(header, 'chevrons-up-down', '全部展开', () => this.expandAll(), 'gp-sc-expand');
    this.updateLayoutButton();
    this.iconButton(header, 'refresh-cw', '刷新仓库', () => c.refresh(), 'gp-sc-refresh').disabled = c.busy;
    this.iconButton(header, 'filter', '仅显示当前笔记库的变更', () => this.setVaultOnly(!this.plugin.settings.sourceControlVaultOnly), 'gp-sc-filter'); this.updateFilterButton();
    this.iconButton(header, GIT_WORKBENCH_ICON, '打开 Git Workbench 工作台', () => this.plugin.openWorkbench(), 'gp-sc-workbench');
    const more = this.iconButton(header, 'ellipsis', '更多源代码管理操作', () => this.showViewMenu(more), 'gp-sc-more');
    if (!connected) { el(this.contentEl, 'div', 'gp-sc-disconnected'); this.update(); return; }
    const repo = el(this.contentEl, 'div', 'gp-sc-repository');
    const branchLabel = el(repo, 'div', 'gp-sc-branch'); setIcon(el(branchLabel, 'span', 'gp-sc-branch-icon'), 'git-branch'); el(branchLabel, 'span', 'gp-sc-branch-name');
    el(branchLabel, 'span', 'gp-sc-tracking');
    const network = el(repo, 'div', 'gp-sc-network');
    for (const [key, icon, label] of [['fetch', 'cloud-download', '获取远程变化（Fetch）'], ['pull', 'arrow-down', '拉取，仅快进（Pull）'], ['push', 'arrow-up', '推送（Push）']] as const) this.iconButton(network, icon, label, () => this.plugin.network(key)).disabled = c.busy;
    el(this.contentEl, 'div', 'gp-sc-feedback');
    const messageBox = el(this.contentEl, 'div', 'gp-sc-message');
    const text = el(messageBox, 'textarea', 'gp-commit-input'); text.rows = 1; text.placeholder = '消息（Ctrl/Cmd+Enter 提交）'; text.setAttribute('aria-label', '提交消息'); text.value = this.commitMessage;
    const ai = this.iconButton(messageBox, 'wand-sparkles', '使用 AI 生成提交消息', () => void this.generateAiMessage(), 'gp-generate-ai-message'); ai.disabled = c.busy;
    const commitBar = el(this.contentEl, 'div', 'gp-commit-controls');
    const submit = button(commitBar, this.amend ? '修改上次提交' : '提交', () => this.commit(), 'mod-cta gp-submit');
    const commitMenu = this.iconButton(commitBar, 'chevron-down', '提交选项', () => this.showCommitMenu(commitMenu), 'mod-cta gp-commit-menu');
    text.oninput = () => { this.commitMessage = text.value; this.resizeMessage(text); this.updateControls(); };
    text.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!submit.disabled) this.commit(); } };
    this.resizeMessage(text);
    el(this.contentEl, 'div', 'gp-sc-operation'); el(this.contentEl, 'div', 'gp-sc-list'); this.update();
  }
  private update(): void {
    const c = this.plugin.controller, s = c.status;
    if (!this.plugin.git.repo) {
      const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-disconnected'), detail = c.error || '打开工作台初始化仓库';
      if (parent && parent.dataset.detail !== detail) { parent.dataset.detail = detail; parent.replaceChildren(); empty(parent, '未连接 Git', detail); button(parent, '打开工作台', () => this.plugin.openWorkbench()); }
      this.updateControls(); return;
    }
    const branch = s?.branch === '(detached)' ? s.head.slice(0, 7) : s?.branch ?? '读取中…';
    const label = this.contentEl.querySelector<HTMLElement>('.gp-sc-branch')!;
    const name = label.querySelector('.gp-sc-branch-name')!, tracking = label.querySelector('.gp-sc-tracking')!, counts = `↑${s?.ahead ?? 0} ↓${s?.behind ?? 0}`;
    if (name.textContent !== branch) name.textContent = branch;
    if (tracking.textContent !== counts) tracking.textContent = counts;
    const tooltip = `整个仓库：${this.plugin.git.repo.root.replace(/\\/g, '/')}\n分支：${branch}${s?.upstream ? `\n上游：${s.upstream}` : ''}`;
    if (label.getAttribute('aria-label') !== tooltip) setTooltip(label, tooltip);
    const operation = s?.operation;
    if (operation !== this.operation) {
      this.operation = operation;
      const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-operation')!; parent.replaceChildren();
      if (operation) {
        const banner = el(parent, 'div', 'gp-operation'); el(banner, 'strong', '', `正在 ${operation}`);
        button(banner, '继续', () => this.plugin.run('继续操作', () => this.plugin.git.continueOperation(operation)));
        button(banner, '中止', () => new ConfirmModal(this.app, '中止当前操作？', `Git 将中止 ${operation}，请先保留手动编辑的结果。`, () => this.plugin.run('中止操作', () => this.plugin.git.continueOperation(operation, true))).open());
      }
    }
    this.renderFeedback(); this.renderFiles(); this.updateControls();
  }
  private renderFeedback(): void {
    const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-feedback'); if (!parent) return;
    const c = this.plugin.controller, key = JSON.stringify([c.busy, c.error, c.message, c.automationPaused, this.plugin.settings.autoBackup]);
    if (this.feedbackKey === key) return; this.feedbackKey = key; parent.replaceChildren();
    if (c.busy || c.error) el(parent, 'p', c.error ? 'gp-error gp-sc-notice' : 'gp-muted gp-sc-notice', c.error || c.message + '…');
    if (this.plugin.settings.autoBackup && c.automationPaused) el(parent, 'p', 'gp-error gp-sc-notice', '自动备份因错误暂停，请在设置中处理错误并解除暂停。');
  }
  private updateControls(): void {
    const busy = this.plugin.controller.busy;
    for (const control of this.contentEl.querySelectorAll<HTMLButtonElement>('.gp-sc-network button, .gp-sc-refresh, .gp-generate-ai-message, .gp-commit-menu, .gp-sc-stage, .gp-sc-operation button')) control.disabled = busy;
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
    const layout = this.plugin.settings.sourceControlLayout, files = this.visibleFiles();
    const key = JSON.stringify([layout, this.plugin.settings.sourceControlVaultOnly, this.plugin.git.repo?.vaultPrefix, files, [...this.collapsed].sort()]);
    if (this.filesKey === key) return; this.filesKey = key;
    this.scrollTop = list.querySelector('.gp-virtual')?.scrollTop ?? this.scrollTop;
    this.disposeList?.(); list.replaceChildren();
    const rows = sourceRows(files, layout, this.collapsed);
    list.dataset.layout = layout;
    list.dataset.scope = this.plugin.settings.sourceControlVaultOnly ? 'vault' : 'repository';
    if (!rows.length) { this.disposeList = undefined; empty(list, this.plugin.settings.sourceControlVaultOnly ? '当前笔记库没有变更' : '工作区干净', this.plugin.settings.sourceControlVaultOnly ? '可关闭过滤查看整个仓库。' : '所有变化已提交。'); return; }
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
    const { file, type } = data;
    row.classList.add('gp-sc-file'); row.dataset.path = file.path; row.dataset.group = type;
    const vaultPath = this.plugin.git.vaultPath(file.path), outside = vaultPath === undefined;
    const open = () => type === 'conflict' ? this.plugin.openConflict(file.path) : this.plugin.openDiff(file.path, type === 'index' ? this.plugin.controller.status?.head === '(initial)' ? EMPTY : HEAD : file.untracked ? EMPTY : INDEX, type === 'index' ? INDEX : WORKTREE, type === 'index' && file.oldPath ? file.oldPath : file.path);
    const link = button(row, '', open, 'gp-file-link'); setIcon(el(link, 'span', 'gp-sc-file-icon'), 'file-text'); el(link, 'span', 'gp-sc-filename', data.name);
    if (this.plugin.settings.sourceControlLayout === 'list' && data.directory) el(link, 'span', 'gp-sc-directory', data.directory);
    setTooltip(link, `${outside ? '当前笔记库外 · ' : ''}${file.path}${file.oldPath ? ` ← ${file.oldPath}` : ''}`);
    if (outside) el(row, 'span', 'gp-outside', '库外'); statusBadge(row, type === 'index' ? file.index : file.worktree, type === 'conflict' || type === 'untracked' ? type : undefined);
    if (type !== 'conflict') this.iconButton(row, type === 'index' ? 'minus' : 'plus', type === 'index' ? '取消暂存' : '暂存', () => this.stage([file], type === 'index'), 'gp-sc-stage').disabled = this.plugin.controller.busy;
    row.oncontextmenu = e => {
      e.preventDefault(); const menu = new Menu(); menu.addItem(i => i.setTitle('查看文件历史').setIcon('history').onClick(() => void this.plugin.openHistory(file.path)));
      if (!outside) menu.addItem(i => i.setTitle('在 Obsidian 中打开').setIcon('external-link').setDisabled(!(this.app.vault.getAbstractFileByPath(vaultPath) instanceof TFile)).onClick(() => void this.plugin.openNote(file.path)));
      menu.addItem(i => i.setTitle('在系统资源管理器中显示').setIcon('folder-open').onClick(() => void this.plugin.revealFile(file.path)));
      if (type === 'worktree' || type === 'untracked') menu.addItem(i => i.setTitle('丢弃工作区修改…').setDisabled(this.plugin.controller.busy).onClick(() => this.plugin.confirmDiscard([file.path]))); menu.showAtMouseEvent(e);
    };
  }
  private stage(files: FileStatus[], unstage: boolean): Promise<unknown> {
    const paths = sourcePaths(files, this.plugin.git.repo?.vaultPrefix ?? '', this.plugin.settings.sourceControlVaultOnly);
    if (!paths.length) return Promise.resolve();
    if (paths.some(path => this.plugin.indexEdits.has(path) || this.plugin.worktreeEdits.has(path))) { new Notice('请先保存比较器中的文件修改，再调整暂存状态'); return Promise.resolve(); }
    return this.plugin.run(unstage ? '取消暂存' : '暂存', async () => { if (!unstage) await this.plugin.flushEditors(); if (unstage) await this.plugin.git.unstage(paths); else await this.plugin.git.stage(paths); });
  }
}
