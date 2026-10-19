import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of ['manifest.json', 'styles.css', 'LICENSE']) await copyFile(name, `dist/${name}`);
const license = await readFile('LICENSE', 'utf8');
const thirdParty = (await Promise.all(['diff', '@codemirror/merge', '@codemirror/commands', 'style-mod'].map(async name => `${name}\n\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`))).join('\n\n');
await writeFile('dist/THIRD-PARTY-LICENSES.txt', thirdParty);
const config = {
  entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true,
  platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'info',
  external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/*'],
  banner: { js: `/*! Git Workbench\n${license}\nThird-party notices\n${thirdParty}\n*/` },
};
if (process.argv.includes('--watch')) { const context = await esbuild.context(config); await context.watch(); }
else await esbuild.build(config);
