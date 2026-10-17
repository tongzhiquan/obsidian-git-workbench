import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceRows } from '../src/ui/source-tree';
import type { FileStatus } from '../src/types';
const file = (path: string, overrides: Partial<FileStatus> = {}): FileStatus => ({ path, index: '.', worktree: 'M', conflict: false, untracked: false, submodule: false, ...overrides });

test('tree shows directories first and keeps the same file in both staging groups', () => {
  const files = [file('根.md'), file('笔记/任务10.md'), file('笔记/任务2.md', { index: 'M' })];
  const original = JSON.stringify(files), rows = sourceRows(files, 'tree', new Set());
  assert.deepEqual(rows.filter(row => row.kind === 'group').map(row => [row.type, row.files.length]), [['index', 1], ['worktree', 3]]);
  assert.deepEqual(rows.filter(row => row.type === 'worktree').map(row => row.kind === 'group' ? row.title : row.name), ['未暂存', '笔记', '任务2.md', '任务10.md', '根.md']);
  assert.equal(rows.filter(row => row.kind === 'file' && row.file.path === '笔记/任务2.md').length, 2);
  assert.equal(JSON.stringify(files), original);
});

test('collapsing a folder or group does not hide the same directory in another group', () => {
  const files = [file('a/b/c.md', { index: 'M' }), file('a/root.md'), file('else.md')];
  const rows = sourceRows(files, 'tree', new Set(['index:folder:a', 'worktree:folder:a/b']));
  assert.ok(!rows.some(row => row.kind === 'file' && row.file.path === 'a/b/c.md'));
  assert.ok(rows.some(row => row.kind === 'file' && row.file.path === 'a/root.md'));
  const folder = rows.find(row => row.kind === 'folder' && row.path === 'a' && row.type === 'worktree');
  assert.ok(folder?.kind === 'folder'); assert.equal(folder.files.length, 2);
  const collapsed = sourceRows(files, 'list', new Set(['group:index']));
  assert.equal(collapsed.filter(row => row.type === 'index').length, 1);
  assert.equal(collapsed.filter(row => row.kind === 'file' && row.type === 'worktree').length, 3);
});

test('list disambiguates identical basenames and keeps conflicts and untracked separate', () => {
  const rows = sourceRows([file('a/笔记.md'), file('b/笔记.md'), file('冲突.md', { index: 'U', worktree: 'U', conflict: true }), file('新.md', { untracked: true, index: '?', worktree: '?' })], 'list', new Set());
  assert.ok(!rows.some(row => row.kind === 'folder'));
  assert.deepEqual(rows.filter(row => row.kind === 'file' && row.name === '笔记.md').map(row => row.kind === 'file' && row.directory), ['a', 'b']);
  assert.deepEqual(rows.filter(row => row.kind === 'group').map(row => row.type), ['conflict', 'worktree', 'untracked']);
});

test('tree retains renamed and deleted paths including special directory names', () => {
  const renamed = file('中文 [x]/新\t名.md', { index: 'R', worktree: '.', oldPath: '旧/原名.md' });
  const deleted = file('__proto__/constructor', { worktree: 'D' });
  const rows = sourceRows([renamed, deleted], 'tree', new Set());
  const files = rows.filter(row => row.kind === 'file');
  assert.equal(files.length, 2); assert.ok(files.some(row => row.kind === 'file' && row.file === renamed));
  assert.ok(rows.some(row => row.kind === 'folder' && row.path === '__proto__'));
});
