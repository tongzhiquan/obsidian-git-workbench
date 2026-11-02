import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopedSourceFiles, sourcePaths, sourceRows } from '../src/ui/source-tree';
import { GitService } from '../src/git/service';
import { statusPaths } from '../src/git/status-paths';
import { RepositoryController } from '../src/controller';
import { DEFAULT_SETTINGS, HEAD, INDEX, WORKTREE } from '../src/types';
import type { FileStatus } from '../src/types';

const file = (path: string, overrides: Partial<FileStatus> = {}): FileStatus => ({ path, index: '.', worktree: 'M', conflict: false, untracked: false, submodule: false, ...overrides });

test('stage and unstage paths use only the rename on the side being changed', () => {
  const stagedRename = file('笔记库/new.md', { oldPath: '笔记库/old.md', index: 'R' });
  assert.deepEqual(sourcePaths([stagedRename], '笔记库', true), ['笔记库/new.md']);
  assert.deepEqual(sourcePaths([stagedRename], '笔记库', true, 'index'), ['笔记库/old.md', '笔记库/new.md']);
  const workingRename = file('笔记库/new.md', { oldPath: '笔记库/old.md', worktree: 'R' });
  assert.deepEqual(statusPaths([workingRename, workingRename], 'worktree'), ['笔记库/old.md', '笔记库/new.md']);
  assert.deepEqual(statusPaths([workingRename], 'index'), ['笔记库/new.md']);
  const copy = file('笔记库/copy.md', { oldPath: '笔记库/source.md', index: 'C' });
  assert.deepEqual(statusPaths([copy], 'index'), ['笔记库/copy.md']);
});

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
  assert.deepEqual(sourcePaths([inward, outward, internal, copyOut], '笔记库', true, 'index'), ['笔记库/in.md', '笔记库/out.md', '笔记库/old.md', '笔记库/new.md']);
  assert.deepEqual(sourcePaths([inward], '笔记库', false, 'index'), ['outside-old.md', '笔记库/in.md']);
  assert.deepEqual(sourcePaths([inward, internal], '笔记库', true), ['笔记库/in.md', '笔记库/new.md']);
});

async function renamedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-rename-stage-')), git = new GitService(join(root, '笔记库'));
  await mkdir(git.vault);
  git.runner.cwd = root;
  await git.runner.text(['init', '--initial-branch=main']); await git.runner.text(['config', 'user.name', 'Rename QA']); await git.runner.text(['config', 'user.email', 'qa@example.com']); await git.runner.text(['config', 'core.autocrlf', 'false']);
  git.runner.cwd = git.vault; await git.discover();
  const old = '笔记库/2026-10-29（周四） [x].md', path = '笔记库/2026-10-29~30（周四） [x].md', text = 'baseline\r\n'.repeat(30);
  await writeFile(join(root, old), text); await writeFile(join(root, 'outside.md'), 'outside baseline\n');
  await git.stage([old, 'outside.md']); await git.commit('rename baseline');
  const head = (await git.status()).head;
  await writeFile(join(root, 'outside.md'), 'outside staged\n'); await git.stage(['outside.md']); await writeFile(join(root, 'outside.md'), 'outside working\n');
  await rename(join(root, old), join(root, path)); await git.stage([old, path]);
  await writeFile(join(root, path), text + 'new working content\r\n');
  return { root, git, old, path, text, head, close: async () => { git.dispose(); await rm(root, { recursive: true, force: true }); } };
}

