import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService } from '../src/git/service';
import { RepositoryController } from '../src/controller';
import { lineBlocks, lineEdits, selectedText } from '../src/git/line-edits';
import { DEFAULT_SETTINGS, EMPTY, HEAD, INDEX, WORKTREE } from '../src/types';

test('line selections preserve replacements, adjacent insertions, removals and terminators', () => {
  const model = lineEdits('one\r\ntwo\r\nthree', 'ONE\r\nTWO\r\nextra\r\nthree')!;
  assert.equal(model.edits.length, 3);
  assert.equal(selectedText(model, [1]), 'one\r\nTWO\r\nthree');
  assert.equal(selectedText(model, [2]), 'one\r\ntwo\r\nextra\r\nthree');
  assert.equal(selectedText(model, [2, 0]), 'ONE\r\ntwo\r\nextra\r\nthree');
  assert.equal(selectedText(model, [0, 1, 2], true), 'one\r\ntwo\r\nthree');
  const added = lineEdits('a', 'a\nb\nc\n')!;
  assert.equal(selectedText(added, added.edits.map(e => e.id)), 'a\nb\nc\n');
  assert.equal(lineEdits('a\n', 'a\r\n')!.edits.length, 0);
  assert.equal(selectedText(lineEdits('a\n', 'a')!, [0]), 'a');
  assert.throws(() => selectedText(model, [50]), /有效/);
  assert.throws(() => selectedText(model, [0, 0]), /有效/);
});

test('blocks group adjacent replacements and unequal insertions but stop at unchanged lines', () => {
  const before = 'start\nold one\nold two\nseparator\nremove one\nremove two\nend';
  const after = 'start\nNEW one\nNEW two\nextra\nseparator\nend';
  const model = lineEdits(before, after)!, blocks = lineBlocks(model);
  assert.deepEqual(blocks.map(block => [block.beforeIndex, block.afterIndex, block.beforeCount, block.afterCount, block.edits.map(edit => edit.id)]), [[1, 1, 2, 3, [0, 1, 2]], [4, 5, 2, 0, [3, 4]]]);
  assert.equal(selectedText(model, blocks[0].edits.map(edit => edit.id)), 'start\nNEW one\nNEW two\nextra\nseparator\nremove one\nremove two\nend');
  assert.equal(selectedText(model, blocks[1].edits.map(edit => edit.id), true), 'start\nNEW one\nNEW two\nextra\nseparator\nremove one\nremove two\nend');
  assert.deepEqual(lineBlocks(lineEdits('same\n', 'same\n')!), []);
});

