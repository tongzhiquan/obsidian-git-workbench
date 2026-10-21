import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';

test('packaging keeps licenses inside the ZIP and removes stale standalone license assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-package-'));
  try {
    await mkdir(join(root, 'dist')); await mkdir(join(root, 'release'));
    const manifest = { id: 'git-workbench', version: '1.2.3' };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'dist', 'manifest.json'), JSON.stringify(manifest));
    for (const name of ['main.js', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt']) await writeFile(join(root, 'dist', name), `fixture ${name}`);
    for (const name of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) await writeFile(join(root, name), `fixture ${name}`);
    for (const name of ['LICENSE', 'THIRD-PARTY-LICENSES.txt']) await writeFile(join(root, 'release', name), 'old standalone asset');
    execFileSync(process.execPath, [resolve('scripts/package.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.deepEqual((await readdir(join(root, 'release'))).sort(), ['git-workbench-1.2.3.zip', 'main.js', 'manifest.json', 'styles.css'].sort());
    const files = unzipSync(await readFile(join(root, 'release', 'git-workbench-1.2.3.zip')));
    assert.equal(Object.keys(files).length, 8);
    assert.equal(strFromU8(files['git-workbench/LICENSE']), 'fixture LICENSE');
    assert.equal(strFromU8(files['git-workbench/THIRD-PARTY-LICENSES.txt']), 'fixture THIRD-PARTY-LICENSES.txt');
    assert.equal(await readFile(join(root, 'dist', 'LICENSE'), 'utf8'), 'fixture LICENSE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
