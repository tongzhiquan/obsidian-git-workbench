import { formatNumber, t } from '../i18n';
import { ChangeSet, Compartment, EditorState, Transaction, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { MergeView, diff as textDiff, getChunks, getOriginalDoc, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge';
import { Notice, setIcon, setTooltip } from 'obsidian';
import type GitWorkbench from '../main';
import { revisionLabel, type FileDiff } from '../types';
import { button, ConfirmModal, el, empty } from './common';
import { comparisonSelection } from './diff-selection';
import { lineEdits, selectedText } from '../git/line-edits';
import { DiffLineActions, type LineAction } from './diff-actions';

function tool(parent: HTMLElement, label: string, icon: string, action: () => unknown): HTMLButtonElement {
  const control = button(parent, '', action, 'gp-diff-tool');
  setTooltip(control, label); setIcon(control, icon); return control;
}

export interface DiffRenderer {
  destroy(): void;
  update(diff: FileDiff): boolean;
  isBusy(): boolean;
  syncStatus(): void;
}
function changesFor(doc: Text, text: string): ChangeSet {
  const before = doc.toString(), after = text.replace(/\r\n/g, '\n');
  return ChangeSet.of(textDiff(before, after, { timeout: 80 }).map(change => ({ from: change.fromA, to: change.toA, insert: after.slice(change.fromB, change.toB) })), doc.length);
}

export function renderDiff(parent: HTMLElement, diff: FileDiff, plugin: GitWorkbench, onUpdated: (generation?: number) => void): DiffRenderer {
  const mode = plugin.settings.diffMode;
  const bar = el(parent, 'div', 'gp-diff-bar');
  el(bar, 'strong', 'gp-path', diff.path);
  el(bar, 'span', 'gp-muted', `${revisionLabel(diff.left)} → ${revisionLabel(diff.right)}`);
  const tools = el(bar, 'div', 'gp-diff-tools');
  tool(tools, t('diff.openFile'), 'external-link', () => plugin.openComparisonFile(diff.path));
  const previous = tool(tools, t('diff.previous'), 'arrow-up', () => navigate(-1));
  const next = tool(tools, t('diff.next'), 'arrow-down', () => navigate(1));
  const count = el(tools, 'span', 'gp-diff-count'); count.setAttribute('aria-live', 'polite');
  let folded = false;
  const fold = tool(tools, t('diff.collapse'), 'fold-vertical', () => {
    folded = !folded; fold.setAttribute('aria-pressed', String(folded));
    setTooltip(fold, folded ? t('diff.expand') : t('diff.collapse'));
    if (merge) merge.reconfigure({ collapseUnchanged: folded ? { margin: 3, minSize: 4 } : undefined });
    else right?.dispatch({ effects: unified.reconfigure(unifiedExtension()) });
  }); fold.setAttribute('aria-pressed', 'false');
  button(bar, plugin.settings.diffMode === 'split' ? t('diff.unified') : t('diff.split'), async () => { plugin.settings.diffMode = plugin.settings.diffMode === 'split' ? 'unified' : 'split'; await plugin.persistSettings(); await plugin.openDiff(diff.path, diff.left, diff.right, diff.oldPath); });

  const target = diff.right.kind === 'index' || diff.right.kind === 'worktree' ? diff.right.kind : undefined;
  const targetName = target === 'index' ? t('revision.index') : t('revision.worktree');
  const pending = target ? plugin.edits(target).get(diff.path) : undefined;
  let base = pending?.base ?? diff.after;
  const mixedEol = () => /\r\n/.test(base.text) && /(?<!\r)\n/.test(base.text) || /\r(?!\n)/.test(base.text);
  const canEdit = () => !!target && !base.binary && !base.large && !mixedEol() && (target === 'worktree' || base.exists && /^100(644|755) [a-f0-9]+ 0\t/.test(base.indexEntry ?? '') && !base.indexEntry!.includes('\0'))
    && (target === 'worktree' || plugin.settings.allowEditingStagedFiles);
  let editable = canEdit(), saving = false, lineBusy = false, syncing = false, disposed = false, merge: MergeView | undefined, right: EditorView | undefined;
  let current = -1, rightColumn: HTMLElement | undefined, navigationView: EditorView | undefined;
  const unified = new Compartment(), editability = new Compartment(), editing = new Compartment();
  const fileAction = diff.stageable ?? (diff.left.kind === 'empty' && diff.right.kind === 'worktree' ? 'stage' : null);
  if (fileAction) button(bar, fileAction === 'stage' ? t('source.stageFile') : t('source.unstage'), () => {
    if (plugin.indexEdits.has(diff.path) || plugin.worktreeEdits.has(diff.path)) { new Notice(t('diff.saveFirst')); return; }
    return plugin.run(fileAction === 'stage' ? t('source.stage') : t('source.unstage'), async () => { if (fileAction === 'stage') { await plugin.flushEditors(); await plugin.git.stage([diff.path]); } else await plugin.git.unstage([diff.path]); });
  });
  if (diff.before.binary || diff.after.binary || diff.before.large || diff.after.large) {
    previous.disabled = next.disabled = fold.disabled = true;
    if (pending) button(bar, t('diff.viewUnsaved'), () => plugin.previewText(t('diff.unsavedTitle', { p0: targetName }), pending.text));
    empty(parent, t('diff.metadataTitle'), t('diff.metadataDescription', { p0: formatNumber(diff.before.size), p1: formatNumber(diff.after.size) })); return { destroy() {}, update: () => false, isBusy: () => false, syncStatus() {} };
  }
  const details = el(parent, 'div', 'gp-diff-meta');
  function updateDetails(): void {
    details.replaceChildren();
    el(details, 'span', '', `${diff.before.exists ? t('diff.original') : t('diff.missing')} ${formatNumber(diff.before.size)} B`);
    el(details, 'span', '', `${diff.after.exists ? t('diff.modified') : t('diff.missing')} ${formatNumber(diff.after.size)} B`);
    if (diff.before.text && !diff.before.text.endsWith('\n') || diff.after.text && !diff.after.text.endsWith('\n')) el(details, 'span', 'gp-muted', t('diff.noFinalNewline'));
  }
  updateDetails();
  const status = el(parent, 'div', 'gp-diff-edit-status'); status.setAttribute('role', 'status');
  let model = diff.lineActions ? lineEdits(diff.before.text, diff.after.text) : undefined;
  const actions = model && diff.stageable ? new DiffLineActions(model, diff.stageable, parent,
    () => !model || saving || lineBusy || disposed || plugin.controller.busy || plugin.indexEdits.has(diff.path) || plugin.worktreeEdits.has(diff.path), invokeLines, plugin.settings.stagingMode) : undefined;
  const stagingMode = actions ? el(tools, 'div', 'gp-staging-mode') : undefined;
  if (stagingMode) {
    stagingMode.setAttribute('role', 'group'); stagingMode.setAttribute('aria-label', t('diff.stagingMode'));
    for (const [value, label, description] of [['line', t('diff.line'), t('diff.lineStaging')], ['block', t('diff.block'), t('diff.blockStaging')]] as const) {
      const control = button(stagingMode, label, async () => {
        if (saving || lineBusy || plugin.controller.busy || plugin.settings.stagingMode === value) return;
        plugin.settings.stagingMode = value; actions?.setMode(value); await plugin.persistSettings(); updateStatus();
      }, 'gp-staging-option');
      control.dataset.stagingMode = value; control.setAttribute('aria-label', description); setTooltip(control, description);
    }
  }
  async function invokeLines(action: LineAction, ids: number[]): Promise<void> {
    if (!model || !ids.length || disposed) return;
    if (saving || lineBusy || plugin.controller.busy) return;
    if (plugin.indexEdits.has(diff.path) || plugin.worktreeEdits.has(diff.path)) { new Notice(t('diff.saveFirst')); return; }
    const work = async () => {
      const generation = plugin.controller.generation; let applied = false;
      lineBusy = true; updateStatus();
      try {
        await plugin.run(action === 'stage' ? t('diff.stageSelected') : action === 'unstage' ? t('diff.unstageSelected') : t('diff.restoreWorking'), async () => {
          await plugin.flushEditors();
          let next: FileDiff;
          if (action === 'restore') {
            await plugin.saveWorkingFile(diff.path, selectedText(model!, ids, true), diff.after, diff.before);
            next = await plugin.git.diff(diff.path, diff.left, diff.right, diff.oldPath);
          } else next = await plugin.git.applyLines(diff, ids);
          if (!disposed) applied = update(next);
        });
      } finally {
        lineBusy = false;
        if (!disposed) {
          updateStatus(); onUpdated(applied && !plugin.controller.error ? generation + 1 : undefined);
        }
      }
    };
    if (action === 'restore') new ConfirmModal(plugin.app, t('diff.restoreTitle', { p0: ids.length }), t('diff.restoreDescription'), work, t('diff.restore')).open();
    else await work();
  }
  let save: HTMLButtonElement | undefined, reloadControl: HTMLButtonElement | undefined;
  function reloadFile(): void {
    const reload = async () => { plugin.setEdit(diff.path, target!, undefined); await plugin.openDiff(diff.path, diff.left, diff.right, diff.oldPath); };
    if (plugin.edits(target!).has(diff.path)) new ConfirmModal(plugin.app, t('diff.reloadTitle'), t('diff.reloadDescription', { p0: targetName }), reload, t('diff.discardReload')).open();
    else void reload();
  }
  function syncEditing(): void {
    if (!right) return;
    const allowed = canEdit();
    if (editable !== allowed) { editable = allowed; right.dispatch({ effects: editing.reconfigure(editingExtensions()) }); }
    const readOnly = saving || lineBusy || !editable;
    if (right.state.readOnly !== readOnly) right.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(readOnly)) });
    if (editable && !save) {
      save = button(tools, target === 'index' ? t('diff.saveIndex') : base.exists ? t('diff.saveWorktree') : t('diff.recreate'), () => saveChanges(), `mod-cta gp-save-diff gp-save-${target}`);
      reloadControl = tool(tools, t('diff.reload'), 'refresh-cw', reloadFile);
    } else if (!editable) { save?.remove(); reloadControl?.remove(); save = reloadControl = undefined; }
  }
  function updateStatus(): void {
    if (disposed || !right) return;
    syncEditing();
    if (rightColumn) rightColumn.textContent = `${revisionLabel(diff.right)} · ${!right.state.readOnly && canEdit() ? t('diff.editable') : t('diff.readOnly')}`;
    const chunks = getChunks(right.state)?.chunks ?? [];
    if (current >= chunks.length) current = -1;
    count.textContent = chunks.length ? t('diff.changeCount', { p0: current >= 0 ? current + 1 : '–', p1: chunks.length }) : t('diff.noChanges');
    previous.disabled = next.disabled = chunks.length === 0;
    const edit = target ? plugin.edits(target).get(diff.path) : undefined;
    const dirty = !!edit;
    if (save) save.disabled = saving || !dirty;
    if (stagingMode) for (const control of stagingMode.querySelectorAll<HTMLButtonElement>('[data-staging-mode]')) {
      control.disabled = saving || lineBusy || plugin.controller.busy;
      control.setAttribute('aria-pressed', String(control.dataset.stagingMode === plugin.settings.stagingMode));
    }
    actions?.syncDisabled();
    const stale = !!edit && (target === 'index' ? edit.base.indexEntry !== diff.after.indexEntry : edit.base.exists !== diff.after.exists || edit.base.text !== diff.after.text || diff.after.binary || diff.after.large);
    parent.classList.toggle('is-modified', dirty);
    status.classList.toggle('gp-danger', stale);
    if (saving) status.textContent = t('diff.saving', { p0: targetName });
    else if (stale) status.textContent = t('diff.stale', { p0: targetName });
    else if (editable && dirty) status.textContent = t('diff.unsavedStatus', { p0: targetName });
    else if (mixedEol() && target) status.textContent = t('diff.mixedEol');
    else if (target === 'index' && !diff.after.exists) status.textContent = t('diff.missingIndex');
    else status.textContent = '';
  }
  async function saveChanges(): Promise<void> {
    if (!editable || !canEdit() || !target || saving || lineBusy || !right || !plugin.edits(target).has(diff.path)) return;
    if (plugin.controller.busy) { new Notice(t('diff.busySave')); return; }
    const text = right.state.sliceDoc(); saving = true;
    right.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(true)) }); updateStatus();
    try {
      await plugin.run(t('diff.saveTarget', { p0: targetName }), async () => {
        if (target === 'index') await plugin.git.saveIndex(diff.path, text, base); else await plugin.saveWorkingFile(diff.path, text, base);
        const saved = await plugin.git.file(diff.path, diff.right);
        if (saved.text !== text || !saved.exists || saved.binary || saved.large) throw new Error(t('diff.changedAfterSave', { p0: targetName }));
        base = saved; diff.after = saved;
        plugin.setEdit(diff.path, target);
        model = diff.lineActions ? lineEdits(diff.before.text, saved.text) : undefined; actions?.replaceModel(model); updateDetails();
      });
    } finally {
      saving = false;
      if (!disposed) { right.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(false)) }); updateStatus(); }
    }
  }
  function navigate(direction: number): void {
    if (!right) return; const chunks = getChunks(right.state)?.chunks ?? []; if (!chunks.length) return;
    const view = navigationView ?? right, isLeft = view === merge?.a;
    const anchor = view.state.selection.main.head;
    const start = (chunk: typeof chunks[number]) => isLeft ? chunk.fromA : chunk.fromB;
    current = direction > 0 ? chunks.findIndex(chunk => start(chunk) > anchor) : -1;
    if (direction < 0) chunks.forEach((chunk, index) => { if (start(chunk) < anchor) current = index; });
    if (current < 0) current = direction > 0 ? 0 : chunks.length - 1;
    const chunk = chunks[current], position = Math.min(start(chunk), view.state.doc.length);
    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
    const other = merge && (isLeft ? merge.b : merge.a);
    if (other) other.dispatch({ effects: EditorView.scrollIntoView(Math.min(isLeft ? chunk.fromB : chunk.fromA, other.state.doc.length), { y: 'center' }) });
    view.focus(); updateStatus();
  }
  const shared: Extension[] = [EditorState.tabSize.of(4), keymap.of(defaultKeymap), EditorView.editable.of(true),
    EditorState.phrases.of({ '$ unchanged lines': t('diff.expandLines') }),
    EditorView.contentAttributes.compute([EditorState.readOnly], state => ({ 'aria-readonly': String(state.readOnly), 'tabindex': '0', 'spellcheck': 'false' })),
    EditorView.domEventHandlers({
      focus: (_event, view) => { navigationView = view; return false; },
      mousedown: (_event, view) => { navigationView = view; return false; },
      copy: (event, view) => {
        const text = comparisonSelection(view);
        if (!text || !event.clipboardData) return false;
        event.clipboardData.setData('text/plain', text); event.preventDefault(); return true;
      },
    }),
  ];
  const eol = base.text.includes('\r\n') ? '\r\n' : '\n';
  function editingExtensions(): Extension {
    return editable ? [history(), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.domEventHandlers({
      keydown: event => { if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || event.altKey) return false; event.preventDefault(); event.stopPropagation(); void saveChanges(); return true; },
    })] : [];
  }
  const rightExtensions: Extension[] = [shared, EditorState.lineSeparator.of(eol),
    EditorState.transactionFilter.of(transaction => transaction.docChanged && (saving || lineBusy || !canEdit()) ? [] : transaction),
    EditorView.contentAttributes.of({ 'aria-label': t('diff.contentLabel', { p0: targetName }) }),
    editability.of(EditorState.readOnly.of(!editable)),
    editing.of(editingExtensions()),
    EditorView.updateListener.of(update => {
      if (update.docChanged && editable && !syncing) {
        const text = update.state.sliceDoc(); plugin.setEdit(diff.path, target!, text === base.text ? undefined : { text, base }); current = -1;
      }
      queueMicrotask(updateStatus);
    }),
  ];
  const unifiedExtension = () => unifiedMergeView({ original: diff.before.text, mergeControls: false, highlightChanges: true, syntaxHighlightDeletions: false, collapseUnchanged: folded ? { margin: 3, minSize: 4 } : undefined, diffConfig: { timeout: 150 } });
  const body = el(parent, 'div', 'gp-diff-body gp-merge-body');
  const sideExtensions = (side: 'left' | 'right', unifiedMode = false): Extension => actions ? actions.extension(side, unifiedMode) : lineNumbers();
  if (plugin.settings.diffMode === 'split') {
    const columns = document.createElement('div'); columns.className = 'gp-diff-columns'; parent.insertBefore(columns, body);
    el(columns, 'span', '', t('diff.readOnlyColumn', { p0: revisionLabel(diff.left) })); rightColumn = el(columns, 'span');
    merge = new MergeView({ parent: body,
      a: { doc: diff.before.text, extensions: [shared, sideExtensions('left'), EditorState.readOnly.of(true), EditorView.contentAttributes.of({ 'aria-label': t('diff.leftContent') })] },
      b: { doc: pending?.text ?? diff.after.text, extensions: [rightExtensions, sideExtensions('right')] },
      highlightChanges: true, gutter: true, diffConfig: { timeout: 150 },
    }); right = merge.b;
  } else right = new EditorView({ parent: body, doc: pending?.text ?? diff.after.text, extensions: [rightExtensions, sideExtensions('right', true), unified.of(unifiedExtension())] });
  function update(next: FileDiff): boolean {
    if (disposed || !right || saving || plugin.indexEdits.has(diff.path) || plugin.worktreeEdits.has(diff.path)) return false;
    const nextModel = next.lineActions ? lineEdits(next.before.text, next.after.text) : undefined;
    if (mode !== plugin.settings.diffMode || next.before.binary || next.after.binary || next.before.large || next.after.large || Boolean(actions) !== Boolean(nextModel && next.stageable) || next.after.text && (next.after.text.includes('\r\n') ? '\r\n' : '\n') !== eol) return false;
    const views = merge ? [merge.a, merge.b] : [right];
    const scrolling = [merge?.dom, ...views.map(view => view.scrollDOM), parent.closest<HTMLElement>('.gp-workbench-body')].filter((node): node is HTMLElement => !!node);
    const scroll = scrolling.map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
    syncing = true;
    try {
      diff = next; base = next.after; model = nextModel;
      if (merge) merge.a.dispatch({ changes: changesFor(merge.a.state.doc, next.before.text), annotations: Transaction.addToHistory.of(false) });
      const effects = merge ? [] : [originalDocChangeEffect(right.state, changesFor(getOriginalDoc(right.state), next.before.text))];
      right.dispatch({ changes: changesFor(right.state.doc, next.after.text), effects, annotations: Transaction.addToHistory.of(false), filter: false });
      actions?.replaceModel(model); updateDetails(); updateStatus();
      const restore = () => { if (!disposed) for (const { node, top, left } of scroll) { node.scrollTop = top; node.scrollLeft = left; } };
      restore(); right.requestMeasure({ key: parent, read: () => null, write: restore });
    } finally { syncing = false; }
    return true;
  }
  updateStatus();
  return { update, isBusy: () => saving || lineBusy, syncStatus: updateStatus, destroy: () => { disposed = true; actions?.destroy(); if (merge) merge.destroy(); else right?.destroy(); } };
}
