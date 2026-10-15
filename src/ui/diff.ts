import { diffChars, diffLines } from 'diff';
import type GitPlus from '../main';
import { revisionLabel, type FileDiff } from '../types';
import { button, el, empty, virtualList } from './common';
export interface DiffRow { old?: string; next?: string; oldLine?: number; nextLine?: number; kind: 'same' | 'change' | 'add' | 'delete' }
export function splitRows(before: string, after: string): DiffRow[] {
  const changes = diffLines(before, after); const rows: DiffRow[] = []; let old = 1, next = 1;
  const lines = (s: string) => { const parts = s.split('\n'); if (parts.at(-1) === '') parts.pop(); return parts; };
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]; const group = lines(change.value);
    if (change.removed) {
      const additions = changes[i + 1]?.added ? lines(changes[++i].value) : [];
      for (let n = 0; n < Math.max(group.length, additions.length); n++) rows.push({ old: group[n], next: additions[n], oldLine: n < group.length ? old++ : undefined, nextLine: n < additions.length ? next++ : undefined, kind: n < group.length && n < additions.length ? 'change' : n < group.length ? 'delete' : 'add' });
    } else if (change.added) for (const line of group) rows.push({ next: line, nextLine: next++, kind: 'add' });
    else for (const line of group) rows.push({ old: line, next: line, oldLine: old++, nextLine: next++, kind: 'same' });
  }
  return rows;
}
function coloredLine(parent: HTMLElement, text: string | undefined, other: string | undefined, side: 'old' | 'next', highlight: boolean): void {
  if (text === undefined) return;
  if (!highlight || other === undefined || text.length + other.length > 4000) { parent.textContent = text; return; }
  for (const chunk of diffChars(side === 'old' ? text : other, side === 'old' ? other : text)) {
    if (side === 'old' && chunk.added || side === 'next' && chunk.removed) continue;
    el(parent, 'span', chunk.added ? 'gp-inline-add' : chunk.removed ? 'gp-inline-delete' : '', chunk.value);
  }
}
export function renderDiff(parent: HTMLElement, diff: FileDiff, plugin: GitPlus): () => void {
  const bar = el(parent, 'div', 'gp-diff-bar');
  el(bar, 'strong', 'gp-path', diff.path);
  el(bar, 'span', 'gp-muted', `${revisionLabel(diff.left)} → ${revisionLabel(diff.right)}`);
  button(bar, plugin.settings.diffMode === 'split' ? '统一差异' : '并排差异', async () => { plugin.settings.diffMode = plugin.settings.diffMode === 'split' ? 'unified' : 'split'; await plugin.persistSettings(); await plugin.openDiff(diff.path, diff.left, diff.right, diff.oldPath); });
  const fileAction = diff.stageable ?? (diff.left.kind === 'empty' && diff.right.kind === 'worktree' ? 'stage' : null);
  if (fileAction) button(bar, fileAction === 'stage' ? '暂存文件' : '取消暂存', () => plugin.run(fileAction === 'stage' ? '暂存' : '取消暂存', async () => { if (fileAction === 'stage') { await plugin.flushEditors(); await plugin.git.stage([diff.path]); } else await plugin.git.unstage([diff.path]); }));
  if (diff.before.binary || diff.after.binary || diff.before.large || diff.after.large) { empty(parent, '此文件使用元信息比较', `左侧 ${diff.before.size.toLocaleString()} 字节 · 右侧 ${diff.after.size.toLocaleString()} 字节。二进制文件或超过 2 MiB 的文本不展开行差异。`); return () => {}; }
  const details = el(parent, 'div', 'gp-diff-meta');
  el(details, 'span', '', `${diff.before.exists ? '原版本' : '不存在'} ${diff.before.size.toLocaleString()} B`);
  el(details, 'span', '', `${diff.after.exists ? '新版本' : '不存在'} ${diff.after.size.toLocaleString()} B`);
  if (diff.before.text && !diff.before.text.endsWith('\n') || diff.after.text && !diff.after.text.endsWith('\n')) el(details, 'span', 'gp-muted', '存在无末尾换行的版本');
  const disposers: (() => void)[] = [];
  if (diff.hunks.length && diff.stageable) {
    const tools = el(parent, 'div', 'gp-hunk-tools');
    diff.hunks.forEach(h => button(tools, `${diff.stageable === 'stage' ? '暂存' : '取消暂存'}块 ${h.index + 1}`, () => plugin.run('应用变更块', () => plugin.git.applyHunk(diff, h.index))));
  }
  if (diff.before.text === diff.after.text) { empty(parent, '两个版本内容相同'); return () => {}; }
  if (plugin.settings.diffMode === 'split') {
    const columns = el(parent, 'div', 'gp-diff-columns'); el(columns, 'span', '', revisionLabel(diff.left)); el(columns, 'span', '', revisionLabel(diff.right));
    const body = el(parent, 'div', 'gp-diff-body'); const rows = splitRows(diff.before.text, diff.after.text);
    disposers.push(virtualList(body, rows, 25, (row, data) => {
      row.classList.add('gp-split-row', `gp-${data.kind}`);
      const left = el(row, 'div', 'gp-code-cell gp-code-old'); el(left, 'span', 'gp-line-number', String(data.oldLine ?? '')); coloredLine(el(left, 'code'), data.old, data.next, 'old', data.kind === 'change');
      const right = el(row, 'div', 'gp-code-cell gp-code-next'); el(right, 'span', 'gp-line-number', String(data.nextLine ?? '')); coloredLine(el(right, 'code'), data.next, data.old, 'next', data.kind === 'change');
    }, 'gp-code-scroll'));
  } else {
    const body = el(parent, 'div', 'gp-diff-body'); const lines = diff.patch.split('\n');
    disposers.push(virtualList(body, lines, 25, (row, line) => { row.classList.add('gp-unified-row'); const kind = line.startsWith('+') && !line.startsWith('+++') ? 'gp-add' : line.startsWith('-') && !line.startsWith('---') ? 'gp-delete' : line.startsWith('@@') ? 'gp-hunk-heading' : ''; if (kind) row.classList.add(kind); el(row, 'code', '', line); }, 'gp-code-scroll'));
  }
  return () => disposers.forEach(d => d());
}
