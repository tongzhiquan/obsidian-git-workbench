import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopedSourceFiles, sourcePaths, sourceRows } from '../src/ui/source-tree';
import { GitService } from '../src/git/service';
import type { FileStatus } from '../src/types';

const file = (path: string, overrides: Partial<FileStatus> = {}): FileStatus => ({ path, index: '.', worktree: 'M', conflict: false, untracked: false, submodule: false, ...overrides });

test('vault scope respects path boundaries, hidden files, status groups and repository-root vaults', () => {
  const files = [file('笔记库/a.md', { index: 'M' }), file('笔记库/.obsidian/config.json'), file('笔记库/new.md', { untracked: true, index: '?', worktree: '?' }), file('笔记库/conflict.md', { conflict: true, index: 'U', worktree: 'U' }), file('笔记库2/a.md'), file('outside.md')];
  const original = JSON.stringify(files), visible = scopedSourceFiles(files, '笔记库', true);
  assert.equal(visible.length, 4);
  for (const layout of ['tree', 'list'] as const) {
    const rows = sourceRows(visible, layout, new Set());
    assert.deepEqual(rows.filter(row => row.kind === 'group').map(row => [row.type, row.files.length]), [['conflict', 1], ['index', 1], ['worktree', 2], ['untracked', 1]]);
    assert.ok(rows.every(row => row.kind !== 'file' || row.file.path.startsWith('笔记库/')));
  }
  assert.equal(scopedSourceFiles(files, '笔记库', false), files);
  assert.equal(scopedSourceFiles(files, '', true), files);
  assert.equal(JSON.stringify(files), original);
});

test('cross-boundary renames become in-vault additions or deletions without including outside action paths', () => {
  const inward = file('笔记库/in.md', { oldPath: 'outside-old.md', index: 'R' });
  const outward = file('outside-new.md', { oldPath: '笔记库/out.md', index: 'R' });
  const internal = file('笔记库/new.md', { oldPath: '笔记库/old.md', index: 'R', worktree: '.' });
  const copyOut = file('copy-out.md', { oldPath: '笔记库/source.md', index: 'C' });
  const result = scopedSourceFiles([inward, outward, internal, copyOut], '笔记库', true);
  assert.deepEqual(result.map(f => [f.path, f.oldPath, f.index, f.worktree]), [['笔记库/in.md', undefined, 'A', 'M'], ['笔记库/out.md', undefined, 'D', '.'], ['笔记库/new.md', '笔记库/old.md', 'R', '.']]);
  assert.deepEqual(sourcePaths([inward, outward, internal, copyOut], '笔记库', true), ['笔记库/in.md', '笔记库/out.md', '笔记库/old.md', '笔记库/new.md']);
  assert.deepEqual(sourcePaths([inward], '笔记库', false), ['outside-old.md', '笔记库/in.md']);
});

test('real scoped stage and unstage preserve outside index entries across inward and outward moves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-scope-')), git = new GitService(join(root, '笔记库'));
  await mkdir(git.vault);
  try {
    git.runner.cwd = root;
    await git.runner.text(['init', '--initial-branch=main']); await git.runner.text(['config', 'user.name', 'Scope QA']); await git.runner.text(['config', 'user.email', 'qa@example.com']);
    git.runner.cwd = git.vault; await git.discover();
    for (const [path, text] of [['outside.md', 'outside baseline\n'], ['笔记库/inside.md', 'inside baseline\n'], ['move-in.md', 'inward\n'.repeat(10)], ['笔记库/move-out.md', 'outward\n'.repeat(10)]]) await writeFile(join(root, path), text);
    await git.stage(['outside.md', '笔记库/inside.md', 'move-in.md', '笔记库/move-out.md']); await git.commit('scope baseline');
    await writeFile(join(root, 'outside.md'), 'outside staged\n'); await git.stage(['outside.md']); await writeFile(join(root, 'outside.md'), 'outside working\n');
    await writeFile(join(root, '笔记库/inside.md'), 'inside working\n');
    await rename(join(root, 'move-in.md'), join(root, '笔记库/moved-in.md')); await rename(join(root, '笔记库/move-out.md'), join(root, 'moved-out.md'));
    await git.stage(['move-in.md', '笔记库/moved-in.md', '笔记库/move-out.md', 'moved-out.md']);
    await writeFile(join(root, '笔记库/moved-in.md'), 'inward working edit\n'); await writeFile(join(root, 'moved-out.md'), 'outward working edit\n');
    const head = (await git.status()).head;
    const outside = () => git.runner.text(['ls-files', '--stage', '-z', '--', 'outside.md', 'move-in.md', 'moved-out.md']);
    const originalOutside = await outside(), files = (await git.status()).files;
    assert.ok(files.some(f => f.oldPath === 'move-in.md'));
    assert.ok(files.some(f => f.oldPath === '笔记库/move-out.md'));
    const visible = scopedSourceFiles(files, '笔记库', true);
    await git.stage(sourcePaths(visible.filter(f => f.untracked || f.worktree !== '.'), '笔记库', true));
    assert.equal(await outside(), originalOutside);
    assert.equal((await git.file('笔记库/inside.md', { kind: 'index' })).text, 'inside working\n');
    await git.unstage(sourcePaths((await git.status()).files, '笔记库', true));
    assert.equal(await outside(), originalOutside);
    assert.equal((await git.file('笔记库/inside.md', { kind: 'index' })).text, 'inside baseline\n');
    assert.equal((await git.file('笔记库/move-out.md', { kind: 'index' })).exists, true);
    assert.equal((await git.file('笔记库/moved-in.md', { kind: 'index' })).exists, false);
    assert.equal((await git.status()).head, head);
  } finally { git.dispose(); await rm(root, { recursive: true, force: true }); }
});
