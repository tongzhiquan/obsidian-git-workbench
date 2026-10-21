import { diffArrays } from 'diff';

export interface LineEdit {
  id: number;
  beforeIndex: number;
  afterIndex: number;
  before?: string;
  after?: string;
}
export interface LineEdits { before: string[]; after: string[]; edits: LineEdit[] }
const lines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const normal = (line: string): string => line.replace(/\r\n$/, '\n');

// Keep terminators in the model so final-newline changes are real selectable edits.
export function lineEdits(before: string, after: string): LineEdits | undefined {
  const a = lines(before), b = lines(after);
  const chunks = diffArrays(a, b, { comparator: (x, y) => normal(x) === normal(y), timeout: 80, maxEditLength: 10000 });
  if (!chunks) return;
  const edits: LineEdit[] = []; let ai = 0, bi = 0;
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    if (!part.added && !part.removed) { ai += part.value.length; bi += part.value.length; continue; }
    const removed = part.removed ? part.value : [], added = part.added ? part.value : chunks[i + 1]?.added ? chunks[++i].value : [];
    for (let n = 0; n < Math.max(removed.length, added.length); n++) edits.push({ id: edits.length, beforeIndex: ai + Math.min(n, removed.length), afterIndex: bi + Math.min(n, added.length), before: removed[n], after: added[n] });
    ai += removed.length; bi += added.length;
  }
  return edits.length <= 5000 ? { before: a, after: b, edits } : undefined;
}

export function selectedText(model: LineEdits, ids: readonly number[], reverse = false): string {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isInteger(id) || !model.edits[id])) throw new Error('请选择有效的修改行');
  const result = [...(reverse ? model.after : model.before)];
  const baseText = result.join(''), otherText = (reverse ? model.before : model.after).join('');
  const eol = (baseText || otherText).includes('\r\n') ? '\r\n' : '\n';
  for (const edit of ids.map(id => model.edits[id]).sort((a, b) => (reverse ? b.afterIndex - a.afterIndex : b.beforeIndex - a.beforeIndex) || b.id - a.id)) {
    const from = reverse ? edit.after : edit.before, to = reverse ? edit.before : edit.after;
    result.splice(reverse ? edit.afterIndex : edit.beforeIndex, from === undefined ? 0 : 1, ...(to === undefined ? [] : [to.replace(/\r?\n$/, eol)]));
  }
  // Inserting after an unterminated last line must not concatenate the two lines.
  return result.map((line, i) => i < result.length - 1 && !line.endsWith('\n') ? line + eol : line).join('');
}
