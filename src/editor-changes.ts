import { diffLines } from 'diff';
export type ChangeKind = 'add' | 'change' | 'delete';

// Compare against the cached index, without waiting for disk saves or git blame.
export function changeLines(before: string, after: string): Map<number, ChangeKind> {
  before = before.replace(/\r\n/g, '\n'); after = after.replace(/\r\n/g, '\n');
  const result = new Map<number, ChangeKind>();
  const chunks = diffLines(before, after, { timeout: 25 });
  const last = after.split('\n').length;
  if (!chunks) {
    // Bound synchronous work for very large edits. Keep the changed span visible
    // rather than blocking input or dropping all markers when the budget expires.
    const old = before.split('\n'), next = after.split('\n'); let first = 0, end = next.length, oldEnd = old.length;
    while (first < Math.min(old.length, next.length) && old[first] === next[first]) first++;
    while (end > first && oldEnd > first && old[oldEnd - 1] === next[end - 1]) { end--; oldEnd--; }
    for (let n = first; n < end; n++) result.set(n + 1, n - first < oldEnd - first ? 'change' : 'add');
    if (end === first && oldEnd > first) result.set(Math.min(last, first + 1), 'delete');
    return result;
  }
  let line = 1;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i], count = chunk.count ?? 0;
    if (chunk.removed) {
      if (chunks[i + 1]?.added) { const add = chunks[++i]; for (let n = 0; n < (add.count ?? 0); n++) result.set(line++, n < count ? 'change' : 'add'); }
      else result.set(Math.min(last, Math.max(1, line)), 'delete');
    } else if (chunk.added) for (let n = 0; n < count; n++) result.set(line++, 'add');
    else line += count;
  }
  return result;
}