test('blocks retain empty-side anchors, CRLF, repeated lines and final-newline edits', () => {
  for (const [before, after] of [['', 'one\r\ntwo'], ['one\r\ntwo', ''], ['a\nb\n', 'a\nb'], ['a\na\nb\na', 'A\na\nb\nA'], ['old\nextra\ntail', 'NEW\ntail']]) {
    const model = lineEdits(before, after)!, blocks = lineBlocks(model), ids = blocks.flatMap(block => block.edits.map(edit => edit.id));
    assert.deepEqual(ids, model.edits.map(edit => edit.id));
    assert.equal(selectedText(model, ids), after);
    assert.equal(selectedText(model, ids, true), before);
    for (const block of blocks) assert.ok(block.beforeCount || block.afterCount);
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-lines-'));
  const git = new GitService(root), run = (...args: string[]) => git.runner.text(args);
  await run('init', '--initial-branch=main'); await run('config', 'user.name', 'QA'); await run('config', 'user.email', 'qa@example.com'); await run('config', 'core.autocrlf', 'false'); await run('config', 'core.filemode', 'false'); await git.discover();
  return { root, git, run, close: async () => { git.dispose(); await rm(root, { recursive: true, force: true }); } };
}
test('block stage and unstage isolate nearby blocks even within one Git hunk', async () => {
  const f = await fixture(), path = 'blocks.md';
  const before = 'start\r\nold one\r\nold two\r\nseparator\r\nremove one\r\nremove two\r\nend';
  const after = 'start\r\nNEW one\r\nNEW two\r\nextra\r\nseparator\r\nend';
  try {
    await writeFile(join(f.root, path), before); await f.git.stage([path]); await f.git.commit('blocks baseline');
    await writeFile(join(f.root, 'other.md'), 'already staged'); await f.git.stage(['other.md']);
    const other = (await f.git.file('other.md', INDEX)).indexEntry, head = (await f.git.status()).head;
    await writeFile(join(f.root, path), after); const diff = await f.git.diff(path);
    assert.equal(diff.hunks.length, 1);
    const blocks = lineBlocks(lineEdits(before, after)!); assert.equal(blocks.length, 2);
    const remaining = await f.git.applyLines(diff, blocks[0].edits.map(edit => edit.id));
    assert.equal(remaining.before.text, 'start\r\nNEW one\r\nNEW two\r\nextra\r\nseparator\r\nremove one\r\nremove two\r\nend');
    await assert.rejects(f.git.applyLines(diff, blocks[1].edits.map(edit => edit.id)), /已变化/);
    const staged = await f.git.diff(path, HEAD, INDEX), stagedBlock = lineBlocks(lineEdits(staged.before.text, staged.after.text)!)[0];
    await f.git.applyLines(staged, stagedBlock.edits.map(edit => edit.id));
    assert.equal((await f.git.file(path, INDEX)).text, before);
    assert.equal((await f.git.file('other.md', INDEX)).indexEntry, other);
    assert.equal(await readFile(join(f.root, path), 'utf8'), after);
    assert.equal((await f.git.status()).head, head);
  } finally { await f.close(); }
});

test('stage and unstage individual adjacent changes preserve other index entries, mode, worktree and HEAD', async () => {
  const f = await fixture(); const path = '中文 $ [x].md', before = 'one\r\ntwo\r\nthree\r\nfour';
  try {
    await writeFile(join(f.root, path), before); await f.git.stage([path]); await f.git.commit('base');
    await f.run('update-index', '--chmod=+x', '--', path); await f.git.commit('mode'); const head = (await f.git.status()).head;
    await writeFile(join(f.root, 'other.md'), 'other'); await f.git.stage(['other.md']);
    const after = 'ONE\r\nTWO\r\nextra\r\nthree\r\nfour'; await writeFile(join(f.root, path), after);
    const diff = await f.git.diff(path); assert.equal(diff.lineActions, true);
    const result = await f.git.applyLines(diff, [1]); assert.equal((await f.git.file(path, INDEX)).text, before.replace('two', 'TWO'));
    assert.deepEqual(result.before, await f.git.file(path, INDEX)); assert.deepEqual(result.after, await f.git.file(path, WORKTREE));
    assert.match((await f.git.file(path, INDEX)).indexEntry!, /^100755 /);
    const staged = await f.git.diff(path, HEAD, INDEX); const unstaged = await f.git.applyLines(staged, [0]);
    assert.deepEqual(unstaged.after, await f.git.file(path, INDEX));
    assert.equal((await f.git.file(path, INDEX)).text, before);
    assert.equal((await f.git.file('other.md', INDEX)).text, 'other'); assert.equal(await readFile(join(f.root, path), 'utf8'), after); assert.equal((await f.git.status()).head, head);
  } finally { await f.close(); }
});
test('initial untracked files support partial stage, empty-base unstage and complete deletion', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'new.md'), 'one\ntwo\nthree');
    await f.git.applyLines(await f.git.diff('new.md'), [1]); assert.equal((await f.git.file('new.md', INDEX)).text, 'two\n');
    await f.git.applyLines(await f.git.diff('new.md', EMPTY, INDEX), [0]); assert.equal((await f.git.file('new.md', INDEX)).exists, false);
    await f.git.stage(['new.md']); await f.git.commit('new'); await rm(join(f.root, 'new.md'));
    await f.git.applyLines(await f.git.diff('new.md'), [1]); assert.equal((await f.git.file('new.md', INDEX)).text, 'one\nthree');
    const rest = await f.git.diff('new.md'); await f.git.applyLines(rest, lineEdits(rest.before.text, rest.after.text)!.edits.map(e => e.id));
    assert.equal((await f.git.file('new.md', INDEX)).exists, false);
  } finally { await f.close(); }
});
test('stale content, external index changes, filters, modes and existing locks refuse partial writes', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'note.md'), 'one\ntwo\n'); await f.git.stage(['note.md']); await f.git.commit('base');
    await writeFile(join(f.root, 'note.md'), 'ONE\ntwo\n'); const diff = await f.git.diff('note.md');
    await writeFile(join(f.root, 'note.md'), 'external\ntwo\n'); await assert.rejects(f.git.applyLines(diff, [0]), /已变化/);
    await writeFile(join(f.root, 'note.md'), 'ONE\ntwo\n'); await f.git.stage(['note.md']); await assert.rejects(f.git.applyLines(diff, [0]), /已变化/);
    await f.git.unstage(['note.md']); const fresh = await f.git.diff('note.md');
    await writeFile(join(f.git.repo!.gitDir, 'index.lock'), 'external-lock'); await assert.rejects(f.git.applyLines(fresh, [0]), /index.lock/); assert.equal(await readFile(join(f.git.repo!.gitDir, 'index.lock'), 'utf8'), 'external-lock'); await rm(join(f.git.repo!.gitDir, 'index.lock'));
    await writeFile(join(f.root, '.gitattributes'), 'note.md filter=custom\n'); assert.equal((await f.git.diff('note.md')).lineActions, false);
    await rm(join(f.root, '.gitattributes')); await f.run('update-index', '--chmod=+x', '--', 'note.md'); assert.equal((await f.git.diff('note.md', HEAD, INDEX)).lineActions, false);
    assert.equal((await readdir(f.git.repo!.gitDir)).some(name => /git-workbench-|index.lock/.test(name)), false);
  } finally { await f.close(); }
});
test('partially unstaging a deleted executable preserves its mode and deleted symlinks stay excluded', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'script.sh'), 'one\ntwo\n'); await f.git.stage(['script.sh']);
    await f.run('update-index', '--chmod=+x', '--', 'script.sh'); await f.git.commit('executable');
    await rm(join(f.root, 'script.sh')); await f.git.stage(['script.sh']);
    await f.git.applyLines(await f.git.diff('script.sh', HEAD, INDEX), [0]);
    const restored = await f.git.file('script.sh', INDEX);
    assert.equal(restored.text, 'one\n'); assert.match(restored.indexEntry!, /^100755 /);
    assert.equal((await f.git.file('script.sh', WORKTREE)).exists, false);
    const object = (await f.git.runner.text(['hash-object', '-w', '--stdin'], { input: 'target\n' })).trim();
    await f.run('update-index', '--add', '--cacheinfo', '120000', object, 'link'); await f.git.commit('link');
    await f.run('update-index', '--force-remove', '--', 'link');
    assert.equal((await f.git.diff('link', HEAD, INDEX)).lineActions, false);
  } finally { await f.close(); }
});

