import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('release', { recursive: true });
const names = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt'];
const files = {};
for (const name of names) { files[`${manifest.id}/${name}`] = new Uint8Array(await readFile(`dist/${name}`)); await copyFile(`dist/${name}`, `release/${name}`); }
for (const name of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md']) files[`${manifest.id}/${name}`] = strToU8(await readFile(name, 'utf8'));
await writeFile(`release/git-workbench-${manifest.version}.zip`, zipSync(files));
console.log(`Packaged release/git-workbench-${manifest.version}.zip`);
