import { appendFile, readFile, writeFile } from 'node:fs/promises';

const [tag, notesPath] = process.argv.slice(2);
if (!tag || !notesPath) throw new Error('Usage: node scripts/prepare-release.mjs <tag> <notes-output-path>');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const [manifest, pkg, lock, versions, changelog] = await Promise.all([
  readJson('manifest.json'), readJson('package.json'), readJson('package-lock.json'),
  readJson('versions.json'), readFile('CHANGELOG.md', 'utf8'),
]);
const version = manifest.version;
if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('manifest.json version must be a stable X.Y.Z version');
}
if (tag !== version) throw new Error(`Tag ${tag} does not match manifest version ${version}; use the exact version without a v prefix`);
if (pkg.version !== version || lock.version !== version || lock.packages?.['']?.version !== version) {
  throw new Error('manifest.json, package.json and both package-lock.json versions must match');
}
if (!manifest.minAppVersion || versions[version] !== manifest.minAppVersion) {
  throw new Error(`versions.json must map ${version} to manifest.minAppVersion`);
}
if (manifest.id !== 'git-workbench' || pkg.name !== 'obsidian-git-workbench' || lock.name !== pkg.name || lock.packages?.['']?.name !== pkg.name) {
  throw new Error('Plugin and package names must match Git Workbench release metadata');
}
const normalized = changelog.replace(/\r\n/g, '\n');
const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
const match = heading.exec(normalized);
if (!match) throw new Error(`CHANGELOG.md must contain a dated release section: ## [${version}] - YYYY-MM-DD`);
const notes = normalized.slice(match.index + match[0].length).split(/^## /m)[0]
  .replace(/^\[[^\]]+\]:\s*\S+.*$/gm, '').trim();
if (!notes) throw new Error(`CHANGELOG.md release section for ${version} is empty`);
await writeFile(notesPath, notes + '\n');
const archive = `git-workbench-${version}.zip`;
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\narchive=${archive}\n`);
console.log(`Validated ${tag}; release assets include ${archive}`);
