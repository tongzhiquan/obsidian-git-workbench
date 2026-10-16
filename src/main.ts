import { FileSystemAdapter, MarkdownView, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { GitService } from './git/service';
import { RepositoryController } from './controller';
import { editorExtensions } from './editor';
import { DEFAULT_SETTINGS, HEAD, INDEX, WORKTREE, type Operation, type Revision, type Settings } from './types';
import { WorkbenchView, WORKBENCH } from './ui/workbench';
import { SourceControlView, SOURCE_CONTROL } from './ui/source-control';
import { button, ConfirmModal, el, PromptModal } from './ui/common';
import { GIT_PLUS_ICON, registerGitPlusIcon } from './ui/icon';
import { formatCommitMessage } from './commit-message';
import { shell } from 'electron';
import type { EditTarget, FileContent, TextDraft } from './types';
export default class GitPlus extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  git!: GitService;
  controller!: RepositoryController;
  readonly indexDrafts = new Map<string, TextDraft>();
  readonly worktreeDrafts = new Map<string, TextDraft>();
  private draftTimer?: ReturnType<typeof setTimeout>;
  private statusBar?: HTMLElement;
  private autoTimer?: number;
  private saveTail: Promise<void> = Promise.resolve();
  private sourceControlOpening?: Promise<SourceControlView>;
  private unloaded = false;
  async onload(): Promise<void> {
    if (!Platform.isDesktopApp || !(this.app.vault.adapter instanceof FileSystemAdapter)) { new Notice('Git Plus 需要桌面文件系统笔记库'); return; }
    const data = await this.loadData(); this.settings = { ...DEFAULT_SETTINGS, ...data?.settings };
    for (const target of ['index', 'worktree'] as const) if (Array.isArray(data?.[`${target}Drafts`])) for (const entry of data[`${target}Drafts`]) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1]?.text === 'string' && typeof entry[1]?.base?.text === 'string' && (target !== 'index' || typeof entry[1]?.base?.indexEntry === 'string')) this.drafts(target).set(entry[0], entry[1]);
    }
    this.settings.pageSize = 200; this.settings.intervalMinutes = Math.max(1, Math.min(1440, Number(this.settings.intervalMinutes) || 10));
    this.git = new GitService(this.app.vault.adapter.getBasePath(), this.settings.gitPath);
    this.controller = new RepositoryController(this.git, this.settings, message => new Notice(message, 8000));
    registerGitPlusIcon();
    this.registerView(WORKBENCH, leaf => new WorkbenchView(leaf, this)); this.registerView(SOURCE_CONTROL, leaf => new SourceControlView(leaf, this));
    this.addRibbonIcon(GIT_PLUS_ICON, 'Git Plus', () => void this.openWorkbench());
    this.addCommand({ id: 'open-workbench', name: '打开 Git 工作台', callback: () => void this.openWorkbench() });
    this.addCommand({ id: 'open-source-control', name: '打开源代码管理', callback: () => void this.openSourceControl() });
    this.addCommand({ id: 'file-history', name: '当前笔记历史', callback: () => { const path = this.currentPath(); if (path) void this.openHistory(path); else new Notice('请先打开一篇笔记'); } });
    this.addCommand({ id: 'file-diff', name: '当前笔记差异', callback: () => { const path = this.currentPath(); if (path) void this.openDiff(path, INDEX, WORKTREE); } });
    this.addCommand({ id: 'compare-refs', name: '比较任意版本', callback: () => this.compareRefs() });
    this.addCommand({ id: 'stage-file', name: '暂存当前笔记', callback: () => { const path = this.currentPath(); if (path) void this.run('暂存当前笔记', async () => { await this.flushEditors(); await this.git.stage([path]); }); } });
    this.addCommand({ id: 'unstage-file', name: '取消暂存当前笔记', callback: () => { const path = this.currentPath(); if (path) void this.run('取消暂存', () => this.git.unstage([path])); } });
    this.addCommand({ id: 'commit', name: '提交已暂存变化', callback: () => new PromptModal(this.app, '提交', [{ label: '提交消息（支持 {{date}}）', value: this.backupMessage(), multiline: true }], values => this.run('提交', async () => { await this.flushEditors(); await this.git.commit(formatCommitMessage(values[0])); })).open() });
    this.addCommand({ id: 'fill-backup-message', name: '填入备份格式提交消息', callback: () => { void this.openSourceControl().then(view => view.fillBackupMessage()); } });
    for (const action of ['fetch', 'pull', 'push'] as const) this.addCommand({ id: action, name: action === 'fetch' ? '获取远程变化' : action === 'pull' ? '拉取（仅快进）' : '推送', callback: () => void this.network(action) });
    this.addCommand({ id: 'sync', name: '同步（Fetch / Pull / Push）', callback: () => void this.run('同步', async () => { await this.flushEditors(); await this.git.network('fetch'); await this.git.network('pull'); await this.git.network('push'); }) });
    this.addCommand({ id: 'refresh', name: '刷新仓库', callback: () => void this.controller.refresh() });
    this.addCommand({ id: 'toggle-blame', name: '切换整篇逐行归属', callback: () => { this.settings.fullBlame = !this.settings.fullBlame; void this.persistSettings(); this.controller.emit(); } });
    this.addCommand({ id: 'backups', name: '查看恢复备份', callback: () => void this.openWorkbench('backups') });
    this.addCommand({ id: 'create-branch', name: '创建分支', callback: () => this.createBranch() });
    this.addSettingTab(new GitPlusSettings(this));
    this.registerEditorExtension(editorExtensions(this));
    this.registerEvent(this.app.vault.on('modify', () => this.controller.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('create', () => this.controller.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.controller.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.controller.scheduleRefresh()));
    this.registerDomEvent(window, 'focus', () => void this.controller.refresh());
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.git.repo) return; const path = this.git.repoPath(file.path); menu.addSeparator();
      menu.addItem(i => i.setTitle('Git Plus · 文件历史').setIcon('history').onClick(() => void this.openHistory(path)));
      menu.addItem(i => i.setTitle('Git Plus · 查看差异').setIcon('git-compare').onClick(() => void this.openDiff(path, INDEX, WORKTREE)));
      menu.addItem(i => i.setTitle('Git Plus · 暂存文件').setIcon('plus').onClick(() => void this.run('暂存', async () => { await this.flushEditors(); await this.git.stage([path]); })));
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      if (!info.file || !this.git.repo) return; const path = this.git.repoPath(info.file.path); const line = editor.getCursor().line;
      menu.addItem(i => i.setTitle('Git Plus · 此行最后一次提交').setIcon('git-commit-horizontal').onClick(async () => {
        const blame = await this.controller.blame(path, editor.getValue()); const row = blame[line]; if (row && !row.uncommitted) await this.openCommit(row.hash); else new Notice('此行尚未提交');
      }));
    }));
    this.statusBar = this.addStatusBarItem(); this.statusBar.addClass('gp-statusbar'); this.statusBar.onclick = () => void this.openSourceControl();
    const updateStatus = () => { const s = this.controller.status; if (this.statusBar) { this.statusBar.textContent = this.controller.busy ? '⑂ ' + this.controller.message : s ? `⑂ ${s.branch === '(detached)' ? s.head.slice(0, 7) : s.branch} · ${s.files.length} ↑${s.ahead} ↓${s.behind}` : '⑂ Git Plus'; this.statusBar.title = this.controller.error || this.git.repo?.root || '打开源代码管理'; } };
    const off = this.controller.subscribe(updateStatus); this.register(off); updateStatus();
    await this.controller.refresh(); this.configureAutomation();
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      void this.openSourceControl(false).catch(error => new Notice(`打开源代码管理失败：${error instanceof Error ? error.message : error}`, 8000));
      if (this.settings.pullOnStartup && this.git.repo) void this.run('启动拉取', () => this.git.network('pull'));
    });
  }
  persistSettings(): Promise<void> { const data = { settings: { ...this.settings }, indexDrafts: [...this.indexDrafts], worktreeDrafts: [...this.worktreeDrafts] }; this.saveTail = this.saveTail.catch(() => {}).then(() => this.saveData(data)); return this.saveTail; }
  drafts(target: EditTarget): Map<string, TextDraft> { return target === 'index' ? this.indexDrafts : this.worktreeDrafts; }
  setIndexDraft(path: string, draft?: TextDraft): void { this.setDiffDraft(path, 'index', draft); }
  setDiffDraft(path: string, target: EditTarget, draft?: TextDraft): void {
    if (draft) this.drafts(target).set(path, draft); else this.drafts(target).delete(path);
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => { this.draftTimer = undefined; void this.persistSettings().catch(error => new Notice(`比较编辑草稿保存失败：${error.message}`)); }, 300);
  }
  async saveWorkingFile(path: string, text: string, base: FileContent): Promise<void> {
    const relative = this.git.vaultPath(path), normal = (value: string) => value.replace(/\r\n/g, '\n');
    const checkEditors = () => {
      this.app.workspace.iterateAllLeaves(leaf => {
        if (relative !== undefined && leaf.view instanceof MarkdownView && leaf.view.file?.path === relative && normal(leaf.view.editor.getValue()) !== normal(base.text)) throw new Error('此笔记的编辑器内容已变化，未覆盖；请先保存原笔记，再重新比较。比较草稿已保留');
      });
    };
    checkEditors();
    const indexedFile = relative === undefined ? undefined : this.app.vault.getAbstractFileByPath(relative);
    const hidden = relative !== undefined && (relative.split('/').some(part => part.startsWith('.')) || relative === this.app.vault.configDir || relative.startsWith(this.app.vault.configDir + '/'));
    const throughVault = relative !== undefined && (indexedFile instanceof TFile || !base.exists && !hidden);
    await this.git.saveWorktree(path, text, base, !throughVault ? undefined : async () => {
      checkEditors(); const file = this.app.vault.getAbstractFileByPath(relative!);
      if (file instanceof TFile) {
        await this.app.vault.process(file, current => { checkEditors(); if (current !== base.text || !base.exists) throw new Error('工作区文件已变化，草稿已保留，请重新比较'); return text; });
      } else if (!base.exists) await this.app.vault.create(relative!, text);
      else throw new Error('工作区文件已删除，草稿已保留，请重新比较');
    });
  }
  async openComparisonFile(path: string): Promise<void> {
    const relative = this.git.vaultPath(path);
    if (relative !== undefined) {
      const file = this.app.vault.getAbstractFileByPath(relative);
      if (!(file instanceof TFile)) { new Notice('工作区文件不存在，可能已删除或重命名'); return; }
      await this.app.workspace.getLeaf('tab').openFile(file);
    } else {
      const error = await shell.openPath(this.git.path(path)); if (error) new Notice(`无法打开文件：${error}`);
    }
  }
  configureAutomation(): void {
    if (this.autoTimer) window.clearInterval(this.autoTimer);
    if (this.settings.autoCommit || this.settings.autoSync) this.autoTimer = window.setInterval(() => void this.controller.automation(() => this.flushEditors()), this.settings.intervalMinutes * 60000);
  }
  async flushEditors(): Promise<void> {
    const saves: Promise<void>[] = [];
    this.app.workspace.iterateAllLeaves(leaf => {
      if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) return;
      const view = leaf.view, file = view.file!;
      saves.push((async () => { const disk = await this.app.vault.read(file); if (disk.replace(/\r\n/g, '\n') !== view.editor.getValue().replace(/\r\n/g, '\n')) await view.save(); })());
    }); await Promise.all(saves);
  }
  run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> { return this.controller.run(label, work); }
  currentPath(): string | undefined { const file = this.app.workspace.getActiveFile(); return file && this.git.repo ? this.git.repoPath(file.path) : undefined; }
  backupMessage(): string { return formatCommitMessage(this.settings.commitTemplate); }
  async openWorkbench(tab?: 'graph' | 'refs' | 'stash' | 'backups'): Promise<WorkbenchView> {
    let leaf = this.app.workspace.getLeavesOfType(WORKBENCH)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: WORKBENCH, active: true }); }
    await this.app.workspace.revealLeaf(leaf); const view = leaf.view as WorkbenchView; if (tab) await view.show(tab); return view;
  }
  async openSourceControl(active = true): Promise<SourceControlView> {
    if (!this.sourceControlOpening) this.sourceControlOpening = (async () => {
      const leaf = await this.app.workspace.ensureSideLeaf(SOURCE_CONTROL, 'right', { active, reveal: true });
      return leaf.view as SourceControlView;
    })();
    try {
      const view = await this.sourceControlOpening;
      if (active && !this.unloaded) await this.app.workspace.revealLeaf(view.leaf);
      return view;
    } finally { this.sourceControlOpening = undefined; }
  }
  async openHistory(path: string): Promise<void> { await (await this.openWorkbench()).showHistory(path); }
  async openDiff(path: string, left: Revision = INDEX, right: Revision = WORKTREE, oldPath = path): Promise<void> { await this.flushEditors(); this.controller.invalidate(); await (await this.openWorkbench()).showDiff(path, left, right, oldPath); }
  async openConflict(path: string): Promise<void> { await (await this.openWorkbench()).showConflict(path); }
  async openCommit(hash: string): Promise<void> { const view = await this.openWorkbench(); view.selectedHash = hash; view.filter = { ref: hash }; view.commits = []; await view.show('graph'); }
  async openNote(path: string): Promise<void> { const relative = this.git.vaultPath(path); if (relative === undefined) return; const file = this.app.vault.getAbstractFileByPath(relative); if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file); }
  previewText(title: string, text: string): void { const modal = new Modal(this.app); modal.titleEl.textContent = title; el(modal.contentEl, 'pre', 'gp-text-preview', text); modal.open(); }
  createBranch(start = 'HEAD'): void { new PromptModal(this.app, '创建并切换分支', [{ label: '分支名称' }, { label: '起始提交', value: start }], values => this.run('创建分支', () => this.git.branch('create', values[0], values[1]))).open(); }
  createTag(start = 'HEAD'): void { new PromptModal(this.app, '创建标签', [{ label: '标签名称' }, { label: '目标提交', value: start }], values => this.run('创建标签', () => this.git.tag('create', values[0], values[1]))).open(); }
  confirmIntegrate(operation: Operation, ref?: string): void {
    const accept = (value: string) => new ConfirmModal(this.app, `${operation}？`, `对当前分支执行 ${operation} ${value}。请确保工作区干净；若产生冲突，使用侧栏解决后继续或中止。`, () => this.run(operation, async () => { await this.flushEditors(); await this.git.integrate(operation, value); })).open();
    if (ref) accept(ref); else new PromptModal(this.app, operation, [{ label: '分支、标签或提交 SHA' }], values => accept(values[0])).open();
  }
  compareRefs(left = 'HEAD', right = ':worktree'): void {
    new PromptModal(this.app, '比较任意版本', [{ label: '仓库相对文件路径', value: this.currentPath() ?? '' }, { label: '左侧版本（SHA / 分支 / :index）', value: left }, { label: '右侧版本（SHA / :index / :worktree）', value: right }], async values => {
      const revision = (s: string): Revision => s === ':index' ? INDEX : s === ':worktree' ? WORKTREE : { kind: 'commit', ref: s };
      await this.openDiff(values[0], revision(values[1]), revision(values[2]));
    }).open();
  }
  confirmDiscard(paths: string[]): void { new ConfirmModal(this.app, '丢弃工作区修改？', `${paths.join('\n')}\n将先保存可恢复副本；未跟踪文件会被删除，已跟踪文件恢复为暂存区版本。`, () => this.run('丢弃修改', async () => { await this.flushEditors(); await this.git.discard(paths); })).open(); }
  async network(action: 'fetch' | 'pull' | 'push'): Promise<void> {
    if (action === 'push' && !this.controller.status?.upstream) {
      const remotes = await this.git.remotes(); new PromptModal(this.app, '推送并设置上游', [{ label: '远程名称', value: remotes[0]?.name || 'origin' }, { label: '远程分支', value: this.controller.status?.branch || 'main' }], values => this.run('推送', () => this.git.network('push', values[0], values[1]))).open(); return;
    }
    await this.run(action, async () => { await this.flushEditors(); await this.git.network(action); });
  }
  repositoryMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle('新建分支').setIcon('git-branch').onClick(() => this.createBranch())); menu.addItem(i => i.setTitle('创建标签').setIcon('tag').onClick(() => this.createTag()));
    for (const operation of ['merge', 'rebase', 'cherry-pick', 'revert'] as const) menu.addItem(i => i.setTitle(operation).onClick(() => this.confirmIntegrate(operation)));
    menu.addSeparator(); menu.addItem(i => i.setTitle('Stash 管理').onClick(() => void this.openWorkbench('stash'))); menu.addItem(i => i.setTitle('管理远程').onClick(() => void this.manageRemotes()));
    menu.addItem(i => i.setTitle('同步').onClick(() => void this.run('同步', async () => { await this.git.network('fetch'); await this.git.network('pull'); await this.git.network('push'); })));
    menu.addItem(i => i.setTitle('检测 Git 配置').onClick(async () => this.previewText('Git 环境诊断', await this.git.diagnostics())));
    menu.showAtPosition({ x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom });
  }
  async manageRemotes(): Promise<void> {
    const modal = new Modal(this.app); modal.titleEl.textContent = '管理远程';
    for (const remote of await this.git.remotes()) {
      const row = el(modal.contentEl, 'div', 'gp-remote-row'); el(row, 'strong', '', remote.name); el(row, 'code', '', remote.url);
      button(row, '检测连接', async () => new Notice(await this.git.testConnection(remote.name)));
      button(row, '编辑', () => new PromptModal(this.app, '修改远程地址', [{ label: 'URL', value: remote.url }], values => this.run('修改远程', () => this.git.remote('set-url', remote.name, values[0]))).open());
      button(row, '移除', () => new ConfirmModal(this.app, '移除远程？', remote.name, () => this.run('移除远程', () => this.git.remote('remove', remote.name))).open());
    }
    button(modal.contentEl, '添加远程', () => new PromptModal(this.app, '添加远程', [{ label: '名称', value: 'origin' }, { label: 'URL' }], values => this.run('添加远程', () => this.git.remote('add', values[0], values[1]))).open()); modal.open();
  }
  onunload(): void { this.unloaded = true; if (this.autoTimer) window.clearInterval(this.autoTimer); if (this.draftTimer) { clearTimeout(this.draftTimer); void this.persistSettings(); } this.controller?.dispose(); }
}
class GitPlusSettings extends PluginSettingTab {
  constructor(private plugin: GitPlus) { super(plugin.app, plugin); }
  display(): void {
    const parent = this.containerEl; parent.replaceChildren(); el(parent, 'h2', '', 'Git Plus');
    new Setting(parent).setName('Git 可执行文件').setDesc('使用系统 Git；修改后重新加载插件。').addText(text => text.setValue(this.plugin.settings.gitPath).onChange(async value => { this.plugin.settings.gitPath = value.trim() || 'git'; await this.plugin.persistSettings(); }));
    new Setting(parent).setName('环境诊断').setDesc('查看仓库路径、Git 版本、提交身份和认证配置。').addButton(b => b.setButtonText('检测').onClick(async () => this.plugin.previewText('Git 环境诊断', await this.plugin.git.diagnostics())));
    for (const [key, name, description] of [
      ['inlineBlame', '当前行修改归属', '在光标所在行末尾，以灰色显示最后修改此行的作者、日期和提交摘要。悬停可查看提交与行差异；尚未提交或未保存的修改会显示对应状态。'],
      ['fullBlame', '整篇逐行归属', '为整篇笔记的每一行显示最后修改者与提交信息，便于追溯不同段落的来源。优先于“当前行修改归属”；关闭后按“当前行修改归属”的设置显示。'],
      ['gutter', '编辑器变化标记', '在行号旁标出相对 Git 暂存区新增、修改和删除的内容。'],
    ] as const) new Setting(parent).setName(name).setDesc(description).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => { this.plugin.settings[key] = value; await this.plugin.persistSettings(); this.plugin.controller.emit(); }));
    el(parent, 'h3', '', '自动备份'); el(parent, 'p', 'gp-muted', '自动备份管理整个 Git 仓库，包含当前笔记库外文件。遇到冲突、分叉或认证失败会暂停。所有选项默认关闭。');
    for (const [key, name] of [['autoCommit', '定时暂存并提交全部变化'], ['autoSync', '定时提交并同步'], ['pullOnStartup', '启动时拉取（仅快进）']] as const) new Setting(parent).setName(name).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => { this.plugin.settings[key] = value; await this.plugin.persistSettings(); this.plugin.configureAutomation(); }));
    new Setting(parent).setName('周期（分钟）').addText(t => t.setValue(String(this.plugin.settings.intervalMinutes)).onChange(async value => { const n = Number(value); if (!Number.isFinite(n) || n < 1 || n > 1440) return; this.plugin.settings.intervalMinutes = n; await this.plugin.persistSettings(); this.plugin.configureAutomation(); }));
    new Setting(parent).setName('备份提交消息模板').setDesc('自动提交与手动“填入备份消息”共用；{{date}} 替换为本地时间，格式 YYYY-MM-DD HH:mm:ss。').addText(t => t.setValue(this.plugin.settings.commitTemplate).onChange(async value => { this.plugin.settings.commitTemplate = value || DEFAULT_SETTINGS.commitTemplate; await this.plugin.persistSettings(); }));
    new Setting(parent).setName('恢复自动备份').setDesc(this.plugin.controller.automationPaused ? '已暂停：先处理错误，再恢复定时任务。' : '当前未暂停').addButton(b => b.setButtonText('恢复').onClick(() => { this.plugin.controller.automationPaused = false; this.plugin.controller.emit(); this.display(); }));
  }
}
