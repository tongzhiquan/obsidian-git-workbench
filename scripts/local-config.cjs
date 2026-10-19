const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const projectRoot = resolve(__dirname, '..');

function readLocalConfig() {
  let file = resolve(projectRoot, 'git-workbench.local.json');
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    file = resolve(projectRoot, 'git-plus.local.json');
    try { text = readFileSync(file, 'utf8'); }
    catch (legacyError) { if (legacyError.code === 'ENOENT') return {}; throw legacyError; }
  }
  let config;
  try { config = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error(`${file} 必须是有效的 JSON。`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${file} 必须是 JSON 对象。`);
  for (const key of ['vaultPath', 'obsidianAsar', 'obsidianLauncherAsar', 'obsidianCli']) {
    if (config[key] !== undefined && typeof config[key] !== 'string') throw new Error(`${file} 的 ${key} 必须是字符串。`);
  }
  return config;
}

function resolveVaultPath(argument) {
  const path = argument || process.env.GIT_WORKBENCH_VAULT || process.env.GIT_PLUS_VAULT || readLocalConfig().vaultPath;
  if (!path) throw new Error('请传入笔记库路径，或设置 GIT_WORKBENCH_VAULT / git-workbench.local.json 的 vaultPath。示例：npm run install-local -- "/path/to/vault"');
  return resolve(projectRoot, path);
}

module.exports = { projectRoot, readLocalConfig, resolveVaultPath };
