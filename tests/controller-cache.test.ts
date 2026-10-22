import test from 'node:test';
import assert from 'node:assert/strict';
import { RepositoryController } from '../src/controller';
import type { GitService } from '../src/git/service';
import { DEFAULT_SETTINGS, INDEX, WORKTREE, type BlameLine, type Commit, type FileDiff } from '../src/types';

const commit = (hash: string): Commit => ({ hash, parents: [], author: 'QA', email: 'qa@example.com', date: '2026-10-21', subject: hash, refs: [] });
const blame: BlameLine = { hash: 'head', author: 'QA', date: 0, subject: 'base', originalLine: 1, line: 1, path: 'note.md', text: 'line', uncommitted: true };
const diff = (text: string): FileDiff => ({ path: 'note.md', oldPath: 'note.md', left: INDEX, right: WORKTREE, before: { text: 'base', size: 4, binary: false, large: false, exists: true }, after: { text, size: text.length, binary: false, large: false, exists: true }, patch: '', hunks: [], stageable: 'stage' });
const queries = [
  { name: 'log', read: (c: RepositoryController) => c.log({}, 0, 10), old: [commit('old')], fresh: [commit('new')] },
  { name: 'history', read: (c: RepositoryController) => c.history('note.md', 10), old: [commit('old')], fresh: [commit('new')] },
  { name: 'blame', read: (c: RepositoryController) => c.blame('note.md', 'line'), old: [{ ...blame, subject: 'old' }], fresh: [{ ...blame, subject: 'new' }] },
  { name: 'diff', read: (c: RepositoryController) => c.diff('note.md', INDEX, WORKTREE), old: diff('old'), fresh: diff('new') },
  { name: 'lineChange', read: (c: RepositoryController) => c.lineChange('note.md', blame, 'line'), old: { label: 'old', lines: [], truncated: false }, fresh: { label: 'new', lines: [], truncated: false } },
];

for (const query of queries) for (const oldFirst of [true, false]) {
  test(`${query.name} does not cache invalidated results arriving ${oldFirst ? 'before' : 'after'} fresh results`, async () => {
    let release!: (value: unknown) => void, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const git = { [query.name]: async () => ++calls === 1 ? pending : query.fresh, fingerprint: (text: string) => text, dispose() {} } as unknown as GitService;
    const controller = new RepositoryController(git, { ...DEFAULT_SETTINGS }, () => {});
    try {
      const old = query.read(controller); controller.invalidate();
      if (oldFirst) { release(query.old); await old; }
      assert.deepEqual(await query.read(controller), query.fresh);
      if (!oldFirst) { release(query.old); await old; }
      assert.deepEqual(await query.read(controller), query.fresh); assert.equal(calls, 2);
    } finally { release(query.old); controller.dispose(); }
  });
}

test('failed reads can retry and cache successful results for all query types', async () => {
  for (const query of queries) {
    let calls = 0;
    const git = { [query.name]: async () => { if (++calls === 1) throw new Error('read failed'); return query.fresh; }, fingerprint: (text: string) => text, dispose() {} } as unknown as GitService;
    const controller = new RepositoryController(git, { ...DEFAULT_SETTINGS }, () => {});
    try {
      await assert.rejects(query.read(controller), /read failed/);
      assert.deepEqual(await query.read(controller), query.fresh); assert.deepEqual(await query.read(controller), query.fresh); assert.equal(calls, 2);
    } finally { controller.dispose(); }
  }
});

test('log filters, pagination and file histories retain separate cache entries', async () => {
  let calls = 0;
  const git = { log: async (...args: unknown[]) => { calls++; return [commit(JSON.stringify(args))]; }, history: async (...args: unknown[]) => { calls++; return [commit('file:' + JSON.stringify(args))]; }, dispose() {} } as unknown as GitService;
  const controller = new RepositoryController(git, { ...DEFAULT_SETTINGS }, () => {});
  try {
    const reads = [() => controller.log({}, 0, 10), () => controller.log({ ref: 'HEAD' }, 0, 10), () => controller.log({}, 10, 10), () => controller.log({}, 0, 20), () => controller.history('a.md', 10), () => controller.history('b.md', 10), () => controller.history('a.md', 20)];
    const first = await Promise.all(reads.map(read => read()));
    assert.equal(new Set(first.map(result => result[0].hash)).size, reads.length);
    assert.deepEqual(await Promise.all(reads.map(read => read())), first); assert.equal(calls, reads.length);
  } finally { controller.dispose(); }
});
