import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveVaultPath } from './local-config.cjs';
const vault = resolveVaultPath(process.argv[2]);
const config = join(vault, '.obsidian');
await readFile(join(config, 'app.json'), 'utf8');
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const target = join(config, 'plugins', manifest.id); await mkdir(target, { recursive: true });
const enabledPath = join(config, 'community-plugins.json'); const original = await readFile(enabledPath, 'utf8'); const enabled = JSON.parse(original);
if (!Array.isArray(enabled)) throw new Error('community-plugins.json must be an array');
const snapshot = join(target, `community-plugins.before-install-${Date.now()}.json`); await writeFile(snapshot, original, { flag: 'wx' });
for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt']) await copyFile(join('dist', name), join(target, name));
await copyFile('README.md', join(target, 'README.md'));
await copyFile('CHANGELOG.md', join(target, 'CHANGELOG.md'));
await copyFile('CONTRIBUTING.md', join(target, 'CONTRIBUTING.md'));
// Preserve previous settings on upgrades. New installation has automation disabled by default.
const next = enabled.filter(id => id !== 'obsidian-git'); if (!next.includes(manifest.id)) next.push(manifest.id);
if (JSON.stringify(next) !== JSON.stringify(enabled)) {
  const temporary = enabledPath + `.git-plus-${Date.now()}.tmp`; await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, enabledPath);
}
console.log(JSON.stringify({ installed: target, snapshot, disabled: 'obsidian-git', enabled: manifest.id, vault }, null, 2));
console.log('安装完成。CLI 可用时运行 npm run reload-local，或在 Obsidian 中重载插件。原插件文件和设置已保留。');