test('a staged rename can be restaged, deleted and unstaged without touching a recreated old path or outside changes', async () => {
  for (const vaultOnly of [true, false]) {
    const f = await renamedFixture();
    try {
      const outside = (await f.git.file('outside.md', INDEX)).indexEntry;
      const status = (await f.git.status()).files.find(entry => entry.path === f.path)!;
      assert.equal(status.index, 'R'); assert.equal(status.worktree, 'M');
      // The old name may be reused for a new untracked note; selecting the renamed row must leave it alone.
      await writeFile(join(f.root, f.old), 'recreated old note\n');
      const paths = sourcePaths([status], '笔记库', vaultOnly);
      assert.deepEqual(paths, [f.path]);
      await f.git.stage(paths);
      assert.equal((await f.git.file(f.path, INDEX)).text, f.text + 'new working content\r\n');
      assert.equal((await f.git.file(f.old, INDEX)).exists, false);
      assert.equal((await f.git.status()).files.find(entry => entry.path === f.old)?.untracked, true);
      assert.equal((await f.git.status()).files.find(entry => entry.path === f.path)?.worktree, '.');
      await rm(join(f.root, f.path));
      const deleted = (await f.git.status()).files.find(entry => entry.path === f.path)!;
      assert.equal(deleted.index, 'R'); assert.equal(deleted.worktree, 'D');
      await f.git.stage(sourcePaths([deleted], '笔记库', vaultOnly));
      assert.equal((await f.git.file(f.path, INDEX)).exists, false);
      assert.equal(await f.git.runner.text(['ls-files', '--stage', '--', f.old]), '');
      await f.git.unstage(sourcePaths((await f.git.status()).files.filter(entry => entry.path === f.old && !entry.untracked), '笔记库', vaultOnly, 'index'));
      assert.equal((await f.git.file(f.old, INDEX)).text, f.text);
      assert.equal(await f.git.runner.text(['rev-parse', 'HEAD']).then(value => value.trim()), f.head);
      assert.equal((await f.git.file('outside.md', INDEX)).indexEntry, outside);
      assert.equal((await f.git.file('outside.md', WORKTREE)).text, 'outside working\n');
    } finally { await f.close(); }
  }
});

test('batch restaging and unstaging of renamed files preserve other staged entries and the working files', async () => {
  const f = await renamedFixture();
  try {
    const outside = (await f.git.file('outside.md', INDEX)).indexEntry;
    await writeFile(join(f.root, '笔记库/another.md'), 'another change\n');
    const files = (await f.git.status()).files.filter(entry => entry.path !== 'outside.md');
    await f.git.stage(sourcePaths(files, '笔记库', true));
    const renamed = (await f.git.status()).files.find(entry => entry.path === f.path)!;
    assert.equal(renamed.index, 'R'); assert.equal(renamed.worktree, '.');
    await f.git.unstage(sourcePaths([renamed], '笔记库', true, 'index'));
    assert.equal((await f.git.file(f.old, INDEX)).text, f.text);
    assert.equal((await f.git.file(f.path, INDEX)).exists, false);
    assert.equal((await f.git.file('笔记库/another.md', INDEX)).text, 'another change\n');
    assert.equal((await f.git.file('outside.md', INDEX)).indexEntry, outside);
    assert.equal((await f.git.file(f.path, WORKTREE)).text, f.text + 'new working content\r\n');
    assert.equal((await f.git.status()).head, f.head);
  } finally { await f.close(); }
});

test('automatic backup can commit an already staged rename and its new working content', async () => {
  const f = await renamedFixture(), controller = new RepositoryController(f.git, { ...DEFAULT_SETTINGS, autoBackup: true, autoCommit: true, autoSync: false }, () => {});
  try {
    await controller.automation(async () => {});
    assert.equal(controller.error, ''); assert.equal(controller.automationPaused, false);
    assert.equal((await f.git.file(f.old, HEAD)).exists, false);
    assert.equal((await f.git.file(f.path, HEAD)).text, f.text + 'new working content\r\n');
    assert.equal((await f.git.status()).files.length, 0);
  } finally { controller.dispose(); await f.close(); }
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
    await git.unstage(sourcePaths((await git.status()).files, '笔记库', true, 'index'));
    assert.equal(await outside(), originalOutside);
    assert.equal((await git.file('笔记库/inside.md', { kind: 'index' })).text, 'inside baseline\n');
    assert.equal((await git.file('笔记库/move-out.md', { kind: 'index' })).exists, true);
    assert.equal((await git.file('笔记库/moved-in.md', { kind: 'index' })).exists, false);
    assert.equal((await git.status()).head, head);
  } finally { git.dispose(); await rm(root, { recursive: true, force: true }); }
});
