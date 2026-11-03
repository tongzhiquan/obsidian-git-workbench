import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';

test('packaging includes bilingual docs and images, keeps licenses and removes stale standalone license assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-package-'));
  try {
    await mkdir(join(root, 'dist')); await mkdir(join(root, 'release'));
    const manifest = { id: 'git-workbench', version: '1.2.3' };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'dist', 'manifest.json'), JSON.stringify(manifest));
    for (const name of ['main.js', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt']) await writeFile(join(root, 'dist', name), `fixture ${name}`);
    for (const name of ['README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) await writeFile(join(root, name), `fixture ${name}`);
    await writeFile(join(root, 'README.md'), '[English](README.en.md)\n\n![功能截图](docs/images/feature.png)\n');
    await writeFile(join(root, 'README.en.md'), '[简体中文](README.md)\n\n![Feature](docs/images/feature.png)\n');
    await mkdir(join(root, 'docs', 'images'), { recursive: true });
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await writeFile(join(root, 'docs', 'images', 'feature.png'), image);
    await writeFile(join(root, 'docs', 'images', 'capture.log'), 'not a release image');
    for (const name of ['LICENSE', 'THIRD-PARTY-LICENSES.txt']) await writeFile(join(root, 'release', name), 'old standalone asset');
    execFileSync(process.execPath, [resolve('scripts/package.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.deepEqual((await readdir(join(root, 'release'))).sort(), ['git-workbench-1.2.3.zip', 'main.js', 'manifest.json', 'styles.css'].sort());
    const files = unzipSync(await readFile(join(root, 'release', 'git-workbench-1.2.3.zip')));
    assert.equal(Object.keys(files).length, 10);
    assert.deepEqual(Buffer.from(files['git-workbench/docs/images/feature.png']), image);
    for (const name of ['README.md', 'README.en.md']) {
      assert.equal(strFromU8(files[`git-workbench/${name}`]), await readFile(join(root, name), 'utf8'));
      for (const match of strFromU8(files[`git-workbench/${name}`]).matchAll(/\]\(([^)]+)\)/g)) assert.ok(files[`git-workbench/${match[1]}`], `Missing linked ZIP file: ${match[1]}`);
    }
    assert.equal(strFromU8(files['git-workbench/LICENSE']), 'fixture LICENSE');
    assert.equal(strFromU8(files['git-workbench/THIRD-PARTY-LICENSES.txt']), 'fixture THIRD-PARTY-LICENSES.txt');
    assert.equal(await readFile(join(root, 'dist', 'LICENSE'), 'utf8'), 'fixture LICENSE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
