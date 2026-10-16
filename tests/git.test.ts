import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService } from '../src/git/service';
import { GitRunner } from '../src/git/runner';
import { layoutGraph } from '../src/git/graph';
import { conflictBlocks, parseStatus } from '../src/git/parsers';
import { HEAD, INDEX, WORKTREE } from '../src/types';
import { RepositoryController } from '../src/controller';
import { DEFAULT_SETTINGS } from '../src/types';
async function fixture(nested = false) {
  const root = await mkdtemp(join(tmpdir(), 'git-plus-test-')); await mkdir(join(root, '笔记库'), { recursive: true });
  const runner = new GitRunner('git', root); await runner.text(['init', '--initial-branch=main']); await runner.text(['config', 'user.name', 'Git Plus 测试']); await runner.text(['config', 'user.email', 'test@example.com']); await runner.text(['config', 'core.autocrlf', 'false']);
  const git = new GitService(nested ? join(root, '笔记库') : root); await git.discover();
  const seed = async (path: string, text: string, message = '初始提交') => { await writeFile(join(root, path), text); await git.stage([path]); await git.commit(message); return (await git.status()).head; };
  return { root, runner, git, seed, close: async () => { git.dispose(); runner.dispose(); await rm(root, { recursive: true, force: true }); } };
}
test('empty repository, nested vault mapping, initial commit and special paths', async () => {
  const f = await fixture(true); try {
    assert.equal(f.git.repo?.vaultPrefix, '笔记库'); assert.equal(f.git.repoPath('记录.md'), '笔记库/记录.md'); assert.equal(f.git.vaultPath('其他.md'), undefined);
    assert.equal((await f.git.status()).head, '(initial)'); assert.deepEqual(await f.git.log(), []);
    const path = '笔记库/中文 空格 [x] $ ` ;.md'; await writeFile(join(f.root, path), '开始\r\n'); await f.git.stage([path]);
    assert.equal((await f.git.status()).files[0].index, 'A'); await f.git.unstage([path]); assert.equal((await f.git.status()).files[0].untracked, true);
    await f.git.stage([path]); await f.git.commit('首个提交'); assert.equal((await f.git.log())[0].subject, '首个提交'); assert.equal((await f.git.file(path, HEAD)).text, '开始\r\n');
    await assert.rejects(f.git.commit('空提交'), /暂存区为空/); assert.throws(() => f.git.path('../out'), /超出/);
  } finally { await f.close(); }
});
test('staged and unstaged content stay separate; two hunks can be staged and unstaged', async () => {
  const f = await fixture(); try {
    const original = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'; await f.seed('note.md', original);
    const changed = original.replace('line 2\n', '修改二\n').replace('line 22\n', '修改二十二\n'); await writeFile(join(f.root, 'note.md'), changed);
    const diff = await f.git.diff('note.md'); assert.equal(diff.hunks.length, 2); assert.equal(diff.stageable, 'stage'); await f.git.applyHunk(diff, 0);
    assert.equal((await f.git.file('note.md', INDEX)).text, original.replace('line 2\n', '修改二\n')); const s = (await f.git.status()).files[0]; assert.equal(s.index, 'M'); assert.equal(s.worktree, 'M');
    const staged = await f.git.diff('note.md', HEAD, INDEX); await f.git.applyHunk(staged, 0); assert.equal((await f.git.file('note.md', INDEX)).text, original);
    await f.git.stage(['note.md']); await f.git.commit('更新内容'); assert.equal((await f.git.status()).files.length, 0);
    await writeFile(join(f.root, 'note.md'), changed + '另一次变化\n'); await assert.rejects(f.git.applyHunk(diff, 0), /已变化/);
  } finally { await f.close(); }
});
test('rename history resolves each historical path and commit detail paths', async () => {
  const f = await fixture(); try {
    const first = await f.seed('旧名称.md', '# 原文\n正文\n'); await rename(join(f.root, '旧名称.md'), join(f.root, '新名称.md')); await f.git.stage(['旧名称.md', '新名称.md']); await f.git.commit('重命名');
    await writeFile(join(f.root, '新名称.md'), '# 原文\n正文\n补充\n'); await f.git.stage(['新名称.md']); await f.git.commit('补充');
    const history = await f.git.history('新名称.md'); assert.equal(history.length, 3); assert.equal(history[0].path, '新名称.md'); assert.equal(history[2].path, '旧名称.md'); assert.equal(history[2].hash, first);
    const detail = await f.git.commitDetail(history[1].hash); assert.equal(detail.files[0].oldPath, '旧名称.md'); assert.equal(detail.files[0].path, '新名称.md');
    const diff = await f.git.diff('新名称.md', { kind: 'commit', ref: first }, WORKTREE, '旧名称.md'); assert.match(diff.before.text, /原文/); assert.match(diff.after.text, /补充/);
    assert.equal((await f.git.log({ message: '补充' })).length, 1);
  } finally { await f.close(); }
});

