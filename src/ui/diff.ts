import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { MergeView, getChunks, unifiedMergeView } from '@codemirror/merge';
import { Notice, setIcon, setTooltip } from 'obsidian';
import type GitWorkbench from '../main';
import { HEAD, INDEX, EMPTY, revisionLabel, type FileDiff } from '../types';
import { button, ConfirmModal, el, empty } from './common';
import { comparisonSelection } from './diff-selection';

function tool(parent: HTMLElement, label: string, icon: string, action: () => unknown): HTMLButtonElement {
  const control = button(parent, '', action, 'gp-diff-tool');
  setTooltip(control, label); setIcon(control, icon); return control;
}

export function renderDiff(parent: HTMLElement, diff: FileDiff, plugin: GitWorkbench): () => void {
  const bar = el(parent, 'div', 'gp-diff-bar');
  el(bar, 'strong', 'gp-path', diff.path);
  el(bar, 'span', 'gp-muted', `${revisionLabel(diff.left)} → ${revisionLabel(diff.right)}`);
  const tools = el(bar, 'div', 'gp-diff-tools');
  tool(tools, '打开文件', 'external-link', () => plugin.openComparisonFile(diff.path));
  const previous = tool(tools, '上一处修改', 'arrow-up', () => navigate(-1));
  const next = tool(tools, '下一处修改', 'arrow-down', () => navigate(1));
  const count = el(tools, 'span', 'gp-diff-count'); count.setAttribute('aria-live', 'polite');
  let folded = false;
  const fold = tool(tools, '折叠未修改区域', 'fold-vertical', () => {
    folded = !folded; fold.setAttribute('aria-pressed', String(folded));
    setTooltip(fold, folded ? '展开未修改区域' : '折叠未修改区域');
    if (merge) merge.reconfigure({ collapseUnchanged: folded ? { margin: 3, minSize: 4 } : undefined });
    else right?.dispatch({ effects: unified.reconfigure(unifiedExtension()) });
  }); fold.setAttribute('aria-pressed', 'false');
  button(bar, plugin.settings.diffMode === 'split' ? '统一差异' : '并排差异', async () => { plugin.settings.diffMode = plugin.settings.diffMode === 'split' ? 'unified' : 'split'; await plugin.persistSettings(); await plugin.openDiff(diff.path, diff.left, diff.right, diff.oldPath); });

  const target = diff.right.kind === 'index' || diff.right.kind === 'worktree' ? diff.right.kind : undefined;
  const targetName = target === 'index' ? '暂存区' : '工作区';
  const pending = target ? plugin.edits(target).get(diff.path) : undefined;
  let base = pending?.base ?? diff.after;
  const mixedEol = /\r\n/.test(base.text) && /(?<!\r)\n/.test(base.text) || /\r(?!\n)/.test(base.text);
  const editable = !!target && !base.binary && !base.large && !mixedEol && (target === 'worktree' || base.exists && /^100(644|755) [a-f0-9]+ 0\t/.test(base.indexEntry ?? '') && !base.indexEntry!.includes('\0'));
  let saving = false, disposed = false, merge: MergeView | undefined, right: EditorView | undefined;
  let current = -1;
  const unified = new Compartment(), editability = new Compartment();
  const fileAction = diff.stageable ?? (diff.left.kind === 'empty' && diff.right.kind === 'worktree' ? 'stage' : null);
  if (fileAction) button(bar, fileAction === 'stage' ? '暂存文件' : '取消暂存', () => {
    if (plugin.indexEdits.has(diff.path) || plugin.worktreeEdits.has(diff.path)) { new Notice('请先保存比较器中的文件修改'); return; }
    return plugin.run(fileAction === 'stage' ? '暂存' : '取消暂存', async () => { if (fileAction === 'stage') { await plugin.flushEditors(); await plugin.git.stage([diff.path]); } else await plugin.git.unstage([diff.path]); });
  });
  if (diff.left.kind === 'index' && diff.before.exists && diff.right.kind === 'worktree') button(bar, '编辑暂存区', async () => plugin.openDiff(diff.path, await plugin.git.hasHead() ? HEAD : EMPTY, INDEX));
  if (diff.before.binary || diff.after.binary || diff.before.large || diff.after.large) {
    previous.disabled = next.disabled = fold.disabled = true;
    if (pending) button(bar, '查看未保存的修改', () => plugin.previewText(`${targetName}未保存的修改`, pending.text));
    empty(parent, '此文件使用元信息比较', `左侧 ${diff.before.size.toLocaleString()} 字节 · 右侧 ${diff.after.size.toLocaleString()} 字节。二进制文件或超过 2 MiB 的文本不展开行差异。`); return () => {};
  }
  const details = el(parent, 'div', 'gp-diff-meta');
  el(details, 'span', '', `${diff.before.exists ? '原版本' : '不存在'} ${diff.before.size.toLocaleString()} B`);
  el(details, 'span', '', `${diff.after.exists ? '新版本' : '不存在'} ${diff.after.size.toLocaleString()} B`);
  if (diff.before.text && !diff.before.text.endsWith('\n') || diff.after.text && !diff.after.text.endsWith('\n')) el(details, 'span', 'gp-muted', '存在无末尾换行的版本');
  const status = el(parent, 'div', 'gp-diff-edit-status'); status.setAttribute('role', 'status');
  const save = editable ? button(tools, target === 'index' ? '保存暂存区' : base.exists ? '保存工作文件' : '重新创建文件', () => saveChanges(), `mod-cta gp-save-diff gp-save-${target}`) : undefined;
  if (editable) tool(tools, '重新加载文件', 'refresh-cw', () => {
    const reload = async () => { plugin.setEdit(diff.path, target!, undefined); await plugin.openDiff(diff.path, diff.left, diff.right, diff.oldPath); };
    if (plugin.edits(target!).has(diff.path)) new ConfirmModal(plugin.app, '重新加载文件？', `当前${targetName}有未保存的修改。重新加载将放弃这些编辑，读取已保存内容。`, reload, '不保存并重新加载').open();
    else void reload();
  });
  function updateStatus(): void {
    if (disposed || !right) return;
    const chunks = getChunks(right.state)?.chunks ?? [];
    if (current >= chunks.length) current = -1;
    count.textContent = chunks.length ? `${current >= 0 ? current + 1 : '–'} / ${chunks.length} 处修改` : '无内容差异';
    previous.disabled = next.disabled = chunks.length === 0;
    const edit = target ? plugin.edits(target).get(diff.path) : undefined;
    const dirty = !!edit;
    if (save) save.disabled = saving || !dirty;
    const stale = !!edit && (target === 'index' ? edit.base.indexEntry !== diff.after.indexEntry : edit.base.exists !== diff.after.exists || edit.base.text !== diff.after.text || diff.after.binary || diff.after.large);
    parent.classList.toggle('is-modified', dirty);
    status.classList.toggle('gp-danger', stale);
    if (saving) status.textContent = `正在保存${targetName}…`;
    else if (stale) status.textContent = `${targetName}已变化，未保存的编辑仍在当前比较器中；可复制内容后重新加载文件`;
    else if (editable && dirty) status.textContent = `● 未保存 · Ctrl/Cmd+S 保存到${targetName}`;
    else if (editable && target === 'index') status.textContent = '暂存区 · 可编辑 · 保存后用于下次提交';
    else if (editable) status.textContent = base.exists ? '工作文件 · 可编辑 · Ctrl/Cmd+S 保存' : '工作文件已删除 · 编辑并保存可重新创建';
    else if (mixedEol && target) status.textContent = '此文件包含混合换行符，仅供查看和复制；请先在原文件统一换行符';
    else if (target === 'index' && !diff.after.exists) status.textContent = '暂存区无此文件或存在冲突；请从源代码管理暂存文件或解决冲突';
    else status.textContent = '历史版本只读 · 可拖选文字，Ctrl/Cmd+A 全选、Ctrl/Cmd+C 复制';
  }
  async function saveChanges(): Promise<void> {
    if (!editable || !target || saving || !right || !plugin.edits(target).has(diff.path)) return;
    if (plugin.controller.busy) { new Notice('已有 Git 操作正在执行，请稍后保存'); return; }
    const text = right.state.sliceDoc(); saving = true;
    right.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(true)) }); updateStatus();
    try {
      await plugin.run(`保存${targetName}`, async () => {
        if (target === 'index') await plugin.git.saveIndex(diff.path, text, base); else await plugin.saveWorkingFile(diff.path, text, base);
        const saved = await plugin.git.file(diff.path, diff.right);
        if (saved.text !== text || !saved.exists || saved.binary || saved.large) throw new Error(`${targetName}在保存后又被其他操作修改，当前编辑内容仍保留，请重新比较`);
        base = saved; diff.after = saved;
        plugin.setEdit(diff.path, target);
      });
    } finally {
      saving = false;
      if (!disposed) { right.dispatch({ effects: editability.reconfigure(EditorState.readOnly.of(false)) }); updateStatus(); }
    }
  }
  function navigate(direction: number): void {
    if (!right) return; const chunks = getChunks(right.state)?.chunks ?? []; if (!chunks.length) return;
    const anchor = right.state.selection.main.head;
    current = direction > 0 ? chunks.findIndex(chunk => chunk.fromB > anchor) : -1;
    if (direction < 0) chunks.forEach((chunk, index) => { if (chunk.fromB < anchor) current = index; });
    if (current < 0) current = direction > 0 ? 0 : chunks.length - 1;
    const chunk = chunks[current], position = Math.min(chunk.fromB, right.state.doc.length);
    right.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
    if (merge) merge.a.dispatch({ effects: EditorView.scrollIntoView(Math.min(chunk.fromA, merge.a.state.doc.length), { y: 'center' }) });
    right.focus(); updateStatus();
  }
  const shared: Extension[] = [lineNumbers(), EditorState.tabSize.of(4), keymap.of(defaultKeymap), EditorView.editable.of(true),
    EditorState.phrases.of({ '$ unchanged lines': '展开 $ 行未修改内容' }),
    EditorView.contentAttributes.compute([EditorState.readOnly], state => ({ 'aria-readonly': String(state.readOnly), 'tabindex': '0', 'spellcheck': 'false' })),
    EditorView.domEventHandlers({ copy: (event, view) => {
      const text = comparisonSelection(view);
      if (!text || !event.clipboardData) return false;
      event.clipboardData.setData('text/plain', text); event.preventDefault(); return true;
    } }),
  ];
  const eol = base.text.includes('\r\n') ? '\r\n' : '\n';
  const rightExtensions: Extension[] = [shared, EditorState.lineSeparator.of(eol),
    EditorView.contentAttributes.of({ 'aria-label': editable ? `${targetName}编辑器` : '右侧版本（只读，可选择和复制）' }),
    editability.of(EditorState.readOnly.of(!editable)),
    ...(editable ? [history(), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.domEventHandlers({
      keydown: event => { if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || event.altKey) return false; event.preventDefault(); event.stopPropagation(); void saveChanges(); return true; },
    })] : []),
    EditorView.updateListener.of(update => {
      if (update.docChanged && editable) {
        const text = update.state.sliceDoc(); plugin.setEdit(diff.path, target!, text === base.text ? undefined : { text, base }); current = -1;
      }
      queueMicrotask(updateStatus);
    }),
  ];
  const unifiedExtension = () => unifiedMergeView({ original: diff.before.text, mergeControls: false, highlightChanges: true, syntaxHighlightDeletions: false, collapseUnchanged: folded ? { margin: 3, minSize: 4 } : undefined, diffConfig: { timeout: 150 } });
  const body = el(parent, 'div', 'gp-diff-body gp-merge-body');
  if (plugin.settings.diffMode === 'split') {
    const columns = document.createElement('div'); columns.className = 'gp-diff-columns'; parent.insertBefore(columns, body);
    el(columns, 'span', '', `${revisionLabel(diff.left)} · 只读`); el(columns, 'span', '', `${revisionLabel(diff.right)}${editable ? ' · 可编辑' : ' · 只读'}`);
    merge = new MergeView({ parent: body,
      a: { doc: diff.before.text, extensions: [shared, EditorState.readOnly.of(true), EditorView.contentAttributes.of({ 'aria-label': '左侧版本（只读，可选择和复制）' })] },
      b: { doc: pending?.text ?? diff.after.text, extensions: rightExtensions },
      highlightChanges: true, gutter: true, diffConfig: { timeout: 150 },
    }); right = merge.b;
  } else right = new EditorView({ parent: body, doc: pending?.text ?? diff.after.text, extensions: [rightExtensions, unified.of(unifiedExtension())] });
  updateStatus();
  return () => { disposed = true; if (merge) merge.destroy(); else right?.destroy(); };
}
