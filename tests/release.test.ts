import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/prepare-release.mjs');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-workbench-release-'));
  const files: Record<string, unknown> = {
    'manifest.json': { id: 'git-workbench', version: '1.2.3', minAppVersion: '1.14.4' },
    'package.json': { name: 'obsidian-git-workbench', version: '1.2.3' },
    'package-lock.json': { name: 'obsidian-git-workbench', version: '1.2.3', packages: { '': { name: 'obsidian-git-workbench', version: '1.2.3' } } },
    'versions.json': { '1.2.3': '1.14.4' },
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(root, name), JSON.stringify(value));
  const changelog = '# Changelog\r\n\r\n## 未发布\r\n\r\nUnreleased work\r\n\r\n## [1.2.3] - 2026-10-19\r\n\r\n### 新增\r\n\r\n- Release feature.\r\n\r\n## [1.2.2] - 2026-10-18\r\n\r\nPrevious work\r\n';
  await writeFile(join(root, 'CHANGELOG.md'), changelog);
  const run = (tag: string) => spawnSync(process.execPath, [script, tag, join(root, 'notes.md')], {
    cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: join(root, 'outputs') },
  });
  return { root, files, run, close: () => rm(root, { recursive: true, force: true }) };
}

test('release accepts an exact version tag and extracts only the dated release notes', async () => {
  const f = await fixture();
  try {
    const result = f.run('1.2.3');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), '### 新增\n\n- Release feature.\n');
    assert.match(await readFile(join(f.root, 'outputs'), 'utf8'), /version=1\.2\.3\narchive=git-workbench-1\.2\.3\.zip\n/);
  } finally { await f.close(); }
});

test('release rejects mismatched tags and metadata before producing notes', async () => {
  const cases: [string, string, unknown, RegExp][] = [
    ['v1.2.3', 'package.json', { name: 'obsidian-git-workbench', version: '1.2.3' }, /without a v prefix/],
    ['9.9.9', 'package.json', { name: 'obsidian-git-workbench', version: '1.2.3' }, /does not match/],
    ['1.2.3', 'package.json', { name: 'obsidian-git-workbench', version: '1.2.4' }, /versions must match/],
    ['1.2.3', 'package-lock.json', { version: '1.2.3', packages: { '': { version: '1.2.4' } } }, /versions must match/],
    ['1.2.3', 'versions.json', { '1.2.3': '1.0.0' }, /versions.json must map/],
    ['1.2.3', 'manifest.json', { id: 'git-plus', version: '1.2.3', minAppVersion: '1.14.4' }, /names must match/],
    ['v1.2.3-beta.1', 'manifest.json', { id: 'git-workbench', version: '1.2.3-beta.1' }, /stable X.Y.Z/],
  ];
  for (const [tag, file, value, error] of cases) {
    const f = await fixture();
    try {
      await writeFile(join(f.root, file), JSON.stringify(value));
      const result = f.run(tag);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, error);
      await assert.rejects(readFile(join(f.root, 'notes.md')));
    } finally { await f.close(); }
  }
});

test('release requires nonempty versioned changelog notes and removes link definitions', async () => {
  const f = await fixture();
  try {
    for (const text of ['## 未发布\n\n- Pending.\n', '## [1.2.3] - 2026-10-19\n\n']) {
      await writeFile(join(f.root, 'CHANGELOG.md'), text);
      assert.notEqual(f.run('1.2.3').status, 0);
    }
    await writeFile(join(f.root, 'CHANGELOG.md'), '## [1.2.3] - 2026-10-19\n\n- Published.\n\n[1.2.3]: https://example.com/releases/1.2.3\n');
    const result = f.run('1.2.3');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(f.root, 'notes.md'), 'utf8'), '- Published.\n');
  } finally { await f.close(); }
});
