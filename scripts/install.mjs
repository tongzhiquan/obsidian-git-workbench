import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, readdir, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { projectRoot, resolveVaultPath } from './local-config.cjs';
const vault = resolveVaultPath(process.argv[2]);
const config = join(vault, '.obsidian');
await readFile(join(config, 'app.json'), 'utf8');
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (manifest.id !== 'git-workbench') throw new Error('安装目标必须是 git-workbench');
await Promise.all(['main.js', 'styles.css'].map(name => readFile(join('dist', name))));
const target = join(config, 'plugins', manifest.id); await mkdir(target, { recursive: true });
const enabledPath = join(config, 'community-plugins.json'); const original = await readFile(enabledPath, 'utf8'); const enabled = JSON.parse(original);
if (!Array.isArray(enabled)) throw new Error('community-plugins.json must be an array');
let backupDirectory, snapshot = null;
const backup = async (name, text) => {
  if (!backupDirectory) {
    const base = join(projectRoot, '.qa', 'install-backups', manifest.id); await mkdir(base, { recursive: true });
    backupDirectory = await mkdtemp(join(base, 'install-'));
  }
  const file = join(backupDirectory, name); await writeFile(file, text, { flag: 'wx' }); return file;
};
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
  await backup(`${name}.before-migration-${stamp}.json`, text);
  const temporary = file + `.git-workbench-${stamp}.tmp`;
  await writeFile(temporary, JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, file);
  migratedFiles.push(name);
}
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(join('dist', name), join(target, name));
// Archive only files previously installed by this script; retain settings and unknown user files.
const archivedFiles = [];
for (const name of await readdir(target)) {
  if (!['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'THIRD-PARTY-LICENSES.txt'].includes(name) && !/^(community-plugins\.before-install-\d+|(?:hotkeys|workspace|workspace-mobile)\.json\.before-migration-\d+)\.json$/.test(name)) continue;
  const file = join(target, name), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) continue;
  await backup(name, await readFile(file)); await unlink(file); archivedFiles.push(name);
}
// Preserve previous settings on upgrades. New installation has automation disabled by default.
const legacyIds = ['obsidian-git', 'git-plus'];
const next = enabled.filter(id => !legacyIds.includes(id)); if (!next.includes(manifest.id)) next.push(manifest.id);
if (JSON.stringify(next) !== JSON.stringify(enabled)) {
  snapshot = await backup('community-plugins.before-install.json', original);
  const temporary = enabledPath + `.git-workbench-${Date.now()}.tmp`; await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, enabledPath);
}
console.log(JSON.stringify({ installed: target, snapshot, backupDirectory: backupDirectory ?? null, archivedFiles, disabled: legacyIds, enabled: manifest.id, migratedSettings, migratedFiles, vault }, null, 2));
console.log('安装完成。仅安装运行文件并保留已有设置；配置备份及旧随附文件保存在项目 .qa/install-backups。运行 npm run reload-local 重载插件。');
