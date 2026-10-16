import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('release', { recursive: true });
const names = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD-PARTY-LICENSES.txt'];
const files = {};
for (const name of names) { files[`git-plus/${name}`] = new Uint8Array(await readFile(`dist/${name}`)); await copyFile(`dist/${name}`, `release/${name}`); }
files['git-plus/README.md'] = strToU8(await readFile('README.md', 'utf8'));
files['git-plus/CHANGELOG.md'] = strToU8(await readFile('CHANGELOG.md', 'utf8'));
files['git-plus/CONTRIBUTING.md'] = strToU8(await readFile('CONTRIBUTING.md', 'utf8'));
await writeFile(`release/git-plus-${manifest.version}.zip`, zipSync(files));
console.log(`Packaged release/git-plus-${manifest.version}.zip`);
