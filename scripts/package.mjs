import { mkdir, readFile, writeFile, copyFile, unlink, readdir } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('release', { recursive: true });
const names = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt'];
const files = {};
for (const name of names) {
  files[`${manifest.id}/${name}`] = new Uint8Array(await readFile(`dist/${name}`));
  if (['main.js', 'manifest.json', 'styles.css'].includes(name)) await copyFile(`dist/${name}`, `release/${name}`);
}
// Keep notices in the ZIP and bundle, rather than as separate release assets.
for (const name of ['LICENSE', 'THIRD-PARTY-LICENSES.txt']) {
  await unlink(`release/${name}`).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
for (const name of ['README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) files[`${manifest.id}/${name}`] = strToU8(await readFile(name, 'utf8'));
for (const entry of await readdir('docs/images', { withFileTypes: true })) {
  if (entry.isFile() && /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) files[`${manifest.id}/docs/images/${entry.name}`] = new Uint8Array(await readFile(`docs/images/${entry.name}`));
}
await writeFile(`release/git-workbench-${manifest.version}.zip`, zipSync(files));
console.log(`Packaged release/git-workbench-${manifest.version}.zip`);