test('editing index preserves worktree, HEAD, executable mode, other staged files and CRLF', async () => {
  const f = await fixture(true); try {
    const path = '笔记库/中文 [x] $ ` ;.md'; const original = 'first\r\nsecond\r\n';
    const head = await f.seed(path, original); await f.runner.text(['update-index', '--chmod=+x', '--', path]);
    await writeFile(join(f.root, 'other.md'), 'other staged\n'); await f.git.stage(['other.md']);
    await writeFile(join(f.root, path), 'worktree stays separate\r\n');
    const base = await f.git.file(path, INDEX); await f.git.saveIndex(path, 'edited index\r\nsecond', base);
    assert.equal((await f.git.file(path, INDEX)).text, 'edited index\r\nsecond');
    assert.equal(await readFile(join(f.root, path), 'utf8'), 'worktree stays separate\r\n');
    assert.equal((await f.git.status()).head, head); assert.equal((await f.git.file(path, HEAD)).text, original);
    assert.match((await f.git.file(path, INDEX)).indexEntry!, /^100755 /);
    assert.equal((await f.git.file('other.md', INDEX)).text, 'other staged\n');
    await f.git.saveIndex(path, '', await f.git.file(path, INDEX)); assert.equal((await f.git.file(path, INDEX)).exists, true); assert.equal((await f.git.file(path, INDEX)).size, 0);
  } finally { await f.close(); }
});

test('index edit rejects external modifications and Git locks without losing data', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'base\n'); const base = await f.git.file('note.md', INDEX);
    await writeFile(join(f.root, 'note.md'), 'external\n'); await f.git.stage(['note.md']);
    await assert.rejects(f.git.saveIndex('note.md', 'my draft\n', base), /暂存区已被/);
    assert.equal((await f.git.file('note.md', INDEX)).text, 'external\n');
    const current = await f.git.file('note.md', INDEX); const lock = join(f.git.repo!.gitDir, 'index.lock'); await writeFile(lock, 'another process');
    await assert.rejects(f.git.saveIndex('note.md', 'draft\n', current), /index.lock/); assert.equal(await readFile(lock, 'utf8'), 'another process');
    await rm(lock); await f.git.saveIndex('note.md', 'retry\n', current); assert.equal((await f.git.file('note.md', INDEX)).text, 'retry\n');
    await assert.rejects(f.git.saveIndex('note.md', 'bad\0data', await f.git.file('note.md', INDEX)), /NUL/);
    await assert.rejects(f.git.saveIndex('note.md', 'x'.repeat(2 * 1024 * 1024 + 1), await f.git.file('note.md', INDEX)), /2 MiB/);
    await assert.rejects(f.git.saveIndex('missing.md', 'new', await f.git.file('missing.md', INDEX)), /无冲突的普通/);
  } finally { await f.close(); }
});

test('saving working files preserves staged snapshot, HEAD, exact line endings and permissions', async () => {
  const f = await fixture(true); try {
    const path = '笔记库/中文 [x] $ ` ;.md'; const head = await f.seed(path, 'original\r\n');
    await writeFile(join(f.root, path), 'staged\r\n'); await f.git.stage([path]);
    await writeFile(join(f.root, path), 'working\r\n'); const base = await f.git.file(path, WORKTREE);
    const staged = (await f.git.file(path, INDEX)).indexEntry, mode = (await stat(join(f.root, path))).mode;
    await f.git.saveWorktree(path, 'edited worktree\r\nno final newline', base);
    assert.equal(await readFile(join(f.root, path), 'utf8'), 'edited worktree\r\nno final newline');
    assert.equal((await f.git.file(path, INDEX)).indexEntry, staged); assert.equal((await f.git.file(path, INDEX)).text, 'staged\r\n');
    assert.equal((await f.git.status()).head, head); assert.equal((await stat(join(f.root, path))).mode, mode);
    assert.equal((await f.git.status()).files.find(file => file.path === path)?.worktree, 'M');
  } finally { await f.close(); }
});

