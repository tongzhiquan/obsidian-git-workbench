import { formatDate, t } from '../i18n';
import { ItemView, Menu, Notice, Scope, setIcon, type WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type GitWorkbench from '../main';
import { EMPTY, INDEX, WORKTREE, type Commit, type GitRef, type LogFilter, type Revision } from '../types';
import { layoutGraph, type GraphRow } from '../git/graph';
import { button, ConfirmModal, date, el, empty, input, message, PromptModal, select, virtualList } from './common';
import { renderDiff, type DiffRenderer } from './diff';
import { renderConflict } from './conflict';
import { GIT_WORKBENCH_ICON } from './icon';
import { HistoryFilePicker } from './file-picker';
import { statusBadge } from './status';
import { comparisonSelection } from './diff-selection';
export const WORKBENCH = 'git-workbench-workbench';
type Tab = 'graph' | 'history' | 'diff' | 'conflict' | 'refs' | 'stash';
export class WorkbenchView extends ItemView {
  tab: Tab = 'graph';
  path = '';
  filter: LogFilter = {};
  commits: Commit[] = [];
  historyLimit = 200;
  selectedHash = '';
  left: Revision = INDEX;
  right: Revision = WORKTREE;
  oldPath = '';
  private unsubscribe?: () => void;
  private cleanups: (() => void)[] = [];
  private token = 0;
  private loadedGeneration = -1;
  private comparison?: DiffRenderer;
  private comparisonRefresh?: Promise<void>;
  private comparisonAgain = false;
  private graphMore = true;
  private graphGeneration = -1;
  private body!: HTMLElement;
  private statusLine?: HTMLElement;
  constructor(leaf: WorkspaceLeaf, public plugin: GitWorkbench) {
    super(leaf); this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 's', event => {
      const save = this.contentEl.querySelector<HTMLButtonElement>('.gp-save-diff');
      if (!save) return;
      event.preventDefault(); save.click(); return false;
    });
    const focusedEditor = () => {
      const node = this.contentEl.ownerDocument.activeElement?.closest('.cm-editor');
      return node && this.contentEl.querySelector('.gp-merge-body')?.contains(node) ? EditorView.findFromDOM(node as HTMLElement) : undefined;
    };
    this.scope.register(['Mod'], 'a', event => {
      const view = focusedEditor(); if (!view) return;
      event.preventDefault(); view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); return false;
    });
    this.scope.register(['Mod'], 'c', event => {
      const view = focusedEditor(); if (!view) return;
      const text = comparisonSelection(view);
      if (!text) return;
      event.preventDefault(); void navigator.clipboard.writeText(text).catch(error => new Notice(t('error.copy', { p0: error.message }))); return false;
    });
  }
  getViewType(): string { return WORKBENCH; }
  getDisplayText(): string { return 'Git Workbench'; }
  getIcon(): string { return GIT_WORKBENCH_ICON; }
  async onOpen(): Promise<void> {
    this.containerEl.addClass('gp-container');
    this.unsubscribe = this.plugin.controller.subscribe(() => {
      this.updateStatus();
      this.comparison?.syncStatus();
      if (this.loadedGeneration !== this.plugin.controller.generation && !this.plugin.controller.busy && this.tab !== 'conflict') {
        if (this.tab === 'diff' && this.comparison) {
          if (!this.comparison.isBusy() && !this.hasComparisonEdits()) void this.refreshComparison();
        } else void this.render();
      }
    }); await this.render();
  }
  private hasComparisonEdits(): boolean { return this.plugin.indexEdits.has(this.path) || this.plugin.worktreeEdits.has(this.path); }
  private refreshComparison(): Promise<void> {
    if (this.comparisonRefresh) { this.comparisonAgain = true; return this.comparisonRefresh; }
    this.comparisonRefresh = (async () => {
      do {
        this.comparisonAgain = false;
        const comparison = this.comparison, token = this.token, generation = this.plugin.controller.generation;
        if (this.tab !== 'diff' || !comparison || comparison.isBusy() || this.hasComparisonEdits() || generation === this.loadedGeneration) break;
        try {
          const diff = await this.plugin.controller.diff(this.path, this.left, this.right, this.oldPath || this.path);
          if (token !== this.token || comparison !== this.comparison) break;
          if (generation !== this.plugin.controller.generation) { this.comparisonAgain = true; continue; }
          if (comparison.isBusy() || this.hasComparisonEdits()) break;
          if (!comparison.update(diff)) { await this.render(); break; }
          this.loadedGeneration = generation;
        } catch (error) { if (token === this.token && comparison === this.comparison) { this.loadedGeneration = generation; new Notice(t('error.refreshComparison', { p0: message(error) })); } }
      } while (this.comparisonAgain);
    })().finally(() => {
      this.comparisonRefresh = undefined;
      if (this.comparisonAgain) { this.comparisonAgain = false; void this.refreshComparison(); }
    });
    return this.comparisonRefresh;
  }
  async onClose(): Promise<void> { this.unsubscribe?.(); this.token++; this.comparisonAgain = false; this.comparison = undefined; this.cleanups.forEach(d => d()); this.cleanups = []; }
  async show(tab: Tab): Promise<void> { this.tab = tab; await this.render(); }
  async showHistory(path: string): Promise<void> { this.path = path; this.historyLimit = this.plugin.settings.pageSize; await this.show('history'); }
  async showDiff(path: string, left: Revision, right: Revision, oldPath = path): Promise<void> { this.path = path; this.oldPath = oldPath; this.left = left; this.right = right; await this.show('diff'); }
  async showConflict(path: string): Promise<void> { this.path = path; await this.show('conflict'); }
  updateStatus(): void {
    if (!this.statusLine) return; const status = this.plugin.controller.status; const c = this.plugin.controller;
    this.statusLine.textContent = c.busy ? c.message + '…' : c.error ? c.error : status ? t('workbench.repoStatus', { p0: status.branch === '(detached)' ? 'detached ' + status.head.slice(0, 8) : status.branch, p1: status.ahead, p2: status.behind, p3: status.files.length }) : t('workbench.disconnected');
    this.statusLine.classList.toggle('gp-danger', !!c.error);
  }
  async render(): Promise<void> {
    const token = ++this.token; this.cleanups.forEach(d => d()); this.cleanups = []; this.comparison = undefined; this.contentEl.replaceChildren(); this.contentEl.className = 'view-content gp-workbench';
    this.loadedGeneration = this.plugin.controller.generation;
    const header = el(this.contentEl, 'header', 'gp-header'); const brand = el(header, 'div', 'gp-brand'); setIcon(el(brand, 'span', 'gp-brand-icon'), GIT_WORKBENCH_ICON); el(brand, 'strong', '', 'Git Workbench');
    const root = this.plugin.git.repo?.root; el(brand, 'span', 'gp-root', root ? root.replace(/\\/g, '/').split('/').at(-1)! : t('common.workbench'));
    const actions = el(header, 'div', 'gp-actions'); button(actions, t('source.title'), () => this.plugin.openSourceControl()); button(actions, t('common.refresh'), () => this.plugin.controller.refresh()); button(actions, t('workbench.repoMenu'), ( ) => this.plugin.repositoryMenu(actions));
    this.statusLine = el(this.contentEl, 'div', 'gp-repo-status'); this.updateStatus(); if (root) this.statusLine.title = root;
    const tabs = el(this.contentEl, 'nav', 'gp-tabs');
    for (const [key, label] of [['graph', t('graph.title')], ['history', t('history.title')], ['diff', t('diff.title')], ['refs', t('refs.title')], ['stash', 'Stash']] as [Tab, string][]) button(tabs, label, async () => { if (key === 'history' && !this.path) this.path = this.plugin.currentPath() ?? ''; await this.show(key); }, this.tab === key ? 'is-active' : '');
    if (this.tab === 'conflict') button(tabs, t('conflict.resolve'), () => {}, 'is-active');
    this.body = el(this.contentEl, 'div', 'gp-workbench-body');
    if (!this.plugin.git.repo) { empty(this.body, t('workbench.connectTitle'), this.plugin.controller.error || t('workbench.connectDescription')); button(this.body, t('workbench.init'), () => new ConfirmModal(this.app, t('workbench.initTitle'), t('workbench.initDescription', { p0: this.plugin.git.vault }), () => this.plugin.run(t('workbench.initAction'), () => this.plugin.git.init())).open(), 'mod-cta'); return; }
    try {
      if (this.tab === 'graph') await this.renderGraph(token);
      else if (this.tab === 'history') await this.renderHistory(token);
      else if (this.tab === 'diff') await this.renderComparison(token);
      else if (this.tab === 'conflict') { const conflict = await this.plugin.git.conflict(this.path); if (token === this.token) renderConflict(this.body, conflict, this.plugin); }
      else if (this.tab === 'refs') await this.renderRefs(token);
      else if (this.tab === 'stash') await this.renderStashes(token);
    } catch (e) { if (token === this.token) empty(this.body, t('common.loadFailed'), message(e)); }
  }
  private async renderGraph(token: number): Promise<void> {
    const filters = el(this.body, 'div', 'gp-filters');
    const fields: [keyof LogFilter, string, string?][] = [['message', t('graph.search')], ['author', t('common.author')], ['path', t('common.repoPath')], ['since', t('graph.since'), 'date'], ['until', t('graph.until'), 'date'], ['ref', t('graph.refFilter')]];
    const controls = fields.map(([key, label, type]) => ({ key, control: input(filters, label, this.filter[key] ?? '', type) }));
    const apply = async () => { this.filter = Object.fromEntries(controls.filter(f => f.control.value).map(f => [f.key, f.control.value])); this.commits = []; await this.render(); };
    button(filters, t('graph.filter'), apply); controls.forEach(({ control }) => control.onkeydown = e => { if (e.key === 'Enter') void apply(); });
    if (this.filter.path || this.filter.author || this.filter.message || this.filter.since || this.filter.until) el(this.body, 'p', 'gp-filter-note', t('graph.filterNotice'));
    const area = el(this.body, 'div', 'gp-graph-area'); const list = el(area, 'div', 'gp-graph-list'); const detail = el(area, 'aside', 'gp-commit-detail');
    const generation = this.plugin.controller.generation;
    const reload = this.graphGeneration !== generation || !this.commits.length;
    const commits = reload ? await this.plugin.controller.log(this.filter, 0, this.plugin.settings.pageSize) : this.commits; if (token !== this.token) return;
    this.commits = commits; this.graphGeneration = generation; if (reload) this.graphMore = commits.length === this.plugin.settings.pageSize;
    const draw = () => {
      list.replaceChildren(); const graph = layoutGraph(this.commits); const width = Math.min(260, Math.max(56, ...graph.map(g => g.width * 18 + 16)));
      const heading = el(list, 'div', 'gp-graph-heading'); const marker = el(heading, 'span', '', t('graph.branches')); marker.style.width = `${width}px`; el(heading, 'span', '', t('graph.commitCount', { p0: this.commits.length })); el(heading, 'span', '', t('graph.authorDate'));
      if (!this.commits.length) empty(list, t('graph.noMatches'), t('graph.firstCommitHint'));
      else this.cleanups.push(virtualList(list, this.commits, 56, (row, commit, index) => {
        row.classList.add('gp-commit-row'); if (commit.hash === this.selectedHash) row.classList.add('is-selected'); row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', commit.subject);
        this.drawGraph(row, graph[index], width, commit.parents.length > 1);
        const summary = el(row, 'div', 'gp-commit-summary'); const refs = el(summary, 'div', 'gp-commit-refs');
        commit.refs.forEach(ref => el(refs, 'span', ref.startsWith('HEAD') ? 'gp-ref gp-head' : ref.startsWith('tag:') ? 'gp-ref gp-tag' : 'gp-ref', ref));
        el(summary, 'span', 'gp-commit-subject', commit.subject); const info = el(row, 'div', 'gp-commit-meta'); el(info, 'span', '', commit.author); el(info, 'span', 'gp-muted', formatDate(commit.date)); el(row, 'code', 'gp-hash', commit.hash.slice(0, 7));
        row.onclick = () => { this.selectedHash = commit.hash; list.querySelectorAll('.is-selected').forEach(n => n.classList.remove('is-selected')); row.classList.add('is-selected'); void this.detail(detail, commit.hash); }; row.onkeydown = e => { if (e.key === 'Enter') row.click(); };
        row.oncontextmenu = e => { e.preventDefault(); this.commitMenu(commit, e); };
      }));
      const footer = el(list, 'div', 'gp-list-footer'); if (this.graphMore) button(footer, t('graph.loadMore'), async () => {
        const generation = this.plugin.controller.generation; const next = await this.plugin.controller.log(this.filter, this.commits.length, this.plugin.settings.pageSize); if (generation !== this.plugin.controller.generation || token !== this.token) return;
        this.commits.push(...next); this.graphMore = next.length === this.plugin.settings.pageSize; this.cleanups.forEach(d => d()); this.cleanups = []; draw();
      });
    };
    draw(); if (this.selectedHash && commits.some(c => c.hash === this.selectedHash)) await this.detail(detail, this.selectedHash); else empty(detail, t('graph.selectCommit'), t('graph.detailHint'));
  }
  private drawGraph(parent: HTMLElement, row: GraphRow, width: number, merge: boolean): void {
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.classList.add('gp-graph'); svg.setAttribute('width', String(width)); svg.setAttribute('height', '56'); svg.setAttribute('viewBox', `0 0 ${width} 56`); svg.setAttribute('aria-hidden', 'true'); parent.appendChild(svg);
    const colors = ['#7c8aff', '#20bfa9', '#e9a34a', '#e777a1', '#58a6e8', '#b393f2', '#a5bb55', '#ec806a'];
    const incoming = document.createElementNS(ns, 'path'); incoming.setAttribute('d', `M${12 + row.lane * 18} 0 L${12 + row.lane * 18} 28`); incoming.setAttribute('stroke', colors[row.color]); incoming.setAttribute('stroke-width', '2'); svg.appendChild(incoming);
    for (const edge of row.edges) {
      const path = document.createElementNS(ns, 'path'); const x = 12 + edge.from * 18, y = 12 + edge.to * 18; path.setAttribute('d', edge.from === row.lane ? `M${x} 0 L${x} 28 C${x} 43 ${y} 42 ${y} 56` : `M${x} 0 C${x} 28 ${y} 28 ${y} 56`); path.setAttribute('stroke', colors[edge.color]); path.setAttribute('stroke-width', '2'); path.setAttribute('fill', 'none'); svg.appendChild(path);
    }
    const circle = document.createElementNS(ns, 'circle'); circle.setAttribute('cx', String(12 + row.lane * 18)); circle.setAttribute('cy', '28'); circle.setAttribute('r', merge ? '5' : '4'); circle.setAttribute('fill', merge ? 'var(--background-primary)' : colors[row.color]); circle.setAttribute('stroke', colors[row.color]); circle.setAttribute('stroke-width', '2'); svg.appendChild(circle);
  }
  private async detail(parent: HTMLElement, hash: string): Promise<void> {
    parent.replaceChildren(); el(parent, 'p', 'gp-muted', t('graph.loadingCommit'));
    try {
      const detail = await this.plugin.git.commitDetail(hash); if (!parent.isConnected || hash !== this.selectedHash && this.tab === 'graph') return; parent.replaceChildren();
      const { commit, files } = detail; el(parent, 'span', 'gp-eyebrow', 'COMMIT'); el(parent, 'h3', '', commit.subject); el(parent, 'code', 'gp-detail-hash', commit.hash);
      el(parent, 'p', 'gp-muted', `${commit.author} <${commit.email}>\n${date(commit.date)}`); if (commit.body && commit.body !== commit.subject) el(parent, 'pre', 'gp-commit-body', commit.body);
      const actions = el(parent, 'div', 'gp-actions'); button(actions, t('common.copySha'), () => navigator.clipboard.writeText(commit.hash)); button(actions, t('graph.compareHead'), () => this.plugin.compareRefs(commit.hash, 'HEAD'));
      if (commit.parents.length > 1) el(parent, 'p', 'gp-muted', t('graph.mergeNotice'));
      el(parent, 'h4', '', t('graph.changedFiles', { p0: files.length }));
      const box = el(parent, 'div', 'gp-changed-files');
      for (const file of files) {
        const b = button(box, '', () => this.plugin.openDiff(file.path, commit.parents.length ? { kind: 'commit', ref: commit.parents[0] } : EMPTY, { kind: 'commit', ref: commit.hash }, file.oldPath ?? file.path), 'gp-file-link');
        statusBadge(b, file.status); el(b, 'span', '', file.path);
        b.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
      }
    } catch (e) { parent.replaceChildren(); empty(parent, t('graph.readFailed'), message(e)); }
  }
  private commitMenu(commit: Commit, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem(i => i.setTitle(t('common.copyCommitSha')).setIcon('copy').onClick(() => void navigator.clipboard.writeText(commit.hash)));
    menu.addItem(i => i.setTitle(t('graph.branchFromCommit')).setIcon('git-branch').onClick(() => this.plugin.createBranch(commit.hash)));
    menu.addItem(i => i.setTitle(t('graph.tagCommit')).setIcon('tag').onClick(() => this.plugin.createTag(commit.hash)));
    for (const operation of ['cherry-pick', 'revert'] as const) menu.addItem(i => i.setTitle(operation).onClick(() => this.plugin.confirmIntegrate(operation, commit.hash)));
    menu.showAtMouseEvent(event);
  }
  private async renderHistory(token: number): Promise<void> {
    const toolbar = el(this.body, 'div', 'gp-filters'); const path = input(toolbar, t('common.repoFilePath'), this.path); button(toolbar, t('history.view'), async () => { this.path = path.value; this.historyLimit = this.plugin.settings.pageSize; await this.render(); });
    const picker = button(toolbar, t('history.chooseFile'), async () => {
      const candidates = [...new Set([...(await this.plugin.git.historyFiles()), ...this.app.vault.getFiles().map(file => this.plugin.git.repoPath(file.path))])];
      candidates.sort((a, b) => Number(this.plugin.git.vaultPath(a) === undefined) - Number(this.plugin.git.vaultPath(b) === undefined) || a.localeCompare(b));
      if (token !== this.token) return;
      new HistoryFilePicker(this.plugin, candidates, selected => this.showHistory(selected)).open();
    }, 'gp-select-history-file');
    picker.title = t('history.searchTooltip');
    button(toolbar, t('history.currentNote'), async () => { this.path = this.plugin.currentPath() ?? ''; await this.render(); });
    if (!this.path) { empty(this.body, t('history.selectNote'), t('history.selectHint')); return; }
    const commits = await this.plugin.controller.history(this.path, this.historyLimit); if (token !== this.token) return;
    el(this.body, 'p', 'gp-history-path', this.path); if (!commits.length) { empty(this.body, t('history.empty')); return; }
    const comparison = el(this.body, 'div', 'gp-history-compare'); let leftIndex = commits.length > 1 ? 1 : 0, rightIndex = 0;
    const options: [string, string][] = commits.map((c, i) => [String(i), `${c.hash.slice(0, 7)} · ${c.subject}`]);
    el(comparison, 'span', '', t('diff.compare')); select(comparison, options, String(leftIndex), value => leftIndex = +value); el(comparison, 'span', '', '→'); select(comparison, options, '0', value => rightIndex = +value);
    button(comparison, t('history.compareSelected'), () => this.plugin.openDiff(commits[rightIndex].path ?? this.path, { kind: 'commit', ref: commits[leftIndex].hash }, { kind: 'commit', ref: commits[rightIndex].hash }, commits[leftIndex].path ?? this.path));
    const list = el(this.body, 'div', 'gp-history-list');
    this.cleanups.push(virtualList(list, commits, 90, (row, commit) => {
      row.classList.add('gp-history-row'); const summary = el(row, 'div', 'gp-history-summary'); el(summary, 'strong', '', commit.subject); el(summary, 'span', 'gp-muted', `${commit.hash.slice(0, 7)} · ${commit.author} · ${date(commit.date)}`); if (commit.path && commit.path !== this.path) el(summary, 'span', 'gp-muted', t('history.oldPath', { p0: commit.path }));
      const actions = el(row, 'div', 'gp-actions'); button(actions, t('history.compareWorktree'), () => this.plugin.openDiff(this.path, { kind: 'commit', ref: commit.hash }, WORKTREE, commit.path ?? this.path));
      button(actions, t('common.viewContent'), async () => { const file = await this.plugin.git.file(commit.path ?? this.path, { kind: 'commit', ref: commit.hash }); this.plugin.previewText(`${commit.path} · ${commit.hash.slice(0, 7)}`, file.binary || file.large ? t('history.contentHidden') : file.text); });
      button(actions, t('common.restore'), () => new ConfirmModal(this.app, t('history.restoreTitle'), t('history.restoreDescription', { p0: this.path, p1: commit.hash.slice(0, 12), p2: commit.path ?? this.path }), () => this.plugin.run(t('history.restoreAction'), () => this.plugin.git.restoreFile(this.path, { kind: 'commit', ref: commit.hash }, commit.path ?? this.path))).open());
    }));
    if (commits.length === this.historyLimit) button(this.body, t('history.loadMore'), async () => { this.historyLimit += this.plugin.settings.pageSize; await this.render(); });
  }
  private async renderComparison(token: number): Promise<void> {
    const toolbar = el(this.body, 'div', 'gp-filters'); const path = input(toolbar, t('common.repoPath'), this.path || this.plugin.currentPath() || '');
    const left = input(toolbar, t('diff.leftInput'), this.left.kind === 'commit' ? this.left.ref : ':' + this.left.kind); const right = input(toolbar, t('diff.rightInput'), this.right.kind === 'commit' ? this.right.ref : ':' + this.right.kind);
    const parse = (value: string): Revision => value === ':index' ? INDEX : value === ':worktree' ? WORKTREE : value === ':empty' ? EMPTY : { kind: 'commit', ref: value || 'HEAD' };
    button(toolbar, t('diff.compare'), async () => { this.path = path.value; this.oldPath = this.path; this.left = parse(left.value); this.right = parse(right.value); await this.render(); });
    if (!this.path) { empty(this.body, t('diff.chooseFile'), t('diff.chooseHint')); return; }
    const pane = el(this.body, 'div', 'gp-diff-pane'); const diff = await this.plugin.controller.diff(this.path, this.left, this.right, this.oldPath || this.path);
    if (token === this.token) {
      const comparison = renderDiff(pane, diff, this.plugin, generation => {
        if (comparison !== this.comparison) return;
        if (generation !== undefined) this.loadedGeneration = generation;
        if (this.loadedGeneration !== this.plugin.controller.generation) void this.refreshComparison();
      });
      this.comparison = comparison; this.cleanups.push(() => comparison.destroy());
    }
  }
  private async renderRefs(token: number): Promise<void> {
    const toolbar = el(this.body, 'div', 'gp-actions gp-toolbar'); button(toolbar, t('refs.newBranch'), () => this.plugin.createBranch()); button(toolbar, t('refs.newTag'), () => this.plugin.createTag()); button(toolbar, t('network.manageRemotes'), () => this.plugin.manageRemotes());
    const refs = await this.plugin.git.refs(); if (token !== this.token) return;
    for (const [type, title] of [['branch', t('refs.localBranches')], ['remote', t('network.remoteBranch')], ['tag', t('refs.tags')]] as const) {
      const section = el(this.body, 'section', 'gp-ref-section'); el(section, 'h3', '', title);
      for (const ref of refs.filter(r => r.type === type)) {
        const row = el(section, 'div', 'gp-ref-row'); el(row, 'span', ref.current ? 'gp-ref gp-head' : 'gp-ref', ref.current ? 'HEAD' : ref.type); el(row, 'strong', '', ref.name); el(row, 'code', 'gp-muted', ref.hash.slice(0, 7)); if (ref.upstream) el(row, 'span', 'gp-muted', `→ ${ref.upstream}`);
        const actions = el(row, 'div', 'gp-actions'); if (type === 'branch' && !ref.current) button(actions, t('refs.switch'), () => this.plugin.run(t('refs.switchBranch'), () => this.plugin.git.branch('switch', ref.name)));
        button(actions, t('refs.viewGraph'), async () => { this.filter = { ref: ref.fullName }; this.commits = []; await this.show('graph'); });
        button(actions, t('refs.actions'), () => this.refMenu(ref, actions));
      }
    }
  }
  private refMenu(ref: GitRef, anchor: HTMLElement): void {
    const menu = new Menu(); menu.addItem(i => i.setTitle(t('refs.branchHere')).onClick(() => this.plugin.createBranch(ref.fullName)));
    for (const operation of ['merge', 'rebase'] as const) menu.addItem(i => i.setTitle(operation).onClick(() => this.plugin.confirmIntegrate(operation, ref.fullName)));
    if (ref.type !== 'remote' && !ref.current) menu.addItem(i => i.setTitle(t('common.delete')).onClick(() => new ConfirmModal(this.app, t('refs.deleteTitle'), ref.name, () => this.plugin.run(t('refs.delete'), () => ref.type === 'tag' ? this.plugin.git.tag('delete', ref.name) : this.plugin.git.branch('delete', ref.name))).open()));
    menu.showAtPosition({ x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom });
  }
  private async renderStashes(token: number): Promise<void> {
    const toolbar = el(this.body, 'div', 'gp-actions gp-toolbar'); button(toolbar, t('stash.saveCurrent'), () => new PromptModal(this.app, t('stash.save'), [{ label: t('common.description'), value: 'Git Workbench stash' }], values => this.plugin.run(t('stash.save'), () => this.plugin.git.stash('save', values[0]))).open());
    const stashes = await this.plugin.git.stashes(); if (token !== this.token) return; if (!stashes.length) empty(this.body, t('stash.empty'));
    for (const stash of stashes) {
      const row = el(this.body, 'div', 'gp-stash-row'); el(row, 'strong', '', stash.ref); el(row, 'span', '', stash.subject); const actions = el(row, 'div', 'gp-actions');
      button(actions, t('common.viewContent'), async () => { this.selectedHash = stash.hash; const panel = el(this.body, 'div', 'gp-stash-detail'); await this.detail(panel, stash.hash); });
      for (const [action, label] of [['apply', t('stash.apply')], ['pop', t('stash.pop')], ['drop', t('common.delete')]] as const) button(actions, label, () => new ConfirmModal(this.app, t('common.confirmAction', { p0: `${label} Stash` }), `${stash.ref} · ${stash.subject}`, () => this.plugin.run(label + ' Stash', () => this.plugin.git.stash(action, stash.ref))).open());
    }
  }
}
