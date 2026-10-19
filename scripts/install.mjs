import { mkdir, readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
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
// Copy settings only on the first migration; later upgrades keep the new settings.
let migratedSettings = false;
try {
  await copyFile(join(config, 'plugins', 'git-plus', 'data.json'), join(target, 'data.json'), constants.COPYFILE_EXCL);
  migratedSettings = true;
} catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error; }
const migrateId = value => {
  if (value.startsWith('git-plus:')) return 'git-workbench:' + value.slice('git-plus:'.length).replaceAll('Git Plus', 'Git Workbench');
  if (['git-plus-workbench', 'git-plus-source-control', 'git-plus-logo'].includes(value)) return value.replace('git-plus', 'git-workbench');
  return value;
};
const migrate = value => {
  if (typeof value === 'string') return migrateId(value);
  if (Array.isArray(value)) return value.map(migrate);
  if (value && typeof value === 'object') {
    const result = {};
    // Explicit new IDs take precedence over migrated legacy entries.
    for (const [key, entry] of Object.entries(value)) if (migrateId(key) === key) result[key] = migrate(entry);
    for (const [key, entry] of Object.entries(value)) if (migrateId(key) !== key && !Object.hasOwn(result, migrateId(key))) result[migrateId(key)] = migrate(entry);
    return result;
  }
  return value;
};
const migratedFiles = [];
for (const name of ['hotkeys.json', 'workspace.json', 'workspace-mobile.json']) {
  const file = join(config, name);
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const before = JSON.parse(text), after = migrate(before);
  if (JSON.stringify(before) === JSON.stringify(after)) continue;
  const stamp = Date.now();
  await writeFile(join(target, `${name}.before-migration-${stamp}.json`), text, { flag: 'wx' });
  const temporary = file + `.git-workbench-${stamp}.tmp`;
  await writeFile(temporary, JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, file);
  migratedFiles.push(name);
}
for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt']) await copyFile(join('dist', name), join(target, name));
await copyFile('README.md', join(target, 'README.md'));
await copyFile('CHANGELOG.md', join(target, 'CHANGELOG.md'));
await copyFile('CONTRIBUTING.md', join(target, 'CONTRIBUTING.md'));
// Preserve previous settings on upgrades. New installation has automation disabled by default.
const legacyIds = ['obsidian-git', 'git-plus'];
const next = enabled.filter(id => !legacyIds.includes(id)); if (!next.includes(manifest.id)) next.push(manifest.id);
if (JSON.stringify(next) !== JSON.stringify(enabled)) {
  const temporary = enabledPath + `.git-workbench-${Date.now()}.tmp`; await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, enabledPath);
}
console.log(JSON.stringify({ installed: target, snapshot, disabled: legacyIds, enabled: manifest.id, migratedSettings, migratedFiles, vault }, null, 2));
console.log('安装完成。CLI 可用时运行 npm run reload-local，或在 Obsidian 中启用 Git Workbench。旧插件文件和设置已保留。');
