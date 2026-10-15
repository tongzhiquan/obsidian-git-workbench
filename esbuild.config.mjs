import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of ['manifest.json', 'styles.css', 'LICENSE']) await copyFile(name, `dist/${name}`);
const license = await readFile('LICENSE', 'utf8');
const thirdParty = 'diff (BSD-3-Clause)\n\n' + await readFile('node_modules/diff/LICENSE', 'utf8');
await writeFile('dist/THIRD-PARTY-LICENSES.txt', thirdParty);
const config = {
  entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true,
  platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'info',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  banner: { js: `/*! Git Plus\n${license}\nThird-party notices\n${thirdParty}\n*/` },
};
if (process.argv.includes('--watch')) { const context = await esbuild.context(config); await context.watch(); }
else await esbuild.build(config);
