import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type GitPlus from '../main';
import { EMPTY, HEAD, INDEX, WORKTREE, type FileStatus } from '../types';
import { button, ConfirmModal, el, empty, virtualList } from './common';
import { GIT_PLUS_ICON } from './icon';
import { formatCommitMessage } from '../commit-message';
import { statusBadge } from './status';
export const SOURCE_CONTROL = 'git-plus-source-control';
export class SourceControlView extends ItemView {
  private unsubscribe?: () => void;
  private disposeList?: () => void;
  private commitMessage = '';
  private focused = false;
  private amend = false;
  constructor(leaf: WorkspaceLeaf, public plugin: GitPlus) { super(leaf); }
  getViewType(): string { return SOURCE_CONTROL; }
  getDisplayText(): string { return 'Git Plus · 源代码管理'; }
  getIcon(): string { return GIT_PLUS_ICON; }
  async onOpen(): Promise<void> { this.containerEl.addClass('gp-container'); this.unsubscribe = this.plugin.controller.subscribe(() => { if (!this.focused) this.render(); }); this.render(); }
  async onClose(): Promise<void> { this.unsubscribe?.(); this.disposeList?.(); }
  fillBackupMessage(): void {
    const fill = () => {
      this.commitMessage = this.plugin.backupMessage();
      const textarea = this.contentEl.querySelector<HTMLTextAreaElement>('.gp-commit-input');
      if (textarea) { textarea.value = this.commitMessage; textarea.focus(); }
    };
    if (this.commitMessage.trim()) new ConfirmModal(this.app, '替换当前提交消息？', '将使用设置中的备份提交消息模板替换已输入的内容，只填入消息，不会暂存或提交文件。', fill, '替换消息').open();
    else fill();
  }
  render(): void {
    this.disposeList?.(); this.contentEl.replaceChildren(); this.contentEl.className = 'view-content gp-source-control'; const c = this.plugin.controller;
    const header = el(this.contentEl, 'div', 'gp-sc-header'); el(header, 'strong', '', '源代码管理'); const workbench = button(header, '', () => this.plugin.openWorkbench(), 'gp-icon-button'); setIcon(workbench, GIT_PLUS_ICON); workbench.title = '打开 Git Plus 工作台'; workbench.setAttribute('aria-label', workbench.title); button(header, '↻', () => c.refresh(), 'gp-icon-button'); button(header, '⋯', () => this.plugin.repositoryMenu(header), 'gp-icon-button');
    if (!this.plugin.git.repo) { empty(this.contentEl, '未连接 Git', c.error || '打开工作台初始化仓库'); button(this.contentEl, '打开工作台', () => this.plugin.openWorkbench()); return; }
    const s = c.status; el(this.contentEl, 'div', 'gp-sc-branch', `${s?.branch ?? '读取中…'}  ↑${s?.ahead ?? 0} ↓${s?.behind ?? 0}`);
    el(this.contentEl, 'p', 'gp-sc-scope', `整个仓库 · ${this.plugin.git.repo.root}`);
    if (c.busy || c.error) el(this.contentEl, 'p', c.error ? 'gp-error' : 'gp-muted', c.error || c.message + '…');
    if (c.automationPaused) el(this.contentEl, 'p', 'gp-error', '自动备份已暂停，在设置中恢复。');
    const text = el(this.contentEl, 'textarea', 'gp-commit-input'); text.placeholder = '提交消息（支持 {{date}}，只提交已暂存文件）'; text.setAttribute('aria-label', '提交消息'); text.value = this.commitMessage;
    text.onfocus = () => this.focused = true; text.onblur = () => { this.focused = false; }; text.oninput = () => this.commitMessage = text.value;
    const messageTools = el(this.contentEl, 'div', 'gp-message-tools'); const template = button(messageTools, '填入备份消息', () => this.fillBackupMessage(), 'gp-fill-backup-message'); template.title = `使用设置中的模板：${this.plugin.settings.commitTemplate}。仅填入消息，不会提交。`; template.disabled = c.busy;
    const commitBar = el(this.contentEl, 'div', 'gp-commit-controls'); const label = el(commitBar, 'label', 'gp-amend'); label.title = '将已暂存变化和当前消息合入最近一次提交；会生成新的提交 SHA，不会新增提交。'; const checkbox = el(label, 'input'); checkbox.type = 'checkbox'; checkbox.checked = this.amend; checkbox.onchange = () => this.amend = checkbox.checked; el(label, 'span', '', '修改上次提交');
    const help = button(commitBar, '?', () => this.plugin.previewText('Amend：修改上次提交', '普通提交：新增一条提交记录。\n\nAmend：用当前消息和暂存区内容替换最近一次提交。适合补上漏掉的文件或修正提交消息，提交总数不会增加，但 SHA 会改变。\n\n当前插件会将输入框中的消息作为新提交消息；需要保留原消息时，请填写原消息。\n\n已推送的提交通常不要使用 Amend，因为改写后会与远程历史不同。'), 'gp-icon-button gp-amend-help'); help.title = 'Amend 的作用'; help.setAttribute('aria-label', help.title);
    const commit = () => {
      const work = async () => { await this.plugin.flushEditors(); await this.plugin.git.commit(formatCommitMessage(this.commitMessage), this.amend); this.commitMessage = ''; this.amend = false; };
      if (this.amend) new ConfirmModal(this.app, '修改最后一次提交？', 'Amend 会生成新的提交 SHA。已推送的提交可能需要额外处理。', () => this.plugin.run('修改提交', work)).open(); else void this.plugin.run('提交', work);
    };
    const submit = button(commitBar, '提交', commit, 'mod-cta'); submit.disabled = c.busy; text.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } };
    const network = el(this.contentEl, 'div', 'gp-sc-network'); for (const [key, name] of [['fetch', 'Fetch'], ['pull', 'Pull'], ['push', 'Push']] as const) { const b = button(network, name, () => this.plugin.network(key)); b.disabled = c.busy; }
    if (s?.operation) { const banner = el(this.contentEl, 'div', 'gp-operation'); el(banner, 'strong', '', `正在 ${s.operation}`); button(banner, '继续', () => this.plugin.run('继续操作', () => this.plugin.git.continueOperation(s.operation!))); button(banner, '中止', () => new ConfirmModal(this.app, '中止当前操作？', `Git 将中止 ${s.operation}，请先保留手动编辑的结果。`, () => this.plugin.run('中止操作', () => this.plugin.git.continueOperation(s.operation!, true))).open()); }
    const files = s?.files ?? [];
    type Row = { title: string; files: FileStatus[]; type: 'conflict' | 'index' | 'worktree' | 'untracked' } | { file: FileStatus; type: 'conflict' | 'index' | 'worktree' | 'untracked' };
    const rows: Row[] = [];
    for (const [type, title, group] of [
      ['conflict', '冲突', files.filter(f => f.conflict)],
      ['index', '已暂存', files.filter(f => !f.conflict && !f.untracked && f.index !== '.')],
      ['worktree', '未暂存', files.filter(f => !f.conflict && !f.untracked && f.worktree !== '.')],
      ['untracked', '未跟踪', files.filter(f => f.untracked)],
    ] as [Row['type'], string, FileStatus[]][]) if (group.length) { rows.push({ title, files: group, type }); group.forEach(file => rows.push({ file, type })); }
    const list = el(this.contentEl, 'div', 'gp-sc-list');
    if (!rows.length) empty(list, '工作区干净', '所有变化已提交。');
    else this.disposeList = virtualList(list, rows, 42, (row, data) => {
      if ('title' in data) { row.classList.add('gp-group-heading'); el(row, 'strong', '', `${data.title}  ${data.files.length}`); if (data.type !== 'conflict') button(row, data.type === 'index' ? '− 全部' : '+ 全部', () => this.stage(data.files, data.type === 'index'), 'gp-icon-button'); return; }
      const { file, type } = data; row.classList.add('gp-sc-file'); row.dataset.path = file.path; row.dataset.group = type; const outside = this.plugin.git.vaultPath(file.path) === undefined;
      const open = () => type === 'conflict' ? this.plugin.openConflict(file.path) : this.plugin.openDiff(file.path, type === 'index' ? s?.head === '(initial)' ? EMPTY : HEAD : file.untracked ? EMPTY : INDEX, type === 'index' ? INDEX : WORKTREE, type === 'index' && file.oldPath ? file.oldPath : file.path);
      const link = button(row, file.path, open, 'gp-file-link'); link.title = `${outside ? '当前笔记库外 · ' : ''}${file.path}${file.oldPath ? ` ← ${file.oldPath}` : ''}`;
      if (outside) el(row, 'span', 'gp-outside', '库外'); statusBadge(row, type === 'index' ? file.index : file.worktree, type === 'conflict' || type === 'untracked' ? type : undefined);
      if (type !== 'conflict') button(row, type === 'index' ? '−' : '+', () => this.stage([file], type === 'index'), 'gp-icon-button');
      row.oncontextmenu = e => {
        e.preventDefault(); const menu = new Menu(); menu.addItem(i => i.setTitle('查看文件历史').setIcon('history').onClick(() => void this.plugin.openHistory(file.path)));
        if (!outside) menu.addItem(i => i.setTitle('在 Obsidian 打开').onClick(() => void this.plugin.openNote(file.path)));
        if (type === 'worktree' || type === 'untracked') menu.addItem(i => i.setTitle('丢弃工作区修改…').onClick(() => this.plugin.confirmDiscard([file.path]))); menu.showAtMouseEvent(e);
      };
    });
  }
  private stage(files: FileStatus[], unstage: boolean): Promise<unknown> {
    const paths = [...new Set(files.flatMap(f => f.oldPath ? [f.oldPath, f.path] : [f.path]))];
    if (paths.some(path => this.plugin.indexDrafts.has(path) || this.plugin.worktreeDrafts.has(path))) { new Notice('请先保存或放弃这些文件的比较草稿，再调整暂存状态'); return Promise.resolve(); }
    return this.plugin.run(unstage ? '取消暂存' : '暂存', async () => { if (!unstage) await this.plugin.flushEditors(); if (unstage) await this.plugin.git.unstage(paths); else await this.plugin.git.stage(paths); });
  }
}