test('untracked and deleted worktree files can be edited or recreated without automatic staging', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'old\n'); await rm(join(f.root, 'note.md'));
    await f.git.saveWorktree('note.md', 'recreated\n', await f.git.file('note.md', WORKTREE));
    await writeFile(join(f.root, 'new.md'), 'new\n'); await f.git.saveWorktree('new.md', 'edited new', await f.git.file('new.md', WORKTREE));
    assert.equal((await f.git.file('note.md', INDEX)).text, 'old\n'); assert.equal((await f.git.file('new.md', INDEX)).exists, false);
    assert.equal((await f.git.status()).files.find(file => file.path === 'new.md')?.untracked, true);
    await assert.rejects(f.git.saveWorktree('../escape.md', 'text', await f.git.file('new.md', WORKTREE)), /超出/);
  } finally { await f.close(); }
});

test('worktree save refuses stale snapshots and unsupported content without invoking its writer', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'old\n'); const base = await f.git.file('note.md', WORKTREE); let called = false;
    await writeFile(join(f.root, 'note.md'), 'new\n');
    await assert.rejects(f.git.saveWorktree('note.md', 'draft\n', base, async () => { called = true; }), /工作区文件已被/); assert.equal(called, false);
    assert.equal(await readFile(join(f.root, 'note.md'), 'utf8'), 'new\n');
    await assert.rejects(f.git.saveWorktree('note.md', 'bad\0text', base), /UTF-8/);
    await assert.rejects(f.git.saveWorktree('note.md', 'x'.repeat(2 * 1024 * 1024 + 1), base), /2 MiB/);
    await writeFile(join(f.root, 'binary.bin'), Buffer.from([0, 1, 2])); await assert.rejects(f.git.saveWorktree('binary.bin', 'text', await f.git.file('binary.bin', WORKTREE)), /UTF-8/);
  } finally { await f.close(); }
});

test('index editing does not reapply clean filters, and works in a linked worktree', async () => {
  const f = await fixture(); let linked: GitService | undefined; try {
    await f.seed('note.md', 'base\n'); const tree = join(f.root, 'linked');
    await f.runner.text(['worktree', 'add', '-b', 'linked', tree]); linked = new GitService(tree); await linked.discover();
    const base = await linked.file('note.md', INDEX); await linked.saveIndex('note.md', 'linked draft\n', base);
    assert.equal((await linked.file('note.md', INDEX)).text, 'linked draft\n'); assert.equal((await f.git.file('note.md', INDEX)).text, 'base\n');
    await writeFile(join(tree, '.gitattributes'), 'note.md filter=qa\n');
    await linked.runner.text(['config', 'filter.qa.clean', 'git hash-object --stdin']);
    await linked.saveIndex('note.md', 'no double filtering\n', await linked.file('note.md', INDEX));
    assert.equal((await linked.file('note.md', INDEX)).text, 'no double filtering\n');
    assert.equal(await readFile(join(tree, 'note.md'), 'utf8'), 'base\n');
  } finally { linked?.dispose(); await f.close(); }
});

