import { t } from '../i18n';
import { diffLines } from 'diff';
import type { BlameChange, BlameChangeLine } from '../types';

/** Select the edit block containing a line in the NEW file, never the current editor offset. */
export function lineChange(before: string, after: string, line: number, label: string): BlameChange {
  const result: BlameChange = { label, lines: [], truncated: false };
  if (!Number.isInteger(line) || line < 1) return { ...result, notice: t('blame.positionMissing') };
  const chunks = diffLines(before, after, { timeout: 80, maxEditLength: 5000, stripTrailingCr: true });
  if (!chunks) return { ...result, notice: t('blame.largeChange') };
  const split = (text: string): string[] => { const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop(); return lines; };
  let oldLine = 1, newLine = 1;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.added && !chunk.removed) {
      const count = chunk.count;
      if (line >= newLine && line < newLine + count) {
        result.lines = [{ kind: 'context', text: split(chunk.value)[line - newLine], line, selected: true }];
        result.notice = t('blame.noChange'); break;
      }
      oldLine += count; newLine += count; continue;
    }
    const block: BlameChangeLine[] = [];
    while (i < chunks.length && (chunks[i].added || chunks[i].removed)) {
      const edit = chunks[i];
      for (const text of split(edit.value)) {
        const number = edit.removed ? oldLine++ : newLine++;
        block.push({ kind: edit.removed ? 'delete' : 'add', text, line: number, selected: edit.added && number === line });
      }
      i++;
    }
    i--;
    const selected = block.findIndex(row => row.selected);
    if (selected < 0) continue;
    if (block.length <= 12) result.lines = block;
    else {
      const removed = block.filter(row => row.kind === 'delete');
      const added = block.filter(row => row.kind === 'add');
      if (removed.length) {
        const index = added.findIndex(row => row.selected);
        const start = Math.max(0, Math.min(index - 2, Math.max(0, added.length - 6)));
        const oldStart = Math.max(0, Math.min(index - 2, Math.max(0, removed.length - 6)));
        result.lines = [...removed.slice(oldStart, oldStart + 6), ...added.slice(start, start + 6)];
      } else {
        const start = Math.max(0, Math.min(selected - 5, block.length - 12));
        result.lines = block.slice(start, start + 12);
      }
      result.truncated = true;
    }
    break;
  }
  if (!result.lines.length && !result.notice) result.notice = t('blame.notFound');
  for (const row of result.lines) if (row.text.length > 600) { row.text = row.text.slice(0, 600) + '…'; result.truncated = true; }
  return result;
}
