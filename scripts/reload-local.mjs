import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { readLocalConfig, resolveVaultPath } from './local-config.cjs';

const run = promisify(execFile);
const vault = resolveVaultPath(process.argv[2]);
const cli = process.env.OBSIDIAN_CLI || readLocalConfig().obsidianCli || 'obsidian';
const target = `vault=${basename(vault)}`;
const command = async (...args) => (await run(cli, [target, ...args], { cwd: vault, windowsHide: true, timeout: 15000, encoding: 'utf8' })).stdout.trim();
const reported = await command('vault', 'info=path');
const canonical = async path => {
  const actual = await realpath(resolve(path));
  return process.platform === 'win32' ? actual.toLowerCase() : actual;
};
if (await canonical(reported) !== await canonical(vault)) throw new Error('CLI 返回的笔记库路径与目标不同，已停止重载。请检查同名笔记库。');
console.log(await command('plugin:reload', 'id=git-plus'));
