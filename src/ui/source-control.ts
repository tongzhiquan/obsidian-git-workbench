import { formatNumber, t } from '../i18n';
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
  getDisplayText(): string { return t('source.viewTitle'); }
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
    if (this.commitMessage.trim()) new ConfirmModal(this.app, t('commit.replaceTitle'), t('commit.replaceDescription'), fill, t('commit.replace')).open();
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
    setIcon(control, tree ? 'list' : 'list-tree'); setTooltip(control, tree ? t('source.listLayout') : t('source.treeLayout'));
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
    setTooltip(control, active ? t('source.vaultOnlyOn') : t('source.vaultOnly'));
  }
  private showCommitMenu(anchor: HTMLElement): void {
    const menu = new Menu(), busy = this.plugin.controller.busy;
    menu.addItem(i => i.setTitle(t('commit.fillBackup')).setIcon('calendar-clock').setDisabled(busy).onClick(() => this.fillBackupMessage()));
    menu.addItem(i => i.setTitle(t('commit.amendOption')).setIcon('git-commit-horizontal').setChecked(this.amend).setDisabled(busy).onClick(() => { this.amend = !this.amend; this.render(); }));
    menu.addItem(i => i.setTitle(t('commit.amendHelp')).setIcon('circle-help').onClick(() => this.plugin.previewText(t('commit.amendHelpTitle'), t('commit.amendHelpBody'))));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.right, y: rect.bottom }, anchor.ownerDocument);
  }
  private showViewMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    for (const [layout, title, icon] of [['list', t('source.listLayout'), 'list'], ['tree', t('source.treeLayout'), 'list-tree']] as const) menu.addItem(i => i.setTitle(title).setIcon(icon).setChecked(this.plugin.settings.sourceControlLayout === layout).onClick(() => this.setLayout(layout)));
    menu.addItem(i => i.setTitle(t('source.vaultOnly')).setIcon('filter').setChecked(this.plugin.settings.sourceControlVaultOnly).onClick(() => this.setVaultOnly(!this.plugin.settings.sourceControlVaultOnly)));
    menu.addItem(i => i.setTitle(t('source.expandAll')).setIcon('chevrons-up-down').onClick(() => this.expandAll()));
    menu.addItem(i => i.setTitle(t('source.collapseAll')).setIcon('chevrons-down-up').onClick(() => this.collapseAll()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle(t('common.openGitWorkbench')).setIcon(GIT_WORKBENCH_ICON).onClick(() => this.plugin.openWorkbench()));
    menu.addItem(i => i.setTitle(t('workbench.repoActions')).setIcon('git-branch').onClick(() => this.plugin.repositoryMenu(anchor)));
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
    if (this.amend) new ConfirmModal(this.app, t('commit.amendTitle'), t('commit.amendWarning'), () => this.plugin.run(t('commit.amendAction'), work)).open(); else void this.plugin.run(t('commit.submit'), work);
  }
  render(): void {
    const connected = !!this.plugin.git.repo;
    if (this.connected === connected && this.contentEl.querySelector('.gp-sc-header')) { this.update(); return; }
    this.connected = connected; this.filesKey = undefined; this.feedbackKey = undefined; this.operation = undefined;
    this.scrollTop = this.contentEl.querySelector('.gp-sc-list .gp-virtual')?.scrollTop ?? this.scrollTop;
    this.disposeList?.(); this.disposeList = undefined;
    this.contentEl.replaceChildren(); this.contentEl.className = 'view-content gp-source-control'; const c = this.plugin.controller;
    const header = el(this.contentEl, 'div', 'gp-sc-header'); el(header, 'strong', '', t('source.title'));
    this.iconButton(header, 'list', t('source.listLayout'), () => this.setLayout(this.plugin.settings.sourceControlLayout === 'tree' ? 'list' : 'tree'), 'gp-sc-layout');
    this.iconButton(header, 'chevrons-down-up', t('source.collapseAll'), () => this.collapseAll(), 'gp-sc-collapse');
    this.iconButton(header, 'chevrons-up-down', t('source.expandAll'), () => this.expandAll(), 'gp-sc-expand');
    this.updateLayoutButton();
    this.iconButton(header, 'refresh-cw', t('command.refresh'), () => c.refresh(), 'gp-sc-refresh').disabled = c.busy;
    this.iconButton(header, 'filter', t('source.vaultOnly'), () => this.setVaultOnly(!this.plugin.settings.sourceControlVaultOnly), 'gp-sc-filter'); this.updateFilterButton();
    this.iconButton(header, GIT_WORKBENCH_ICON, t('common.openGitWorkbench'), () => this.plugin.openWorkbench(), 'gp-sc-workbench');
    const more = this.iconButton(header, 'ellipsis', t('source.moreActions'), () => this.showViewMenu(more), 'gp-sc-more');
    if (!connected) { el(this.contentEl, 'div', 'gp-sc-disconnected'); this.update(); return; }
    const repo = el(this.contentEl, 'div', 'gp-sc-repository');
    const branchLabel = el(repo, 'div', 'gp-sc-branch'); setIcon(el(branchLabel, 'span', 'gp-sc-branch-icon'), 'git-branch'); el(branchLabel, 'span', 'gp-sc-branch-name');
    el(branchLabel, 'span', 'gp-sc-tracking');
    const network = el(repo, 'div', 'gp-sc-network');
    for (const [key, icon, label] of [['fetch', 'cloud-download', t('network.fetchTooltip')], ['pull', 'arrow-down', t('network.pullTooltip')], ['push', 'arrow-up', t('network.pushTooltip')]] as const) this.iconButton(network, icon, label, () => this.plugin.network(key)).disabled = c.busy;
    el(this.contentEl, 'div', 'gp-sc-feedback');
    const messageBox = el(this.contentEl, 'div', 'gp-sc-message');
    const text = el(messageBox, 'textarea', 'gp-commit-input'); text.rows = 1; text.placeholder = t('source.messagePlaceholder'); text.setAttribute('aria-label', t('source.message')); text.value = this.commitMessage;
    const ai = this.iconButton(messageBox, 'wand-sparkles', t('command.generateMessage'), () => void this.generateAiMessage(), 'gp-generate-ai-message'); ai.disabled = c.busy;
    const commitBar = el(this.contentEl, 'div', 'gp-commit-controls');
    const submit = button(commitBar, this.amend ? t('commit.amend') : t('commit.submit'), () => this.commit(), 'mod-cta gp-submit');
    const commitMenu = this.iconButton(commitBar, 'chevron-down', t('source.commitOptions'), () => this.showCommitMenu(commitMenu), 'mod-cta gp-commit-menu');
    text.oninput = () => { this.commitMessage = text.value; this.resizeMessage(text); this.updateControls(); };
    text.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!submit.disabled) this.commit(); } };
    this.resizeMessage(text);
    el(this.contentEl, 'div', 'gp-sc-operation'); el(this.contentEl, 'div', 'gp-sc-list'); this.update();
  }
  private update(): void {
    const c = this.plugin.controller, s = c.status;
    if (!this.plugin.git.repo) {
      const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-disconnected'), detail = c.error || t('source.initHint');
      if (parent && parent.dataset.detail !== detail) { parent.dataset.detail = detail; parent.replaceChildren(); empty(parent, t('source.disconnected'), detail); button(parent, t('common.openWorkbench'), () => this.plugin.openWorkbench()); }
      this.updateControls(); return;
    }
    const branch = s?.branch === '(detached)' ? s.head.slice(0, 7) : s?.branch ?? t('common.loading');
    const label = this.contentEl.querySelector<HTMLElement>('.gp-sc-branch')!;
    const name = label.querySelector('.gp-sc-branch-name')!, tracking = label.querySelector('.gp-sc-tracking')!, counts = `↑${s?.ahead ?? 0} ↓${s?.behind ?? 0}`;
    if (name.textContent !== branch) name.textContent = branch;
    if (tracking.textContent !== counts) tracking.textContent = counts;
    const tooltip = t('source.branchTooltip', { p0: this.plugin.git.repo.root.replace(/\\/g, '/'), p1: branch, p2: s?.upstream ? t('source.upstream', { p0: s.upstream }) : '' });
    if (label.getAttribute('aria-label') !== tooltip) setTooltip(label, tooltip);
    const operation = s?.operation;
    if (operation !== this.operation) {
      this.operation = operation;
      const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-operation')!; parent.replaceChildren();
      if (operation) {
        const banner = el(parent, 'div', 'gp-operation'); el(banner, 'strong', '', t('source.operation', { p0: operation }));
        button(banner, t('source.continue'), () => this.plugin.run(t('source.continueOperation'), () => this.plugin.git.continueOperation(operation)));
        button(banner, t('source.abort'), () => new ConfirmModal(this.app, t('source.abortTitle'), t('source.abortDescription', { p0: operation }), () => this.plugin.run(t('source.abortOperation'), () => this.plugin.git.continueOperation(operation, true))).open());
      }
    }
    this.renderFeedback(); this.renderFiles(); this.updateControls();
  }
  private renderFeedback(): void {
    const parent = this.contentEl.querySelector<HTMLElement>('.gp-sc-feedback'); if (!parent) return;
    const c = this.plugin.controller, key = JSON.stringify([c.busy, c.error, c.message, c.automationPaused, this.plugin.settings.autoBackup]);
    if (this.feedbackKey === key) return; this.feedbackKey = key; parent.replaceChildren();
    if (c.busy || c.error) el(parent, 'p', c.error ? 'gp-error gp-sc-notice' : 'gp-muted gp-sc-notice', c.error || c.message + '…');
    if (this.plugin.settings.autoBackup && c.automationPaused) el(parent, 'p', 'gp-error gp-sc-notice', t('source.backupPaused'));
  }
  private updateControls(): void {
    const busy = this.plugin.controller.busy;
    for (const control of this.contentEl.querySelectorAll<HTMLButtonElement>('.gp-sc-network button, .gp-sc-refresh, .gp-generate-ai-message, .gp-commit-menu, .gp-sc-stage, .gp-sc-operation button')) control.disabled = busy;
    const submit = this.contentEl.querySelector<HTMLButtonElement>('.gp-submit');
    if (submit) { submit.disabled = busy || !this.commitMessage.trim(); submit.textContent = this.amend ? t('commit.amend') : t('commit.submit'); }
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
    if (!rows.length) { this.disposeList = undefined; empty(list, this.plugin.settings.sourceControlVaultOnly ? t('source.vaultClean') : t('source.clean'), this.plugin.settings.sourceControlVaultOnly ? t('source.disableFilter') : t('source.allCommitted')); return; }
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
        if (data.type !== 'conflict') this.iconButton(row, data.type === 'index' ? 'minus' : 'plus', t(data.type === 'index' ? data.kind === 'group' ? 'source.unstageAll' : 'source.unstageFolder' : data.kind === 'group' ? 'source.stageAll' : 'source.stageFolder', { p0: formatNumber(data.files.length) }), () => this.stage(data.files, data.type === 'index'), 'gp-sc-stage').disabled = this.plugin.controller.busy;
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
    setTooltip(link, `${outside ? t('source.outsidePrefix') : ''}${file.path}${file.oldPath ? ` ← ${file.oldPath}` : ''}`);
    if (outside) el(row, 'span', 'gp-outside', t('common.outside')); statusBadge(row, type === 'index' ? file.index : file.worktree, type === 'conflict' || type === 'untracked' ? type : undefined);
    if (type !== 'conflict') this.iconButton(row, type === 'index' ? 'minus' : 'plus', type === 'index' ? t('source.unstage') : t('source.stage'), () => this.stage([file], type === 'index'), 'gp-sc-stage').disabled = this.plugin.controller.busy;
    row.oncontextmenu = e => {
      e.preventDefault(); const menu = new Menu(); menu.addItem(i => i.setTitle(t('source.fileHistory')).setIcon('history').onClick(() => void this.plugin.openHistory(file.path)));
      if (!outside) menu.addItem(i => i.setTitle(t('source.openInObsidian')).setIcon('external-link').setDisabled(!(this.app.vault.getAbstractFileByPath(vaultPath) instanceof TFile)).onClick(() => void this.plugin.openNote(file.path)));
      menu.addItem(i => i.setTitle(t('source.revealFile')).setIcon('folder-open').onClick(() => void this.plugin.revealFile(file.path)));
      if (type === 'worktree' || type === 'untracked') menu.addItem(i => i.setTitle(t('source.discardMenu')).setDisabled(this.plugin.controller.busy).onClick(() => this.plugin.confirmDiscard([file.path]))); menu.showAtMouseEvent(e);
    };
  }
  private stage(files: FileStatus[], unstage: boolean): Promise<unknown> {
    const paths = sourcePaths(files, this.plugin.git.repo?.vaultPrefix ?? '', this.plugin.settings.sourceControlVaultOnly, unstage ? 'index' : 'worktree');
    if (!paths.length) return Promise.resolve();
    if (paths.some(path => this.plugin.indexEdits.has(path) || this.plugin.worktreeEdits.has(path))) { new Notice(t('source.saveBeforeStage')); return Promise.resolve(); }
    return this.plugin.run(unstage ? t('source.unstage') : t('source.stage'), async () => { if (!unstage) await this.plugin.flushEditors(); if (unstage) await this.plugin.git.unstage(paths); else await this.plugin.git.stage(paths); });
  }
}
