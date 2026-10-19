import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('installation migrates legacy settings and IDs without overwriting new settings or changing note paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-install-'));
  try {
    const vault = join(root, 'vault'), config = join(vault, '.obsidian'), target = join(config, 'plugins', 'git-workbench');
    await mkdir(join(config, 'plugins', 'git-plus'), { recursive: true });
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'dist'));
    for (const name of ['install.mjs', 'local-config.cjs']) await copyFile(resolve('scripts', name), join(root, 'scripts', name));
    for (const name of ['main.js', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt']) await writeFile(join(root, 'dist', name), 'fixture');
    await writeFile(join(root, 'dist', 'manifest.json'), JSON.stringify({ id: 'git-workbench', name: 'Git Workbench' }));
    for (const name of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) await writeFile(join(root, name), 'fixture');
    await writeFile(join(config, 'app.json'), '{}');
    const enabled = '["other", "obsidian-git", "git-plus"]';
    await writeFile(join(config, 'community-plugins.json'), enabled);
    const legacy = JSON.stringify({ settings: { intervalMinutes: 23, autoCommit: false }, legacyDraft: 'preserve' });
    await writeFile(join(config, 'plugins', 'git-plus', 'data.json'), legacy);
    await writeFile(join(config, 'hotkeys.json'), JSON.stringify({ 'git-plus:commit': [{ key: 'G' }], 'git-plus:fetch': [{ key: 'F' }], 'git-workbench:fetch': [{ key: 'N' }] }));
    await writeFile(join(config, 'workspace.json'), JSON.stringify({ view: 'git-plus-workbench', side: 'git-plus-source-control', file: 'git-plus-notes.md', hiddenRibbonItems: { 'git-plus:Git Plus': true } }));
    const run = () => JSON.parse(execFileSync(process.execPath, [join(root, 'scripts', 'install.mjs'), vault], { cwd: root, encoding: 'utf8', windowsHide: true }).split('安装完成。')[0]);
    const result = run();
    assert.equal(result.migratedSettings, true);
    assert.equal(await readFile(join(target, 'data.json'), 'utf8'), legacy);
    assert.equal(await readFile(result.snapshot, 'utf8'), enabled);
    assert.deepEqual(JSON.parse(await readFile(join(config, 'community-plugins.json'), 'utf8')), ['other', 'git-workbench']);
    const hotkeys = JSON.parse(await readFile(join(config, 'hotkeys.json'), 'utf8'));
    assert.deepEqual(hotkeys['git-workbench:commit'], [{ key: 'G' }]);
    assert.deepEqual(hotkeys['git-workbench:fetch'], [{ key: 'N' }]);
    assert.equal(hotkeys['git-plus:commit'], undefined);
    const workspace = JSON.parse(await readFile(join(config, 'workspace.json'), 'utf8'));
    assert.equal(workspace.view, 'git-workbench-workbench');
    assert.equal(workspace.side, 'git-workbench-source-control');
    assert.equal(workspace.file, 'git-plus-notes.md');
    assert.equal(workspace.hiddenRibbonItems['git-workbench:Git Workbench'], true);
    assert.equal(await readFile(join(config, 'plugins', 'git-plus', 'data.json'), 'utf8'), legacy);
    await writeFile(join(target, 'data.json'), '{"updated":true}');
    const enabledAfter = await readFile(join(config, 'community-plugins.json'), 'utf8');
    assert.equal(run().migratedSettings, false);
    assert.equal(await readFile(join(target, 'data.json'), 'utf8'), '{"updated":true}');
    assert.equal(await readFile(join(config, 'community-plugins.json'), 'utf8'), enabledAfter);
  } finally { await rm(root, { recursive: true, force: true }); }
});