test('partial staging honors Git CRLF normalization; restore validates the index and only writes working text', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'note.md'), 'one\ntwo\n'); await f.git.stage(['note.md']); await f.git.commit('base'); await f.run('config', 'core.autocrlf', 'true');
    await writeFile(join(f.root, 'note.md'), 'ONE\r\nTWO\r\n'); const diff = await f.git.diff('note.md'); const result = await f.git.applyLines(diff, [0]);
    assert.deepEqual(result.before, await f.git.file('note.md', INDEX));
    assert.equal((await f.git.file('note.md', INDEX)).text, 'ONE\ntwo\n');
    const remaining = await f.git.diff('note.md'); const model = lineEdits(remaining.before.text, remaining.after.text)!;
    const restored = selectedText(model, [0], true); await f.git.saveWorktree('note.md', restored, remaining.after, undefined, remaining.before);
    assert.equal(await readFile(join(f.root, 'note.md'), 'utf8'), 'ONE\r\ntwo\r\n'); assert.equal((await f.git.file('note.md', INDEX)).text, 'ONE\ntwo\n');
    await f.git.unstage(['note.md']); await assert.rejects(f.git.saveWorktree('note.md', restored, await f.git.file('note.md', WORKTREE), undefined, remaining.before), /暂存区已变化/);
  } finally { await f.close(); }
});

test('a late diff response cannot replace the cache after a newer repository generation', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'note.md'), 'base\n'); await f.git.stage(['note.md']); await f.git.commit('base');
    await writeFile(join(f.root, 'note.md'), 'old\n');
    const controller = new RepositoryController(f.git, { ...DEFAULT_SETTINGS }, () => {});
    const original = f.git.diff.bind(f.git); let calls = 0, release!: () => void, read!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; }), firstRead = new Promise<void>(resolve => { read = resolve; });
    f.git.diff = async (...args) => { const first = ++calls === 1, snapshot = await original(...args); if (first) { read(); await delayed; } return snapshot; };
    const older = controller.diff('note.md', INDEX, WORKTREE); await firstRead;
    await writeFile(join(f.root, 'note.md'), 'new\n'); controller.invalidate();
    const newer = await controller.diff('note.md', INDEX, WORKTREE); release(); await older;
    assert.equal((await controller.diff('note.md', INDEX, WORKTREE)).after.text, 'new\n'); assert.equal(newer.after.text, 'new\n'); assert.equal(calls, 2);
    controller.dispose();
  } finally { await f.close(); }
});
