import { initializeLanguage, normalizeLanguageSetting, t } from './i18n';
import { FileSystemAdapter, FileView, getLanguage, MarkdownView, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, type WorkspaceLeaf } from 'obsidian';
import { GitService } from './git/service';
import { RepositoryController } from './controller';
import { editorExtensions } from './editor';
import { DEFAULT_SETTINGS, INDEX, WORKTREE, type Operation, type Revision, type Settings } from './types';
import { WorkbenchView, WORKBENCH } from './ui/workbench';
import { SourceControlView, SOURCE_CONTROL } from './ui/source-control';
import { button, ConfirmModal, el, PromptModal } from './ui/common';
import { GIT_WORKBENCH_ICON, registerGitWorkbenchIcon } from './ui/icon';
import { formatCommitMessage } from './commit-message';
import { shell } from 'electron';
import { lstat, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { EditTarget, FileContent, PendingEdit } from './types';
import { generateCommitMessage } from './ai';
import { DEFAULT_AI_MODELS } from './ai-core';
import { normalizeAiPrompt } from './ai-prompt';
export default class GitWorkbench extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  git!: GitService;
  controller!: RepositoryController;
  readonly indexEdits = new Map<string, PendingEdit>();
  readonly worktreeEdits = new Map<string, PendingEdit>();
  private storedData: Record<string, unknown> = {};
  private statusBar?: HTMLElement;
  private autoTimer?: number;
  private saveTail: Promise<void> = Promise.resolve();
  private sourceControlOpening?: Promise<SourceControlView>;
  private fileOpenings = new Map<string, Promise<void>>();
  private unloaded = false;
  async onload(): Promise<void> {
    const data = await this.loadData();
    const savedSettings = data && typeof data === 'object' && !Array.isArray(data) && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? data.settings as Partial<Settings> : undefined;
    this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    this.settings.language = normalizeLanguageSetting(this.settings.language);
    initializeLanguage(this.settings.language, getLanguage());
    if (!Platform.isDesktopApp || !(this.app.vault.adapter instanceof FileSystemAdapter)) { new Notice(t('error.desktopOnly')); return; }
    if (typeof savedSettings?.autoBackup !== 'boolean') this.settings.autoBackup = this.settings.autoCommit || this.settings.autoSync || this.settings.pullOnStartup;
    if (this.settings.sourceControlLayout !== 'list') this.settings.sourceControlLayout = 'tree';
    this.settings.sourceControlVaultOnly = this.settings.sourceControlVaultOnly === true;
    this.settings.allowEditingStagedFiles = this.settings.allowEditingStagedFiles === true;
    if (this.settings.stagingMode !== 'block') this.settings.stagingMode = 'line';
    if (!['openai', 'deepseek', 'custom'].includes(this.settings.aiProvider)) this.settings.aiProvider = DEFAULT_SETTINGS.aiProvider;
    this.settings.aiBaseUrl = typeof this.settings.aiBaseUrl === 'string' ? this.settings.aiBaseUrl : DEFAULT_SETTINGS.aiBaseUrl;
    this.settings.aiModel = typeof this.settings.aiModel === 'string' && this.settings.aiModel.trim() ? this.settings.aiModel : DEFAULT_SETTINGS.aiModel;
    this.settings.aiApiKeyId = typeof this.settings.aiApiKeyId === 'string' && /^[a-z0-9-]+$/.test(this.settings.aiApiKeyId) ? this.settings.aiApiKeyId : DEFAULT_SETTINGS.aiApiKeyId;
    this.settings.aiPrompt = normalizeAiPrompt(this.settings.aiPrompt);
    this.settings.aiMaxDiffChars = Math.max(1000, Math.min(500000, Number(this.settings.aiMaxDiffChars) || DEFAULT_SETTINGS.aiMaxDiffChars));
    // Preserve legacy data without loading or updating the retired draft records.
    // Editing content is now kept only in the current session until explicitly saved.
    if (data && typeof data === 'object' && !Array.isArray(data)) this.storedData = { ...data };
    this.settings.pageSize = 200; this.settings.intervalMinutes = Math.max(1, Math.min(1440, Number(this.settings.intervalMinutes) || 10));
    this.git = new GitService(this.app.vault.adapter.getBasePath(), this.settings.gitPath);
    this.controller = new RepositoryController(this.git, this.settings, message => new Notice(message, 8000));
    registerGitWorkbenchIcon();
    this.registerView(WORKBENCH, leaf => new WorkbenchView(leaf, this)); this.registerView(SOURCE_CONTROL, leaf => new SourceControlView(leaf, this));
    this.addRibbonIcon(GIT_WORKBENCH_ICON, 'Git Workbench', () => void this.openWorkbench());
    this.addCommand({ id: 'open-workbench', name: t('command.openWorkbench'), callback: () => void this.openWorkbench() });
    this.addCommand({ id: 'open-source-control', name: t('command.openSource'), callback: () => void this.openSourceControl() });
    this.addCommand({ id: 'file-history', name: t('command.history'), callback: () => { const path = this.currentPath(); if (path) void this.openHistory(path); else new Notice(t('command.openNoteFirst')); } });
    this.addCommand({ id: 'file-diff', name: t('command.diff'), callback: () => { const path = this.currentPath(); if (path) void this.openDiff(path, INDEX, WORKTREE); } });
    this.addCommand({ id: 'compare-refs', name: t('command.compare'), callback: () => this.compareRefs() });
    this.addCommand({ id: 'stage-file', name: t('command.stage'), callback: () => { const path = this.currentPath(); if (path) void this.run(t('command.stage'), async () => { await this.flushEditors(); await this.git.stage([path]); }); } });
    this.addCommand({ id: 'unstage-file', name: t('command.unstage'), callback: () => { const path = this.currentPath(); if (path) void this.run(t('source.unstage'), () => this.git.unstage([path])); } });
    this.addCommand({ id: 'commit', name: t('command.commit'), callback: () => new PromptModal(this.app, t('commit.submit'), [{ label: t('command.messageTemplate'), value: this.backupMessage(), multiline: true }], values => this.run(t('commit.submit'), async () => { await this.flushEditors(); await this.git.commit(formatCommitMessage(values[0])); })).open() });
    this.addCommand({ id: 'fill-backup-message', name: t('commit.fillBackup'), callback: () => { void this.openSourceControl().then(view => view.fillBackupMessage()); } });
    this.addCommand({ id: 'generate-commit-message', name: t('command.generateMessage'), callback: () => { void this.openSourceControl().then(view => view.generateAiMessage()); } });
    for (const action of ['fetch', 'pull', 'push'] as const) this.addCommand({ id: action, name: action === 'fetch' ? t('network.fetch') : action === 'pull' ? t('network.pull') : t('network.push'), callback: () => void this.network(action) });
    this.addCommand({ id: 'sync', name: t('command.sync'), callback: () => void this.run(t('network.sync'), async () => { await this.flushEditors(); await this.git.network('fetch'); await this.git.network('pull'); await this.git.network('push'); }) });
    this.addCommand({ id: 'refresh', name: t('command.refresh'), callback: () => void this.controller.refresh() });
    this.addCommand({ id: 'toggle-blame', name: t('command.toggleBlame'), callback: () => { this.settings.fullBlame = !this.settings.fullBlame; void this.persistSettings(); this.controller.emit(); } });
    this.addCommand({ id: 'create-branch', name: t('command.createBranch'), callback: () => this.createBranch() });
    this.addSettingTab(new GitWorkbenchSettings(this));
    this.registerEditorExtension(editorExtensions(this));
    this.registerEvent(this.app.vault.on('modify', () => this.controller.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('create', () => this.controller.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.controller.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.controller.scheduleRefresh()));
    this.registerDomEvent(window, 'focus', () => void this.controller.refresh());
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.git.repo) return; const path = this.git.repoPath(file.path); menu.addSeparator();
      menu.addItem(i => i.setTitle(t('command.historyMenu')).setIcon('history').onClick(() => void this.openHistory(path)));
      menu.addItem(i => i.setTitle(t('command.diffMenu')).setIcon('git-compare').onClick(() => void this.openDiff(path, INDEX, WORKTREE)));
      menu.addItem(i => i.setTitle(t('command.stageMenu')).setIcon('plus').onClick(() => void this.run(t('source.stage'), async () => { await this.flushEditors(); await this.git.stage([path]); })));
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      if (!info.file || !this.git.repo) return; const path = this.git.repoPath(info.file.path); const line = editor.getCursor().line;
      menu.addItem(i => i.setTitle(t('command.lineCommit')).setIcon('git-commit-horizontal').onClick(async () => {
        const blame = await this.controller.blame(path, editor.getValue()); const row = blame[line]; if (row && !row.uncommitted) await this.openCommit(row.hash); else new Notice(t('blame.uncommittedLine'));
      }));
    }));
    this.statusBar = this.addStatusBarItem(); this.statusBar.addClass('gp-statusbar'); this.statusBar.onclick = () => void this.openSourceControl();
    const updateStatus = () => { const s = this.controller.status; if (this.statusBar) { this.statusBar.textContent = this.controller.busy ? '⑂ ' + this.controller.message : s ? `⑂ ${s.branch === '(detached)' ? s.head.slice(0, 7) : s.branch} · ${s.files.length} ↑${s.ahead} ↓${s.behind}` : '⑂ Git Workbench'; this.statusBar.title = this.controller.error || this.git.repo?.root || t('command.openSource'); } };
    const off = this.controller.subscribe(updateStatus); this.register(off); updateStatus();
    await this.controller.refresh(); this.configureAutomation();
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      void this.openSourceControl(false).catch(error => new Notice(t('error.sourceOpen', { p0: error instanceof Error ? error.message : error }), 8000));
      if (this.settings.autoBackup && this.settings.pullOnStartup && this.git.repo) void this.run(t('network.startupPull'), () => this.git.network('pull'));
    });
  }
  persistSettings(): Promise<void> { const data = { ...this.storedData, settings: { ...this.settings } }; this.saveTail = this.saveTail.catch(() => {}).then(() => this.saveData(data)); return this.saveTail; }
  edits(target: EditTarget): Map<string, PendingEdit> { return target === 'index' ? this.indexEdits : this.worktreeEdits; }
  setEdit(path: string, target: EditTarget, edit?: PendingEdit): void { if (edit) this.edits(target).set(path, edit); else this.edits(target).delete(path); }
  async saveWorkingFile(path: string, text: string, base: FileContent, indexBase?: FileContent): Promise<void> {
    const relative = this.git.vaultPath(path), normal = (value: string) => value.replace(/\r\n/g, '\n');
    const checkEditors = () => {
      this.app.workspace.iterateAllLeaves(leaf => {
        if (relative !== undefined && leaf.view instanceof MarkdownView && leaf.view.file?.path === relative && normal(leaf.view.editor.getValue()) !== normal(base.text)) throw new Error(t('error.editorChanged'));
      });
    };
    checkEditors();
    const indexedFile = relative === undefined ? undefined : this.app.vault.getAbstractFileByPath(relative);
    const hidden = relative !== undefined && (relative.split('/').some(part => part.startsWith('.')) || relative === this.app.vault.configDir || relative.startsWith(this.app.vault.configDir + '/'));
    const throughVault = relative !== undefined && (indexedFile instanceof TFile || !base.exists && !hidden);
    await this.git.saveWorktree(path, text, base, !throughVault ? undefined : async () => {
      checkEditors(); const file = this.app.vault.getAbstractFileByPath(relative!);
      if (file instanceof TFile) {
        await this.app.vault.process(file, current => { checkEditors(); if (current !== base.text || !base.exists) throw new Error(t('error.worktreeChangedDraft')); return text; });
      } else if (!base.exists) await this.app.vault.create(relative!, text);
      else throw new Error(t('error.worktreeDeletedDraft'));
    }, indexBase);
  }
  async openComparisonFile(path: string): Promise<void> {
    const relative = this.git.vaultPath(path);
    if (relative !== undefined) {
      const file = this.app.vault.getAbstractFileByPath(relative);
      if (!(file instanceof TFile)) { new Notice(t('error.fileMissing')); return; }
      await this.openVaultFile(file);
    } else {
      const error = await shell.openPath(this.git.path(path)); if (error) new Notice(t('error.openFile', { p0: error }));
    }
  }
  async revealFile(path: string): Promise<void> {
    try {
      const absolute = this.git.path(path), root = resolve(this.git.root());
      // Match Obsidian's own file-manager action: its shell bridge runs in the main process.
      const hostShell = (window as Window & { electron?: { remote?: { shell?: typeof shell } } }).electron?.remote?.shell;
      const desktopShell = typeof hostShell?.showItemInFolder === 'function' && typeof hostShell.openPath === 'function' ? hostShell : shell;
      const nativeApp = this.app as typeof this.app & { showInFolder?: (path: string) => void | Promise<void> };
      try {
        await lstat(absolute);
        const relative = this.git.vaultPath(path);
        if (relative !== undefined && typeof nativeApp.showInFolder === 'function') await nativeApp.showInFolder(relative);
        else desktopShell.showItemInFolder(absolute);
        return;
      }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      let parent = dirname(absolute);
      while (true) {
        try { if ((await stat(parent)).isDirectory()) break; }
        catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        if (parent === root) throw new Error(t('error.repoDirectoryMissing'));
        parent = dirname(parent);
      }
      const error = await desktopShell.openPath(parent); if (error) throw new Error(error);
    } catch (error) { new Notice(t('error.revealFile', { p0: (error as Error).message })); }
  }
  configureAutomation(): void {
    if (this.autoTimer) window.clearInterval(this.autoTimer);
    if (this.settings.autoBackup && (this.settings.autoCommit || this.settings.autoSync)) this.autoTimer = window.setInterval(() => void this.controller.automation(() => this.flushEditors()), this.settings.intervalMinutes * 60000);
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
  aiApiKey(): string { return this.app.secretStorage.getSecret(this.settings.aiApiKeyId) ?? ''; }
  setAiApiKey(value: string): void { this.app.secretStorage.setSecret(this.settings.aiApiKeyId, value); }
  async generateAiCommitMessage(): Promise<string | undefined> {
    return this.run(t('ai.generate'), async () => {
      await this.flushEditors();
      return generateCommitMessage(this.settings, this.aiApiKey(), await this.git.stagedDiff());
    });
  }
  async openWorkbench(tab?: 'graph' | 'refs' | 'stash'): Promise<WorkbenchView> {
    let leaf = this.app.workspace.getLeavesOfType(WORKBENCH)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: WORKBENCH, active: true }); }
    await this.app.workspace.revealLeaf(leaf); const view = leaf.view as WorkbenchView; if (tab) await view.show(tab); this.app.workspace.setActiveLeaf(leaf, { focus: true }); return view;
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
  private openVaultFile(file: TFile): Promise<void> {
    const path = file.path, pending = this.fileOpenings.get(path); if (pending) return pending;
    const opening = (async () => {
      const workspace = this.app.workspace, matches: WorkspaceLeaf[] = [];
      workspace.iterateAllLeaves(leaf => {
        if (leaf.view instanceof FileView ? leaf.view.file?.path === path : leaf.isDeferred && leaf.getViewState().state?.file === path) matches.push(leaf);
      });
      const existing = matches.find(leaf => leaf === workspace.activeLeaf) ?? matches[0];
      if (existing) {
        await existing.loadIfDeferred(); await workspace.revealLeaf(existing); workspace.setActiveLeaf(existing, { focus: true });
      } else await workspace.getLeaf('tab').openFile(file);
    })().finally(() => { this.fileOpenings.delete(path); });
    this.fileOpenings.set(path, opening); return opening;
  }
  async openNote(path: string): Promise<void> { const relative = this.git.vaultPath(path); if (relative === undefined) return; const file = this.app.vault.getAbstractFileByPath(relative); if (file instanceof TFile) await this.openVaultFile(file); }
  previewText(title: string, text: string): void { const modal = new Modal(this.app); modal.titleEl.textContent = title; el(modal.contentEl, 'pre', 'gp-text-preview', text); modal.open(); }
  createBranch(start = 'HEAD'): void { new PromptModal(this.app, t('refs.createSwitch'), [{ label: t('refs.branchName') }, { label: t('refs.startCommit'), value: start }], values => this.run(t('command.createBranch'), () => this.git.branch('create', values[0], values[1]))).open(); }
  createTag(start = 'HEAD'): void { new PromptModal(this.app, t('refs.createTag'), [{ label: t('refs.tagName') }, { label: t('refs.targetCommit'), value: start }], values => this.run(t('refs.createTag'), () => this.git.tag('create', values[0], values[1]))).open(); }
  confirmIntegrate(operation: Operation, ref?: string): void {
    const accept = (value: string) => new ConfirmModal(this.app, t('common.confirmAction', { p0: operation }), t('refs.integrateDescription', { p0: operation, p1: value }), () => this.run(operation, async () => { await this.flushEditors(); await this.git.integrate(operation, value); })).open();
    if (ref) accept(ref); else new PromptModal(this.app, operation, [{ label: t('refs.targetRef') }], values => accept(values[0])).open();
  }
  compareRefs(left = 'HEAD', right = ':worktree'): void {
    new PromptModal(this.app, t('command.compare'), [{ label: t('common.repoFilePath'), value: this.currentPath() ?? '' }, { label: t('diff.leftRevision'), value: left }, { label: t('diff.rightRevision'), value: right }], async values => {
      const revision = (s: string): Revision => s === ':index' ? INDEX : s === ':worktree' ? WORKTREE : { kind: 'commit', ref: s };
      await this.openDiff(values[0], revision(values[1]), revision(values[2]));
    }).open();
  }
  confirmDiscard(paths: string[]): void { new ConfirmModal(this.app, t('discard.title'), t('discard.description', { p0: paths.join('\n') }), () => this.run(t('discard.action'), async () => { await this.flushEditors(); await this.git.discard(paths); })).open(); }
  async network(action: 'fetch' | 'pull' | 'push'): Promise<void> {
    if (action === 'push' && !this.controller.status?.upstream) {
      const remotes = await this.git.remotes(); new PromptModal(this.app, t('network.setUpstream'), [{ label: t('network.remoteName'), value: remotes[0]?.name || 'origin' }, { label: t('network.remoteBranch'), value: this.controller.status?.branch || 'main' }], values => this.run(t('network.push'), () => this.git.network('push', values[0], values[1]))).open(); return;
    }
    await this.run(action, async () => { await this.flushEditors(); await this.git.network(action); });
  }
  repositoryMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle(t('refs.newBranch')).setIcon('git-branch').onClick(() => this.createBranch())); menu.addItem(i => i.setTitle(t('refs.createTag')).setIcon('tag').onClick(() => this.createTag()));
    for (const operation of ['merge', 'rebase', 'cherry-pick', 'revert'] as const) menu.addItem(i => i.setTitle(operation).onClick(() => this.confirmIntegrate(operation)));
    menu.addSeparator(); menu.addItem(i => i.setTitle(t('stash.manage')).onClick(() => void this.openWorkbench('stash'))); menu.addItem(i => i.setTitle(t('network.manageRemotes')).onClick(() => void this.manageRemotes()));
    menu.addItem(i => i.setTitle(t('network.sync')).onClick(() => void this.run(t('network.sync'), async () => { await this.git.network('fetch'); await this.git.network('pull'); await this.git.network('push'); })));
    menu.addItem(i => i.setTitle(t('settings.checkGit')).onClick(async () => this.previewText(t('settings.gitDiagnostics'), await this.git.diagnostics())));
    menu.showAtPosition({ x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom });
  }
  async manageRemotes(): Promise<void> {
    const modal = new Modal(this.app); modal.titleEl.textContent = t('network.manageRemotes');
    for (const remote of await this.git.remotes()) {
      const row = el(modal.contentEl, 'div', 'gp-remote-row'); el(row, 'strong', '', remote.name); el(row, 'code', '', remote.url);
      button(row, t('network.checkConnection'), async () => new Notice(await this.git.testConnection(remote.name)));
      button(row, t('network.edit'), () => new PromptModal(this.app, t('network.editUrl'), [{ label: 'URL', value: remote.url }], values => this.run(t('network.editRemote'), () => this.git.remote('set-url', remote.name, values[0]))).open());
      button(row, t('network.remove'), () => new ConfirmModal(this.app, t('network.removeTitle'), remote.name, () => this.run(t('network.removeRemote'), () => this.git.remote('remove', remote.name))).open());
    }
    button(modal.contentEl, t('network.addRemote'), () => new PromptModal(this.app, t('network.addRemote'), [{ label: t('common.name'), value: 'origin' }, { label: 'URL' }], values => this.run(t('network.addRemote'), () => this.git.remote('add', values[0], values[1]))).open()); modal.open();
  }
  onunload(): void { this.unloaded = true; if (this.autoTimer) window.clearInterval(this.autoTimer); this.controller?.dispose(); }
}
class GitWorkbenchSettings extends PluginSettingTab {
  constructor(private plugin: GitWorkbench) { super(plugin.app, plugin); }
  display(): void {
    const parent = this.containerEl; parent.replaceChildren(); el(parent, 'h2', '', 'Git Workbench');
    new Setting(parent).setName('语言 / Language').setDesc(t('settings.languageHint')).setClass('gp-language-setting').addDropdown(dropdown => dropdown
      .addOption('auto', t('settings.languageAuto')).addOption('zh-CN', '简体中文').addOption('en', 'English')
      .setValue(this.plugin.settings.language).onChange(async value => {
        this.plugin.settings.language = normalizeLanguageSetting(value);
        await this.plugin.persistSettings();
        new Notice(t('settings.languageReload'), 10000);
      }));
    new Setting(parent).setName(t('settings.diagnostics')).setDesc(t('settings.diagnosticsHint')).addButton(b => b.setButtonText(t('settings.check')).onClick(async () => this.plugin.previewText(t('settings.gitDiagnostics'), await this.plugin.git.diagnostics())));
    for (const [key, name, description] of [
      ['inlineBlame', t('settings.inlineBlame'), t('settings.inlineBlameHint')],
      ['fullBlame', t('settings.fullBlame'), t('settings.fullBlameHint')],
      ['gutter', t('settings.gutter'), t('settings.gutterHint')],
    ] as const) new Setting(parent).setName(name).setDesc(description).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => { this.plugin.settings[key] = value; await this.plugin.persistSettings(); this.plugin.controller.emit(); }));
    new Setting(parent).setName(t('settings.editIndex')).setDesc(t('settings.editIndexHint')).addToggle(toggle => toggle.setValue(this.plugin.settings.allowEditingStagedFiles).onChange(async value => {
      if (this.plugin.indexEdits.size) { toggle.setValue(this.plugin.settings.allowEditingStagedFiles); new Notice(t('settings.saveIndexFirst')); return; }
      this.plugin.settings.allowEditingStagedFiles = value; await this.plugin.persistSettings(); this.plugin.controller.invalidate(); this.plugin.controller.emit();
    }));
    el(parent, 'h3', '', t('settings.aiTitle'));
    el(parent, 'p', 'gp-muted', t('settings.aiDescription'));
    new Setting(parent).setName(t('settings.aiProvider')).addDropdown(dropdown => dropdown
      .addOption('openai', 'OpenAI').addOption('deepseek', 'DeepSeek').addOption('custom', t('settings.aiCustom'))
      .setValue(this.plugin.settings.aiProvider).onChange(async value => {
        const provider = value as typeof this.plugin.settings.aiProvider;
        if (provider !== 'custom' && this.plugin.settings.aiModel === (provider === 'openai' ? DEFAULT_AI_MODELS.deepseek : DEFAULT_AI_MODELS.openai)) this.plugin.settings.aiModel = DEFAULT_AI_MODELS[provider];
        this.plugin.settings.aiProvider = provider; await this.plugin.persistSettings(); this.display();
      }));
    new Setting(parent).setName(t('settings.aiUrl')).setDesc(t('settings.aiUrlHint')).addText(t => t.setValue(this.plugin.settings.aiBaseUrl).onChange(async value => { this.plugin.settings.aiBaseUrl = value.trim(); await this.plugin.persistSettings(); }));
    new Setting(parent).setName(t('settings.aiModel')).addText(t => t.setValue(this.plugin.settings.aiModel).onChange(async value => { this.plugin.settings.aiModel = value.trim(); await this.plugin.persistSettings(); }));
    new Setting(parent).setName('API Key').setDesc(t('settings.aiKeyHint')).addText(t => { t.inputEl.type = 'password'; t.setValue(this.plugin.aiApiKey()).onChange(value => this.plugin.setAiApiKey(value)); });
    new Setting(parent).setName(t('settings.aiMaxDiff')).setDesc(t('settings.aiMaxDiffHint')).addText(t => t.setValue(String(this.plugin.settings.aiMaxDiffChars)).onChange(async value => { const n = Number(value); if (!Number.isFinite(n) || n < 1000 || n > 500000) return; this.plugin.settings.aiMaxDiffChars = Math.round(n); await this.plugin.persistSettings(); }));
    new Setting(parent).setName(t('settings.aiPrompt')).setDesc(t('settings.aiPromptHint')).setClass('gp-ai-prompt').addTextArea(field => {
      field.inputEl.rows = 16; field.inputEl.setAttribute('aria-label', t('settings.aiPromptLabel'));
      field.setValue(this.plugin.settings.aiPrompt).onChange(async value => { this.plugin.settings.aiPrompt = value; await this.plugin.persistSettings(); });
    }).addButton(b => b.setButtonText(t('settings.aiReset')).onClick(async () => { this.plugin.settings.aiPrompt = DEFAULT_SETTINGS.aiPrompt; await this.plugin.persistSettings(); this.display(); }));
    el(parent, 'h3', '', t('settings.autoBackup')); el(parent, 'p', 'gp-muted', t('settings.backupDescription'));
    new Setting(parent).setName(t('settings.enableBackup')).setDesc(t('settings.enableBackupHint')).addToggle(toggle => toggle.setValue(this.plugin.settings.autoBackup).onChange(async value => { this.plugin.settings.autoBackup = value; await this.plugin.persistSettings(); this.plugin.configureAutomation(); this.plugin.controller.emit(); this.display(); }));
    for (const [key, name] of [['autoCommit', t('settings.autoCommit')], ['autoSync', t('settings.autoSync')], ['pullOnStartup', t('settings.pullOnStartup')]] as const) new Setting(parent).setName(name).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => { this.plugin.settings[key] = value; await this.plugin.persistSettings(); this.plugin.configureAutomation(); }));
    new Setting(parent).setName(t('settings.interval')).addText(t => t.setValue(String(this.plugin.settings.intervalMinutes)).onChange(async value => { const n = Number(value); if (!Number.isFinite(n) || n < 1 || n > 1440) return; this.plugin.settings.intervalMinutes = n; await this.plugin.persistSettings(); this.plugin.configureAutomation(); }));
    new Setting(parent).setName(t('settings.commitTemplate')).setDesc(t('settings.commitTemplateHint')).addText(t => t.setValue(this.plugin.settings.commitTemplate).onChange(async value => { this.plugin.settings.commitTemplate = value || DEFAULT_SETTINGS.commitTemplate; await this.plugin.persistSettings(); }));
    if (this.plugin.settings.autoBackup && this.plugin.controller.automationPaused) new Setting(parent).setName(t('settings.backupPaused')).setDesc(t('settings.backupPausedHint')).addButton(b => b.setButtonText(t('settings.resumeBackup')).onClick(() => { this.plugin.controller.automationPaused = false; this.plugin.controller.emit(); this.display(); }));
  }
}
