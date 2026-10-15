import type { BlameLine, Commit, ConflictBlock, DiffHunk, FileStatus, RepoStatus } from '../types';

export function parseStatus(raw: string): RepoStatus {
  const result: RepoStatus = { branch: '', head: '', upstream: '', ahead: 0, behind: 0, files: [] };
  const entries = raw.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.startsWith('# branch.oid ')) result.head = entry.slice(13);
    else if (entry.startsWith('# branch.head ')) result.branch = entry.slice(14);
    else if (entry.startsWith('# branch.upstream ')) result.upstream = entry.slice(18);
    else if (entry.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(entry); if (m) { result.ahead = +m[1]; result.behind = +m[2]; } }
    else if (entry.startsWith('? ')) result.files.push({ path: entry.slice(2), index: '?', worktree: '?', conflict: false, untracked: true, submodule: false });
    else if (/^[12u] /.test(entry)) {
      const count = entry[0] === '1' ? 8 : entry[0] === '2' ? 9 : 10;
      const fields: string[] = []; let start = 0;
      for (let n = 0; n < count; n++) { const end = entry.indexOf(' ', start); fields.push(entry.slice(start, end)); start = end + 1; }
      const file: FileStatus = { path: entry.slice(start), index: fields[1][0], worktree: fields[1][1], conflict: entry[0] === 'u', untracked: false, submodule: fields[2].startsWith('S') };
      if (entry[0] === '2') file.oldPath = entries[++i];
      result.files.push(file);
    }
  }
  return result;
}
export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D';
export function commitFromFields(fields: string[]): Commit {
  return { hash: fields[0], parents: fields[1].split(' ').filter(Boolean), author: fields[2], email: fields[3], date: fields[4], subject: fields[5], refs: fields[6].split(', ').filter(Boolean) };
}
export function parseLog(raw: string): Commit[] {
  const fields = raw.split('\0'); const commits: Commit[] = [];
  for (let i = 0; i + 6 < fields.length; i += 7) commits.push(commitFromFields(fields.slice(i, i + 7)));
  return commits;
}
export function parseHistory(raw: string, path: string): Commit[] {
  const tokens = raw.split('\0'); const commits: Commit[] = []; let current = path;
  for (let i = 0; i < tokens.length;) {
    if (tokens[i] !== 'GP_COMMIT') { i++; continue; }
    const commit = commitFromFields(tokens.slice(i + 1, i + 8)); commit.path = current; commits.push(commit); i += 8;
    while (i < tokens.length && tokens[i] !== 'GP_COMMIT') {
      const status = tokens[i++].trim(); if (!status) continue;
      if (/^[RC]\d+$/.test(status)) { const old = tokens[i++]; const next = tokens[i++]; if (next === current && status[0] === 'R') current = old; }
      else if (/^[AMDUTX]$/.test(status)) i++;
    }
  }
  return commits;
}
export function parseHunks(patch: string): DiffHunk[] {
  const lines = patch.split('\n'); const header: string[] = []; const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  for (const line of lines) {
    if (line.startsWith('@@ ')) { current = { header: line, lines: [], patch: '', index: hunks.length }; hunks.push(current); }
    else if (current) current.lines.push(line);
    else header.push(line);
  }
  for (const hunk of hunks) {
    while (hunk.lines.at(-1) === '') hunk.lines.pop();
    hunk.patch = [...header, hunk.header, ...hunk.lines].join('\n') + '\n';
  }
  return hunks;
}
export function decodeGitPath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  const parts: Buffer[] = [];
  const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', '\\': '\\', '"': '"' };
  const body = path.slice(1, -1); let cursor = 0;
  for (const match of body.matchAll(/\\([0-7]{1,3}|.)/g)) {
    parts.push(Buffer.from(body.slice(cursor, match.index)));
    const value = match[1]; parts.push(/^[0-7]+$/.test(value) ? Buffer.from([parseInt(value, 8)]) : Buffer.from(escapes[value] ?? value));
    cursor = match.index! + match[0].length;
  }
  parts.push(Buffer.from(body.slice(cursor))); return Buffer.concat(parts).toString('utf8');
}
export function parseBlame(raw: string): BlameLine[] {
  const result: BlameLine[] = []; let item: Partial<BlameLine> = {};
  for (const line of raw.split('\n')) {
    const h = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (h) item = { hash: h[1], originalLine: +h[2], line: +h[3], uncommitted: /^0+$/.test(h[1]) };
    else if (line.startsWith('author ')) item.author = line.slice(7);
    else if (line.startsWith('author-time ')) item.date = +line.slice(12) * 1000;
    else if (line.startsWith('summary ')) item.subject = line.slice(8);
    else if (line.startsWith('filename ')) item.path = decodeGitPath(line.slice(9));
    else if (line.startsWith('\t')) { item.text = line.slice(1); result.push(item as BlameLine); }
  }
  return result;
}
export function conflictBlocks(text: string): ConflictBlock[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []; const result: ConflictBlock[] = []; let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^<{7}(?: |\r?$)/.test(lines[i])) { offset += lines[i].length; continue; }
    const start = offset; let ours = '', base = '', theirs = ''; let part: 'ours' | 'base' | 'theirs' = 'ours'; let ended = false;
    offset += lines[i].length;
    for (i++; i < lines.length; i++) {
      const line = lines[i]; offset += line.length;
      if (/^\|{7}(?: |\r?$)/.test(line)) part = 'base';
      else if (/^={7}\r?\n?$/.test(line)) part = 'theirs';
      else if (/^>{7}(?: |\r?$)/.test(line)) { ended = true; break; }
      else if (part === 'ours') ours += line; else if (part === 'base') base += line; else theirs += line;
    }
    if (ended) result.push({ start, end: offset, ours, base, theirs });
  }
  return result;
}