test('diagnostics consistently display repository and vault paths with forward slashes', async () => {
  const f = await fixture(true); try {
    const result = await f.git.diagnostics();
    assert.ok(result.includes(`仓库：${f.git.root().replace(/\\/g, '/')}`));
    assert.ok(result.includes(`笔记库：${f.git.vault.replace(/\\/g, '/')}`));
  } finally { await f.close(); }
});
test('history file picker candidates cover nested vault, outside files, deleted files and ignored paths', async () => {
  const f = await fixture(true); try {
    await writeFile(join(f.root, '.gitignore'), '*.ignored\n');
    await f.seed('笔记库/中文 空格.md', 'note\n'); await f.seed('outside.md', 'outside\n'); await f.seed('deleted.md', 'old\n');
    await writeFile(join(f.root, 'pending.md'), 'pending\n'); await writeFile(join(f.root, 'secret.ignored'), 'ignore\n');
    await rm(join(f.root, 'deleted.md')); await f.git.stage(['deleted.md', '笔记库/中文 空格.md']);
    const files = await f.git.historyFiles(); assert.ok(files.includes('笔记库/中文 空格.md')); assert.ok(files.includes('outside.md')); assert.ok(files.includes('deleted.md')); assert.ok(files.includes('pending.md')); assert.ok(!files.includes('secret.ignored')); assert.equal(files.length, new Set(files).size);
  } finally { await f.close(); }
});
test('backups restore exact bytes and discard retains staged content', async () => {
  const f = await fixture(); try {
    const hash = await f.seed('note.md', '一\r\n'); await writeFile(join(f.root, 'note.md'), '二\r\n'); await f.git.stage(['note.md']); await writeFile(join(f.root, 'note.md'), '三\r\n');
    await f.git.discard(['note.md']); assert.equal(await readFile(join(f.root, 'note.md'), 'utf8'), '二\r\n'); const [backup] = await f.git.backups(); await f.git.restoreBackup(backup.id); assert.equal(await readFile(join(f.root, 'note.md'), 'utf8'), '三\r\n');
    await f.git.restoreFile('note.md', { kind: 'commit', ref: hash }); assert.equal(await readFile(join(f.root, 'note.md'), 'utf8'), '一\r\n'); assert.equal((await f.git.file('note.md', INDEX)).text, '二\r\n');
    await writeFile(join(f.root, 'new.md'), '未跟踪'); await f.git.discard(['new.md']); await assert.rejects(stat(join(f.root, 'new.md'))); const item = (await f.git.backups()).find(b => b.path === 'new.md')!; await f.git.restoreBackup(item.id); assert.equal(await readFile(join(f.root, 'new.md'), 'utf8'), '未跟踪');
  } finally { await f.close(); }
});
test('blame uses editor contents and marks modified lines uncommitted', async () => {
  const f = await fixture(); try {
    const hash = await f.seed('note.md', '第一行\n第二行\n'); const rows = await f.git.blame('note.md', '第一行\n未保存的行\n'); assert.equal(rows.length, 2); assert.equal(rows[0].hash, hash); assert.equal(rows[1].uncommitted, true); assert.equal(rows[0].author, 'Git Plus 测试');
    assert.deepEqual(await f.git.blame('new.md', '未跟踪'), []);
  } finally { await f.close(); }
});
test('branches, tags, stash, merge graph and detached HEAD', async () => {
  const f = await fixture(); try {
    const first = await f.seed('base.md', 'base\n'); await f.git.branch('create', 'feature'); await f.seed('feature.md', 'feature\n', '功能提交'); await f.git.branch('switch', 'main'); await f.seed('main.md', 'main\n', '主线提交');
    await f.git.integrate('merge', 'feature'); const commits = await f.git.log(); assert.equal(commits[0].parents.length, 2); const graph = layoutGraph(commits); assert.equal(graph[0].edges.length, 2); assert.ok(graph.some(row => row.width > 1));
    await f.git.tag('create', 'v0.1'); assert.ok((await f.git.refs()).some(r => r.type === 'tag' && r.name === 'v0.1')); await f.git.tag('delete', 'v0.1');
    await writeFile(join(f.root, 'base.md'), 'working\n'); await f.git.stash('save', '临时变化'); assert.equal((await f.git.stashes()).length, 1); await f.git.stash('apply', 'stash@{0}'); assert.equal(await readFile(join(f.root, 'base.md'), 'utf8'), 'working\n'); await f.git.discard(['base.md']); await f.git.stash('pop', 'stash@{0}'); assert.equal((await f.git.stashes()).length, 0); await f.git.discard(['base.md']);
    await f.runner.text(['switch', '--detach', first]); assert.equal((await f.git.status()).branch, '(detached)');
  } finally { await f.close(); }
});
test('attribution preview resolves original line in historical path after rename and later insertions', async () => {
  const f = await fixture(); try {
    const name = '旧文件 空格.md'; await f.seed(name, '标题\n旧内容\n保持\n');
    const hash = await f.seed(name, '标题\n新内容\n保持\n', '修改内容');
    await rename(join(f.root, name), join(f.root, '新文件.md')); await f.git.stage([name, '新文件.md']); await f.git.commit('重命名');
    await writeFile(join(f.root, '新文件.md'), '插入头部\n标题\n新内容\n保持\n'); await f.git.stage(['新文件.md']); await f.git.commit('插入头部');
    const [row] = (await f.git.blame('新文件.md')).filter(row => row.text === '新内容');
    assert.equal(row.hash, hash); assert.equal(row.originalLine, 2); assert.equal(row.line, 3); assert.equal(row.path, name);
    const preview = await f.git.lineChange('新文件.md', row); assert.deepEqual(preview.lines.map(row=>[row.kind,row.text]), [['delete','旧内容'],['add','新内容']]);
    const currentText = '插入头部\n标题\n未保存内容\n保持\n'; const edited = (await f.git.blame('新文件.md', currentText))[2];
    const working = await f.git.lineChange('新文件.md', edited, currentText); assert.equal(working.label, 'HEAD → 当前笔记'); assert.deepEqual(working.lines.map(row=>row.text), ['新内容','未保存内容']);
  } finally { await f.close(); }
});
test('attribution preview handles initial added lines and oversized file contents', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'created\n'); const row = (await f.git.blame('note.md'))[0]; const preview = await f.git.lineChange('note.md', row);
    assert.match(preview.label, /首次新增/); assert.deepEqual(preview.lines.map(row=>[row.kind,row.text]), [['add','created']]);
    const large = await f.git.lineChange('note.md', { ...row, uncommitted: true }, 'x'.repeat(2*1024*1024+1)); assert.match(large.notice!, /2 MiB/); assert.equal(large.lines.length, 0);
  } finally { await f.close(); }
});
test('merge conflicts, editable blocks, external edits and continuation/abort', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'base\n'); await f.git.branch('create', 'other'); await f.seed('note.md', 'theirs\n', '对方修改'); await f.git.branch('switch', 'main'); await f.seed('note.md', 'ours\n', '本地修改');
    await assert.rejects(f.git.integrate('merge', 'other')); let s = await f.git.status(); assert.equal(s.operation, 'merge'); assert.equal(s.files[0].conflict, true);
    let c = await f.git.conflict('note.md'); assert.equal(c.blocks.length, 1); assert.equal(c.ours.text, 'ours\n'); assert.equal(c.theirs.text, 'theirs\n');
    await assert.rejects(f.git.resolveConflict('note.md', 'result', c.result, c.result), /冲突标记/);
    await f.git.resolveConflict('note.md', 'result', 'both\n', c.result); await f.git.continueOperation('merge'); assert.equal((await f.git.status()).files.length, 0);
    await f.git.branch('create', 'conflict-again'); await f.seed('note.md', 'new theirs\n'); await f.git.branch('switch', 'main'); await f.seed('note.md', 'new ours\n'); await assert.rejects(f.git.integrate('merge', 'conflict-again')); await f.git.continueOperation('merge', true); assert.equal((await f.git.status()).operation, undefined);
  } finally { await f.close(); }
});
test('rebase conflicts continue; cherry-pick and revert support continuation', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'base\n'); await f.git.branch('create', 'topic'); const topic = await f.seed('note.md', 'topic\n', 'topic'); await f.git.branch('switch', 'main'); await f.seed('note.md', 'main\n', 'main');
    await f.git.branch('switch', 'topic'); await assert.rejects(f.git.integrate('rebase', 'main')); assert.equal((await f.git.status()).operation, 'rebase'); await f.git.resolveConflict('note.md', 'result', 'combined\n'); await f.git.continueOperation('rebase'); assert.equal((await f.git.status()).operation, undefined);
    await f.git.branch('switch', 'main'); await assert.rejects(f.git.integrate('cherry-pick', topic)); assert.equal((await f.git.status()).operation, 'cherry-pick'); await f.git.resolveConflict('note.md', 'result', 'picked\n'); await f.git.continueOperation('cherry-pick');
    const commit = (await f.git.status()).head; await f.git.integrate('revert', commit); assert.equal(await readFile(join(f.root, 'note.md'), 'utf8'), 'main\n');
  } finally { await f.close(); }
});
test('remote fetch/push/pull and divergent pull failure never force pushes', async () => {
  const f = await fixture(); const remote = await mkdtemp(join(tmpdir(), 'git-plus-remote-')); const cloneRoot = await mkdtemp(join(tmpdir(), 'git-plus-clone-')); const remoteRunner = new GitRunner('git', remote); const cloneRunner = new GitRunner('git', cloneRoot);
  try {
    await remoteRunner.text(['init', '--bare', '--initial-branch=main']); await f.seed('base.md', 'base\n'); await f.git.remote('add', 'origin', remote); await f.git.network('push', 'origin', 'main'); await f.git.testConnection('origin');
    await cloneRunner.text(['clone', remote, '.']); await cloneRunner.text(['config', 'user.name', 'remote']); await cloneRunner.text(['config', 'user.email', 'remote@example.com']);
    await writeFile(join(cloneRoot, 'remote.md'), '远程'); await cloneRunner.text(['add', '.']); await cloneRunner.text(['commit', '-m', '远程提交']); await cloneRunner.text(['push']);
    await f.git.network('fetch'); assert.equal((await f.git.status()).behind, 1); await f.git.network('pull'); assert.equal(await readFile(join(f.root, 'remote.md'), 'utf8'), '远程');
    await f.seed('local.md', '本地'); await writeFile(join(cloneRoot, 'another.md'), '远程2'); await cloneRunner.text(['add', '.']); await cloneRunner.text(['commit', '-m', '远程分叉']); await cloneRunner.text(['push']); await f.git.network('fetch'); const s = await f.git.status(); assert.equal(s.ahead, 1); assert.equal(s.behind, 1); await assert.rejects(f.git.network('pull')); await assert.rejects(f.git.network('push'));
    await f.git.remote('remove', 'origin'); assert.deepEqual(await f.git.remotes(), []);
  } finally { remoteRunner.dispose(); cloneRunner.dispose(); await f.close(); await rm(remote, { recursive: true, force: true }); await rm(cloneRoot, { recursive: true, force: true }); }
});
test('binary, large files, command errors and repository lock', async () => {
  const f = await fixture(); try {
    await f.seed('base.md', 'base'); await writeFile(join(f.root, 'binary.bin'), Buffer.from([1, 0, 2])); await writeFile(join(f.root, 'large.md'), 'x'.repeat(2 * 1024 * 1024 + 1)); await f.git.stage(['binary.bin', 'large.md']); await f.git.commit('大文件');
    assert.equal((await f.git.file('binary.bin', HEAD)).binary, true); assert.equal((await f.git.file('large.md', HEAD)).large, true);
    await assert.rejects(f.git.resolveRef('--help')); await writeFile(join(f.git.repo!.commonDir, 'git-plus.lock'), `${process.pid}:test`); await assert.rejects(f.git.stage(['base.md']), /另一个/); await rm(join(f.git.repo!.commonDir, 'git-plus.lock'));
    await writeFile(join(f.git.repo!.gitDir, 'index.lock'), ''); await writeFile(join(f.root, 'base.md'), 'changed'); await assert.rejects(f.git.stage(['base.md']), /index.lock/); await rm(join(f.git.repo!.gitDir, 'index.lock'));
    const broken = new GitRunner('git-plus-nonexistent', f.root); await assert.rejects(broken.text(['status']), /无法执行/); broken.dispose();
  } finally { await f.close(); }
});
test('conflict parser and status preserve unusual filenames', () => {
  const c = conflictBlocks('before\r\n<<<<<<< HEAD\r\nours\r\n||||||| base\r\nbase\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\nafter\r\n'); assert.equal(c.length, 1); assert.equal(c[0].ours, 'ours\r\n'); assert.equal(c[0].base, 'base\r\n');
  const s = parseStatus('# branch.head main\0# branch.ab +2 -3\0? 文件\t换行\n.md\0'); assert.equal(s.ahead, 2); assert.equal(s.behind, 3); assert.equal(s.files[0].path, '文件\t换行\n.md');
});
test('pagination, all-ref topology, filter dates and detached commit are preserved', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'first\n', 'initial');
    for (let n = 0; n < 7; n++) await f.seed('note.md', `value ${n}\n`, `entry ${n}`);
    const page1 = await f.git.log({}, 0, 3), page2 = await f.git.log({}, 3, 3); assert.equal(page1.length, 3); assert.equal(page2.length, 3); assert.equal(new Set([...page1, ...page2].map(c=>c.hash)).size, 6);
    const graph = layoutGraph(page1); assert.ok(graph.at(-1)!.edges.length > 0); assert.equal((await f.git.log({ message: 'entry', author: 'Git Plus', since: '2000-01-01', until: '2100-01-01' })).length, 7);
    await f.runner.text(['switch', '--detach', page2[0].hash]); const detached = await f.seed('detached.md', 'detached\n', 'detached only'); assert.ok((await f.git.log()).some(c => c.hash === detached));
  } finally { await f.close(); }
});
test('automatic commits whole repository, leaves default idle and pauses on failed sync', async () => {
  const f = await fixture(true); const notices: string[] = []; const settings = { ...DEFAULT_SETTINGS }; const controller = new RepositoryController(f.git, settings, s=>notices.push(s));
  try {
    await f.seed('笔记库/note.md', 'base\n'); await writeFile(join(f.root, 'outside.md'), 'whole repo\n'); await controller.refresh();
    await controller.automation(async()=>{}); assert.equal((await f.git.status()).files.length, 1);
    settings.autoCommit = true; await controller.automation(async()=>{}); assert.equal((await f.git.status()).files.length, 0); assert.match((await f.git.log())[0].subject, /^vault backup: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    settings.autoSync = true; await controller.automation(async()=>{}); assert.equal(controller.automationPaused, true); assert.ok(notices.some(s=>s.includes('已暂停')));
    await writeFile(join(f.root, 'another.md'), 'stay pending\n'); await controller.automation(async()=>{}); assert.equal((await f.git.status()).files.length, 1);
  } finally { controller.dispose(); await f.close(); }
});
test('binary modify/delete conflict uses file-level resolution and backups', async () => {
  const f = await fixture(); try {
    await writeFile(join(f.root, 'binary.bin'), Buffer.from([0, 1, 2])); await f.git.stage(['binary.bin']); await f.git.commit('binary base'); await f.git.branch('create', 'binary-change');
    await writeFile(join(f.root, 'binary.bin'), Buffer.from([0, 3, 4])); await f.git.stage(['binary.bin']); await f.git.commit('binary change'); await f.git.branch('switch', 'main'); await rm(join(f.root, 'binary.bin')); await f.git.stage(['binary.bin']); await f.git.commit('delete binary');
    await assert.rejects(f.git.integrate('merge', 'binary-change')); const conflict = await f.git.conflict('binary.bin'); assert.equal(conflict.fileLevel, true); assert.equal(conflict.ours.exists, false); assert.equal(conflict.theirs.binary, true);
    await f.git.resolveConflict('binary.bin', 'theirs'); await f.git.continueOperation('merge'); assert.deepEqual(await readFile(join(f.root, 'binary.bin')), Buffer.from([0, 3, 4])); assert.ok((await f.git.backups()).length > 0);
  } finally { await f.close(); }
});
test('delete diff, no-final-newline, invalid utf8 and amend preserve correct content', async () => {
  const f = await fixture(); try {
    await f.seed('note.md', 'no newline'); await writeFile(join(f.root, 'note.md'), 'new no newline'); const diff = await f.git.diff('note.md'); assert.match(diff.patch, /No newline/); await f.git.applyHunk(diff, 0); assert.equal((await f.git.file('note.md', INDEX)).text, 'new no newline');
    await f.git.commit('amended', true); assert.equal((await f.git.log()).length, 1); assert.equal((await f.git.log())[0].subject, 'amended');
    await rm(join(f.root, 'note.md')); const deleted = await f.git.diff('note.md'); assert.equal(deleted.after.exists, false); await f.git.applyHunk(deleted, 0); assert.equal((await f.git.status()).files[0].index, 'D'); await f.git.unstage(['note.md']);
    await writeFile(join(f.root, 'invalid.md'), Buffer.from([0xff, 0xfe, 0x41])); assert.equal((await f.git.file('invalid.md', WORKTREE)).binary, true);
  } finally { await f.close(); }
});
