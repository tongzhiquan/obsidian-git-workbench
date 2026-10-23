import { readFile, writeFile, mkdir, stat, lstat, realpath, unlink, open, rename, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { GitError, GitRunner } from './runner';
import { LOG_FORMAT, commitFromFields, parseBlame, parseHistory, parseHunks, parseLog, parseStatus, conflictBlocks } from './parsers';
import { lineChange } from './line-change';
import { lineEdits, selectedText } from './line-edits';
import { EMPTY, HEAD, INDEX, WORKTREE, type BlameLine, type BlameChange, type ChangedFile, type Commit, type Conflict, type FileContent, type FileDiff, type GitRef, type LogFilter, type Operation, type Repository, type RepoStatus, type Revision, type Stash } from '../types';

const MAX_TEXT = 2 * 1024 * 1024;
const missing = (): FileContent => ({ text: '', size: 0, binary: false, large: false, exists: false });
function content(bytes: Buffer, size = bytes.length): FileContent {
  let binary = bytes.subarray(0, 8192).includes(0); const large = size > MAX_TEXT;
  if (!binary && !large) try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { binary = true; }
  return { text: binary || large ? '' : bytes.toString('utf8'), size, binary, large, exists: true };
}
export class GitService {
  runner: GitRunner;
  repo?: Repository;
  constructor(public vault: string, executable = 'git') { this.runner = new GitRunner(executable, vault); }
  async discover(): Promise<Repository | undefined> {
    const version = (await this.runner.text(['--version'])).trim();
    const m = /(\d+)\.(\d+)/.exec(version); if (!m || +m[1] < 2 || (+m[1] === 2 && +m[2] < 30)) throw new Error('Git Workbench 需要 Git 2.30 或以上版本');
    try {
      const root = (await this.runner.text(['rev-parse', '--show-toplevel'])).trim();
      const gitDir = (await this.runner.text(['rev-parse', '--absolute-git-dir'])).trim();
      const commonDir = resolve(this.vault, (await this.runner.text(['rev-parse', '--git-common-dir'])).trim());
      this.repo = { root, gitDir, commonDir, vaultPrefix: relative(root, this.vault).split(sep).join('/'), gitVersion: version };
      this.runner.cwd = root; this.runner.commonDir = commonDir; return this.repo;
    } catch (e) { if (e instanceof GitError && /not a git repository/.test(e.message)) return undefined; throw e; }
  }
  root(): string { if (!this.repo) throw new Error('当前笔记库不属于 Git 仓库，请先初始化'); return this.repo.root; }
  path(path: string): string {
    if (!path || path.includes('\0') || isAbsolute(path)) throw new Error('无效的仓库相对路径');
    const absolute = resolve(this.root(), path); const rel = relative(this.root(), absolute);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || rel.split(sep)[0].toLowerCase() === '.git') throw new Error('路径超出仓库范围');
    return absolute;
  }
  repoPath(vaultPath: string): string { return [this.repo?.vaultPrefix, vaultPath].filter(Boolean).join('/'); }
  vaultPath(repoPath: string): string | undefined {
    const prefix = this.repo?.vaultPrefix; if (!prefix) return repoPath;
    return repoPath.startsWith(prefix + '/') ? repoPath.slice(prefix.length + 1) : undefined;
  }
  async writablePath(path: string): Promise<string> {
    const absolute = this.path(path); let parent = dirname(absolute);
    while (true) { try { const actual = await realpath(parent); const rel = relative(await realpath(this.root()), actual); if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('符号链接指向仓库外部，不能写入'); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; parent = dirname(parent); } }
    const info = await lstat(absolute).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
    if (info && !info.isFile()) throw new Error('此操作只支持普通文件，不能覆盖目录或符号链接');
    return absolute;
  }
  async init(): Promise<void> {
    if (this.repo) throw new Error('已存在 Git 仓库');
    await this.runner.write(() => this.runner.text(['init', '--initial-branch=main'])); await this.discover();
  }
  private async pathsCommand(prefix: string[], paths: string[]): Promise<void> {
    let batch: string[] = [], length = 0;
    for (const path of paths) {
      if (batch.length && length + path.length > 10000) { await this.runner.text([...prefix, '--', ...batch]); batch = []; length = 0; }
      batch.push(path); length += path.length + 3;
    }
    if (batch.length) await this.runner.text([...prefix, '--', ...batch]);
  }
  async status(): Promise<RepoStatus> {
    this.root(); const result = parseStatus(await this.runner.text(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']));
    for (const [name, markers] of Object.entries({ rebase: ['rebase-merge', 'rebase-apply'], merge: ['MERGE_HEAD'], 'cherry-pick': ['CHERRY_PICK_HEAD'], revert: ['REVERT_HEAD'] })) {
      for (const marker of markers) if (await stat(join(this.repo!.gitDir, marker)).then(() => true, () => false)) result.operation = name as Operation;
    }
    return result;
  }
  async stagedDiff(maxBytes = 8 * 1024 * 1024): Promise<string> {
    this.root();
    return this.runner.text(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--binary'], { maxBytes });
  }
  async resolveRef(ref: string): Promise<string> {
    if (!ref || ref.includes('\0') || ref.includes('\n')) throw new Error('无效版本引用');
    return (await this.runner.text(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  }
  async hasHead(): Promise<boolean> { try { await this.resolveRef('HEAD'); return true; } catch (e) { if (e instanceof GitError) return false; throw e; } }
  async log(filter: LogFilter = {}, skip = 0, limit = 200): Promise<Commit[]> {
    if (!await this.hasHead()) return [];
    const args = ['log', '--topo-order', '-z', `--format=${LOG_FORMAT}`, `--max-count=${Math.min(1000, Math.max(1, limit))}`, `--skip=${Math.max(0, skip)}`];
    if (filter.author) args.push(`--author=${filter.author}`);
    if (filter.message) args.push('--fixed-strings', `--grep=${filter.message}`);
    const dateTime = (date: string, end: boolean): number => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期必须为 YYYY-MM-DD');
      const value = new Date(`${date}T00:00:00`); if (!Number.isFinite(value.getTime())) throw new Error('日期无效');
      if (end) value.setDate(value.getDate() + 1);
      return Math.floor(value.getTime() / 1000) - (end ? 1 : 0);
    };
    // Git's raw date format requires a timezone after the epoch seconds.
    if (filter.since) args.push(`--since=@${dateTime(filter.since, false)} +0000`);
    if (filter.until) args.push(`--until=@${dateTime(filter.until, true)} +0000`);
    args.push(...(filter.ref ? [await this.resolveRef(filter.ref)] : ['--all', 'HEAD']));
    if (filter.path) { this.path(filter.path); args.push('--', filter.path); }
    return parseLog(await this.runner.text(args));
  }
  async history(path: string, limit = 200): Promise<Commit[]> {
    this.path(path); if (!await this.hasHead()) return [];
    return parseHistory(await this.runner.text(['log', '--follow', '-M', '--name-status', '-z', `--format=%x00GP_COMMIT%x00${LOG_FORMAT}%x00`, `--max-count=${Math.min(limit, 5000)}`, 'HEAD', '--', path]), path);
  }
  async historyFiles(): Promise<string[]> {
    this.root();
    const current = await this.runner.text(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const committed = await this.hasHead() ? await this.runner.text(['ls-tree', '-r', '-z', '--name-only', 'HEAD']) : '';
    return [...new Set([...current.split('\0'), ...committed.split('\0')].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }
  async commitDetail(ref: string): Promise<{ commit: Commit; files: ChangedFile[] }> {
    const hash = await this.resolveRef(ref);
    const fields = (await this.runner.text(['show', '-s', `--format=${LOG_FORMAT}%x00%B`, hash])).split('\0');
    const commit = commitFromFields(fields); commit.body = fields[7]?.trim();
    const raw = (await this.runner.text(['diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', '-z', ...(commit.parents.length ? [commit.parents[0], hash] : [hash])])).split('\0');
    const files: ChangedFile[] = [];
    for (let i = 0; i < raw.length && raw[i];) { const status = raw[i++]; const first = raw[i++]; if (/^[RC]/.test(status)) files.push({ status, oldPath: first, path: raw[i++] }); else files.push({ status, path: first }); }
    return { commit, files };
  }
  async refs(): Promise<GitRef[]> {
    const raw = await this.runner.text(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(HEAD)%00%(upstream:short)', 'refs/heads', 'refs/remotes', 'refs/tags']);
    return raw.trimEnd().split('\n').filter(Boolean).map(line => { const [fullName, hash, head, upstream] = line.split('\0'); const type = fullName.startsWith('refs/heads/') ? 'branch' : fullName.startsWith('refs/remotes/') ? 'remote' : 'tag'; return { fullName, hash, current: head === '*', upstream, type, name: fullName.replace(/^refs\/(heads|remotes|tags)\//, '') }; });
  }
  async file(path: string, ref: Revision, knownIndex?: FileContent): Promise<FileContent> {
    this.path(path); if (ref.kind === 'empty') return missing();
    if (ref.kind === 'worktree') {
      try { const absolute = this.path(path); const info = await lstat(absolute); if (!info.isFile()) return { ...missing(), exists: true, binary: true }; if (info.size > MAX_TEXT) return content(Buffer.alloc(0), info.size); return content(await readFile(absolute)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return missing(); throw e; }
    }
    let object = '', indexEntry: string | undefined, mode: string | undefined;
    if (ref.kind === 'index') {
      indexEntry = await this.indexEntry(path);
      // An unchanged index entry names the same immutable blob, mode and conflict stages.
      if (knownIndex && indexEntry === knownIndex.indexEntry) return knownIndex;
      const entry = indexEntry.split('\0').find(line => /^\d+ [a-f0-9]+ 0\t/.test(line));
      if (!entry) return { ...missing(), indexEntry };
      if (!/^100(644|755) /.test(entry)) return { ...missing(), exists: true, binary: true, indexEntry };
      object = entry.split(' ')[1]; mode = entry.split(' ')[0];
    } else {
      const hash = await this.resolveRef(ref.ref);
      const raw = await this.runner.text(['ls-tree', '-z', hash, '--', path]); if (!raw) return missing();
      const entry = raw.split('\t')[0].split(' '); if (entry[1] !== 'blob') return { ...missing(), exists: true, binary: true }; object = entry[2]; mode = entry[0];
    }
    const size = Number((await this.runner.text(['cat-file', '-s', object])).trim());
    if (size > MAX_TEXT) return { ...content(Buffer.alloc(0), size), indexEntry, mode };
    return { ...content(await this.runner.run(['cat-file', 'blob', object])), indexEntry, mode };
  }
  private async indexEntry(path: string): Promise<string> {
    return (await this.runner.text(['ls-files', '--stage', '-z', '--', path])).split('\0').filter(line => line.slice(line.indexOf('\t') + 1) === path).join('\0');
  }
  async saveIndex(path: string, text: string, base: FileContent): Promise<void> {
    this.path(path);
    if (!base.exists || base.binary || base.large || !/^100(644|755) [a-f0-9]+ 0\t/.test(base.indexEntry ?? '') || base.indexEntry!.includes('\0')) throw new Error('仅支持编辑暂存区中无冲突的普通文本文件');
    if (text.includes('\0') || Buffer.byteLength(text) > MAX_TEXT) throw new Error('暂存区编辑仅支持 2 MiB 以内且不含 NUL 的文本');
    await this.runner.write(async () => {
      const index = resolve(this.root(), (await this.runner.text(['rev-parse', '--git-path', 'index'])).trim());
      const lock = index + '.lock', temporary = index + '.git-workbench-' + randomUUID();
      const handle = await open(lock, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('Git index.lock 已存在，请等待其他 Git 操作完成后重试；未保存的编辑仍保留在比较器中'); throw error; });
      let installed = false;
      try {
        if (await this.indexEntry(path) !== base.indexEntry) throw new Error('暂存区已被其他操作修改，未覆盖；可复制未保存的编辑内容后重新加载文件');
        await copyFile(index, temporary);
        // The editor works on the blob itself: do not run worktree clean filters a second time.
        const object = (await this.runner.text(['hash-object', '-w', '--stdin', '--no-filters'], { input: text })).trim();
        await this.runner.text(['update-index', '--cacheinfo', base.indexEntry!.split(' ')[0], object, path], { indexFile: temporary });
        await handle.writeFile(await readFile(temporary)); await handle.sync(); await handle.close();
        await rename(lock, index); installed = true;
      } finally {
        await handle.close().catch(() => {});
        if (!installed) await unlink(lock).catch(() => {});
        await unlink(temporary).catch(() => {}); await unlink(temporary + '.lock').catch(() => {});
      }
    });
  }
  async diff(path: string, left: Revision = INDEX, right: Revision = WORKTREE, oldPath = path, knownIndex?: FileContent): Promise<FileDiff> {
    this.path(path); this.path(oldPath);
    const [before, after, rawStatus] = await Promise.all([this.file(oldPath, left, knownIndex), this.file(path, right, knownIndex), this.runner.text(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', path])]);
    let patch = ''; let stageable: FileDiff['stageable'] = null;
    const status = parseStatus(rawStatus).files.find(file => file.path === path);
    if (!before.binary && !after.binary && !before.large && !after.large) {
      if (left.kind === 'index' && right.kind === 'worktree' && oldPath === path && before.exists) { patch = await this.runner.text(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', path]); stageable = 'stage'; }
      else if (left.kind === 'commit' && left.ref === 'HEAD' && right.kind === 'index' && oldPath === path) { patch = await this.runner.text(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--', path]); stageable = 'unstage'; }
      else { patch = createTwoFilesPatch(oldPath, path, before.text, after.text, '', '', { context: 3 });
        if (oldPath === path && left.kind === 'index' && right.kind === 'worktree') stageable = 'stage';
        if (oldPath === path && left.kind === 'empty' && right.kind === 'index' && !await this.hasHead()) stageable = 'unstage';
      }
    }
    let lineActions = !!stageable && !status?.conflict && !status?.submodule && !status?.oldPath;
    if ([before, after].some(file => file.mode && !/^100(644|755)$/.test(file.mode))) lineActions = false;
    const index = left.kind === 'index' ? before : after;
    if (index.indexEntry && (!/^100(644|755) [a-f0-9]+ 0\t/.test(index.indexEntry) || index.indexEntry.includes('\0'))) lineActions = false;
    if ([before, after].some(file => /\r\n/.test(file.text) && /(?<!\r)\n/.test(file.text) || /\r(?!\n)/.test(file.text))) lineActions = false;
    if (lineActions) {
      const [attrs, raw] = await Promise.all([
        this.runner.text(['check-attr', '-z', 'filter', 'working-tree-encoding', 'ident', '--', path]),
        this.runner.text(['diff', ...(stageable === 'unstage' ? ['--cached'] : []), '--raw', '--no-abbrev', '--', path]),
      ]);
      const values = attrs.split('\0');
      for (let i = 2; i < values.length; i += 3) if (!['unspecified', 'unset'].includes(values[i])) lineActions = false;
      const mode = /^:(\d+) (\d+)/.exec(raw);
      if (mode && mode[1] !== mode[2] && mode[1] !== '000000' && mode[2] !== '000000') lineActions = false;
    }
    return { path, oldPath, left, right, before, after, patch, hunks: parseHunks(patch), stageable, lineActions };
  }
  async saveWorktree(path: string, text: string, base: FileContent, writer?: () => Promise<void>, indexBase?: FileContent): Promise<void> {
    this.path(path);
    if (base.binary || base.large || text.includes('\0') || Buffer.byteLength(text) > MAX_TEXT) throw new Error('工作区编辑仅支持 2 MiB 以内的普通 UTF-8 文本');
    const work = async () => {
      if (indexBase && await this.indexEntry(path) !== indexBase.indexEntry) throw new Error('暂存区已变化，请刷新差异后重试');
      const absolute = await this.writablePath(path), current = await this.file(path, WORKTREE);
      if (current.exists !== base.exists || current.binary || current.large || current.text !== base.text) throw new Error('工作区文件已被其他操作修改，未覆盖；未保存的编辑仍保留在比较器中');
      if (writer) await writer();
      else { await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, text, { flag: base.exists ? 'w' : 'wx' }); }
    };
    await this.runner.write(() => indexBase ? this.withIndexLock(work) : work());
  }
  private async withIndexLock<T>(work: (index: string, handle: Awaited<ReturnType<typeof open>>, owner: { installed: boolean }) => Promise<T>): Promise<T> {
    const index = resolve(this.root(), (await this.runner.text(['rev-parse', '--git-path', 'index'])).trim()), lock = index + '.lock';
    const handle = await open(lock, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('Git index.lock 已存在，请等待其他 Git 操作完成后重试'); throw error; });
    const owner = { installed: false };
    try { return await work(index, handle, owner); }
    finally { await handle.close().catch(() => {}); if (!owner.installed) await unlink(lock).catch(() => {}); }
  }
  async applyLines(diff: FileDiff, ids: readonly number[]): Promise<FileDiff> {
    const model = lineEdits(diff.before.text, diff.after.text);
    if (!diff.lineActions || !diff.stageable || !model) throw new Error('此文件不能按行暂存');
    const text = selectedText(model, ids, diff.stageable === 'unstage');
    if (Buffer.byteLength(text) > MAX_TEXT) throw new Error('暂存内容超过 2 MiB，请使用整文件暂存');
    return this.runner.write(async () => this.withIndexLock(async (index, handle, owner) => {
      const current = await this.diff(diff.path, diff.left, diff.right, diff.oldPath, diff.stageable === 'stage' ? diff.before : diff.after);
      if (!current.lineActions || current.before.text !== diff.before.text || current.before.exists !== diff.before.exists || current.before.mode !== diff.before.mode || current.before.indexEntry !== diff.before.indexEntry || current.after.text !== diff.after.text || current.after.exists !== diff.after.exists || current.after.mode !== diff.after.mode || current.after.indexEntry !== diff.after.indexEntry) throw new Error('文件或暂存区已变化，请刷新差异后重试');
      const base = diff.stageable === 'stage' ? diff.before : diff.after;
      const destination = diff.stageable === 'stage' ? diff.after : diff.before;
      const remove = !destination.exists && ids.length === model.edits.length;
      const temporary = index + '.git-workbench-' + randomUUID();
      try {
        let saved: FileContent = { ...missing(), indexEntry: '' };
        await copyFile(index, temporary).catch(async error => { if (error.code !== 'ENOENT') throw error; await this.runner.text(['read-tree', '--empty'], { indexFile: temporary }); });
        if (remove) await this.runner.text(['update-index', '--force-remove', '--', diff.path], { indexFile: temporary });
        else {
          const object = (await this.runner.text(['hash-object', '-w', ...(diff.stageable === 'stage' ? ['--path=' + diff.path] : ['--no-filters']), '--stdin'], { input: text })).trim();
          const mode = base.mode ?? destination.mode ?? '100644';
          const [, blob] = await Promise.all([
            this.runner.text(['update-index', '--add', '--cacheinfo', mode, object, diff.path], { indexFile: temporary }),
            this.runner.run(['cat-file', 'blob', object]),
          ]);
          saved = { ...content(blob), mode, indexEntry: `${mode} ${object} 0\t${diff.path}` };
        }
        await handle.writeFile(await readFile(temporary)); await handle.sync(); await handle.close();
        await rename(index + '.lock', index); owner.installed = true;
        const before = diff.stageable === 'stage' ? saved : current.before, after = diff.stageable === 'unstage' ? saved : current.after;
        const patch = createTwoFilesPatch(current.oldPath, current.path, before.text, after.text, '', '', { context: 3 });
        return { ...current, before, after, patch, hunks: parseHunks(patch) };
      } finally { await unlink(temporary).catch(() => {}); await unlink(temporary + '.lock').catch(() => {}); }
    }));
  }
  async stage(paths: string[]): Promise<void> { paths.forEach(p => this.path(p)); if (!paths.length) return; await this.runner.write(async () => { await this.pathsCommand(['add', '-A'], paths); }); }
  async unstage(paths: string[]): Promise<void> {
    paths.forEach(p => this.path(p)); if (!paths.length) return;
    await this.runner.write(async () => { await this.pathsCommand(await this.hasHead() ? ['restore', '--staged'] : ['rm', '--cached', '-r', '--ignore-unmatch'], paths); });
  }
  async applyHunk(diff: FileDiff, index: number): Promise<void> {
    if (!diff.stageable || !diff.hunks[index]) throw new Error('此差异不能按变更块暂存');
    await this.runner.write(async () => {
      const current = await this.diff(diff.path, diff.left, diff.right, diff.oldPath);
      if (current.patch !== diff.patch) throw new Error('文件已变化，请刷新差异后重试');
      const args = ['apply', '--cached', '--whitespace=nowarn', ...(diff.stageable === 'unstage' ? ['--reverse'] : [])];
      await this.runner.text([...args, '--check', '-'], { input: diff.hunks[index].patch });
      await this.runner.text([...args, '-'], { input: diff.hunks[index].patch });
    });
  }
  async commit(message: string, amend = false): Promise<void> {
    if (!message.trim()) throw new Error('请填写提交消息');
    await this.runner.write(async () => {
      const status = await this.status(); if (status.files.some(f => f.conflict)) throw new Error('请先解决所有冲突');
      if (!amend && !status.operation && !status.files.some(f => !f.untracked && f.index !== '.')) throw new Error('暂存区为空，请先暂存要提交的文件');
      await this.runner.text(['commit', ...(amend ? ['--amend'] : []), '--file=-'], { input: message });
    });
  }
  private async saveSafetyCopy(path: string, reason: string): Promise<void> {
    const absolute = await this.writablePath(path); const id = randomUUID();
    const bytes = await readFile(absolute).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
    const backup = { id, path, reason, created: new Date().toISOString(), exists: bytes !== undefined };
    const root = join(this.repo!.gitDir, 'git-workbench-backups'); await mkdir(root, { recursive: true });
    if (bytes) await writeFile(join(root, id + '.bin'), bytes, { flag: 'wx' });
    await writeFile(join(root, id + '.json'), JSON.stringify(backup), { flag: 'wx' });
  }
  async restoreFile(path: string, ref: Revision, sourcePath = path): Promise<void> {
    await this.runner.write(async () => {
      const target = await this.file(sourcePath, ref); if (target.binary || target.large) throw new Error('此恢复操作仅支持 2 MiB 以内的文本文件');
      const absolute = await this.writablePath(path); await this.saveSafetyCopy(path, '恢复历史版本');
      if (target.exists) { await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, target.text); }
      else await unlink(absolute).catch(e => { if (e.code !== 'ENOENT') throw e; });
    });
  }
  async discard(paths: string[]): Promise<void> {
    await this.runner.write(async () => {
      const status = await this.status();
      for (const path of paths) {
        const file = status.files.find(f => f.path === path); if (!file) continue; if (file.conflict || file.submodule) throw new Error('冲突或子模块请在专用操作中处理');
        await this.saveSafetyCopy(path, '丢弃工作区修改');
        if (file.untracked) await unlink(this.path(path)); else await this.runner.text(['restore', '--worktree', '--', path]);
      }
    });
  }
  async blame(path: string, text?: string): Promise<BlameLine[]> {
    this.path(path);
    const contents = async (): Promise<string | undefined> => {
      if (text !== undefined) return text;
      const file = await this.file(path, WORKTREE);
      return file.exists && !file.binary && !file.large ? file.text : undefined;
    };
    const uncommitted = async (): Promise<BlameLine[]> => {
      const current = await contents();
      if (current === undefined || current.includes('\0') || Buffer.byteLength(current) > MAX_TEXT) return [];
      return current.split('\n').map((line, i) => ({ hash: '0'.repeat(40), author: '', date: 0, subject: '', originalLine: i + 1, line: i + 1, path, text: line.replace(/\r$/, ''), uncommitted: true }));
    };
    const read = async (source: string, input?: string) => parseBlame(await this.runner.text(['blame', '--line-porcelain', ...(input !== undefined ? ['--contents', '-'] : []), '--', source], { input, maxBytes: 32 * 1024 * 1024 }));
    if (!await this.hasHead()) return uncommitted();
    try { return await read(path, text); }
    catch (e) {
      if (!(e instanceof GitError)) throw e;
      if (/no such path/.test(e.stderr)) {
        // A new note has no committed author yet. A staged rename can still use
        // its old HEAD path while blaming the current (possibly unsaved) text.
        const renamed = (await this.status()).files.find(file => file.path === path && file.oldPath && (file.index === 'R' || file.worktree === 'R'));
        const current = renamed ? await contents() : undefined;
        if (renamed && current !== undefined) return read(renamed.oldPath!, current);
        return uncommitted();
      }
      if (/no such file|no such.*HEAD|no final newline|cannot stat/.test(e.stderr)) return [];
      throw e;
    }
  }
  async lineChange(path: string, blame: BlameLine, contents?: string): Promise<BlameChange> {
    this.path(path);
    let before: FileContent, after: FileContent, number: number, label: string;
    if (blame.uncommitted) {
      const hasHead = await this.hasHead();
      before = await this.file(blame.path || path, hasHead ? HEAD : EMPTY);
      if (hasHead && !before.exists) {
        const renamed = (await this.status()).files.find(file => file.path === path && file.oldPath && (file.index === 'R' || file.worktree === 'R'));
        if (renamed) before = await this.file(renamed.oldPath!, HEAD);
      }
      after = contents === undefined ? await this.file(path, WORKTREE) : content(Buffer.from(contents));
      number = blame.line; label = `${hasHead ? 'HEAD' : '空版本'} → 当前笔记`;
    } else {
      const historicalPath = blame.path || path; this.path(historicalPath);
      const { commit, files } = await this.commitDetail(blame.hash);
      const changed = files.find(file => file.path === historicalPath);
      [before, after] = await Promise.all([
        this.file(changed?.oldPath ?? historicalPath, commit.parents.length ? { kind: 'commit', ref: commit.parents[0] } : EMPTY),
        this.file(historicalPath, { kind: 'commit', ref: commit.hash }),
      ]);
      number = blame.originalLine;
      label = `${commit.parents.length ? commit.parents[0].slice(0, 7) : '首次新增'} → ${commit.hash.slice(0, 7)}${commit.parents.length > 1 ? '（第一个父提交）' : ''}`;
    }
    if (before.binary || after.binary || before.large || after.large) return { label, lines: [], truncated: false, notice: '二进制或超过 2 MiB 的文件不展开行差异' };
    return lineChange(before.text, after.text, number, label);
  }
  async branch(action: 'create' | 'switch' | 'delete', name: string, start = 'HEAD'): Promise<void> {
    if (!name || name.startsWith('-')) throw new Error('无效分支名'); await this.runner.text(['check-ref-format', '--branch', name]);
    await this.runner.write(async () => {
      if (action === 'create') await this.runner.text(['switch', '-c', name, await this.resolveRef(start)]);
      else if (action === 'delete') await this.runner.text(['branch', '-d', '--', name]);
      else { const status = await this.status(); if (status.files.length) throw new Error('请先提交或 stash 当前变化，再切换分支'); await this.runner.text(['switch', '--', name]); }
    });
  }
  async tag(action: 'create' | 'delete', name: string, ref = 'HEAD'): Promise<void> {
    if (!name || name.startsWith('-')) throw new Error('无效标签名'); await this.runner.text(['check-ref-format', `refs/tags/${name}`]);
    await this.runner.write(async () => { await this.runner.text(action === 'create' ? ['tag', name, await this.resolveRef(ref)] : ['tag', '-d', '--', name]); });
  }
  async integrate(operation: Operation, ref: string): Promise<void> {
    await this.runner.write(async () => {
      const status = await this.status(); if (status.operation || status.files.length) throw new Error('请先完成当前操作，并提交或 stash 所有变化');
      const hash = await this.resolveRef(ref);
      await this.runner.text([operation, ...(operation === 'merge' ? ['--no-edit'] : operation === 'revert' ? ['--no-edit'] : []), hash]);
    });
  }
  async continueOperation(operation: Operation, abort = false): Promise<void> {
    await this.runner.write(async () => {
      const status = await this.status(); if (status.operation !== operation) throw new Error('仓库操作状态已改变，请刷新');
      if (!abort && status.files.some(f => f.conflict)) throw new Error('请先解决并暂存所有冲突文件');
      await this.runner.text([operation, abort ? '--abort' : '--continue']);
    });
  }
  async stashes(): Promise<Stash[]> {
    const raw = await this.runner.text(['stash', 'list', '--format=%gd%x00%H%x00%gs']);
    return raw.trimEnd().split('\n').filter(Boolean).map(line => { const [ref, hash, subject] = line.split('\0'); return { ref, hash, subject }; });
  }
  async stash(action: 'save' | 'apply' | 'pop' | 'drop', refOrMessage: string): Promise<void> {
    await this.runner.write(async () => {
      if (action === 'save') await this.runner.text(['stash', 'push', '--include-untracked', '-m', refOrMessage || 'Git Workbench stash']);
      else { if (!/^stash@\{\d+\}$/.test(refOrMessage)) throw new Error('无效 stash 引用'); await this.runner.text(['stash', action, refOrMessage]); }
    });
  }
  async remotes(): Promise<{ name: string; url: string }[]> {
    const names = (await this.runner.text(['remote'])).trim().split('\n').filter(Boolean);
    return Promise.all(names.map(async name => ({ name, url: (await this.runner.text(['remote', 'get-url', name])).trim() })));
  }
  async remote(action: 'add' | 'set-url' | 'remove', name: string, url?: string): Promise<void> {
    if (!/^[\w.-]+$/.test(name) || name.startsWith('-')) throw new Error('无效远程名');
    if (action !== 'remove' && (!url || url.startsWith('-') || /[\r\n\0]/.test(url))) throw new Error('无效远程地址');
    await this.runner.write(async () => { await this.runner.text(['remote', action, name, ...(action === 'remove' ? [] : [url!])]); });
  }
  async network(action: 'fetch' | 'pull' | 'push', remote?: string, branch?: string): Promise<void> {
    if (remote && (!/^[\w.-]+$/.test(remote) || remote.startsWith('-'))) throw new Error('无效远程名');
    if (branch) { if (branch.startsWith('-')) throw new Error('无效分支名'); await this.runner.text(['check-ref-format', '--branch', branch]); }
    await this.runner.write(async () => {
      if (action === 'fetch') await this.runner.text(['fetch', '--prune', ...(remote ? [remote] : ['--all'])], { timeout: 180000 });
      else if (action === 'pull') await this.runner.text(['pull', '--ff-only', ...(remote ? [remote] : []), ...(branch ? [branch] : [])], { timeout: 180000 });
      else await this.runner.text(['push', ...(remote && branch ? ['--set-upstream', remote, branch] : remote ? [remote] : [])], { timeout: 180000 });
    });
  }
  async conflict(path: string): Promise<Conflict> {
    this.path(path);
    const raw = (await this.runner.text(['ls-files', '-u', '-z', '--', path])).split('\0').filter(Boolean);
    if (!raw.length) throw new Error('此文件已不处于冲突状态');
    const stages = new Map<number, FileContent>();
    for (const entry of raw) {
      const [mode, object, stage] = entry.split('\t')[0].split(' '); const size = +(await this.runner.text(['cat-file', '-s', object])).trim();
      stages.set(+stage, mode === '120000' || mode === '160000' ? { ...missing(), binary: true, exists: true } : size > MAX_TEXT ? content(Buffer.alloc(0), size) : content(await this.runner.run(['cat-file', 'blob', object])));
    }
    const base = stages.get(1) ?? missing(), ours = stages.get(2) ?? missing(), theirs = stages.get(3) ?? missing();
    const work = await this.file(path, WORKTREE); const result = work.text;
    return { path, base, ours, theirs, result, blocks: conflictBlocks(result), fileLevel: [base, ours, theirs].some(f => f.binary || f.large) || !ours.exists || !theirs.exists };
  }
  async resolveConflict(path: string, choice: 'ours' | 'theirs' | 'result' | 'delete', text?: string, expected?: string): Promise<void> {
    await this.runner.write(async () => {
      const current = await this.conflict(path);
      if (expected !== undefined && current.result !== expected) throw new Error('冲突文件已被外部修改，请重新打开后处理');
      if (choice === 'result' && (text === undefined || conflictBlocks(text).length)) throw new Error('请先处理全部冲突标记');
      await this.saveSafetyCopy(path, '解决冲突前'); const absolute = await this.writablePath(path);
      if (choice === 'delete' || (choice !== 'result' && !current[choice].exists)) {
        await unlink(absolute).catch(e => { if (e.code !== 'ENOENT') throw e; }); await this.runner.text(['add', '-A', '--', path]);
      } else if (choice === 'result') { await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, text!); await this.runner.text(['add', '--', path]); }
      else { await this.runner.text(['checkout', choice === 'ours' ? '--ours' : '--theirs', '--', path]); await this.runner.text(['add', '--', path]); }
    });
  }
  async diagnostics(): Promise<string> {
    const displayPath = (path: string) => path.replace(/\\/g, '/');
    const results = [this.repo?.gitVersion ?? (await this.runner.text(['--version'])).trim(), `仓库：${this.repo ? displayPath(this.repo.root) : '未初始化'}`, `笔记库：${displayPath(this.vault)}`];
    for (const key of ['user.name', 'user.email', 'credential.helper']) { const value = await this.runner.text(['config', '--get', key], { allowed: [1] }); results.push(`${key}：${value.trim() || '未配置'}`); }
    if (this.repo) results.push(`远程：${(await this.remotes()).map(r => r.name).join(', ') || '无'}`);
    return results.join('\n');
  }
  async testConnection(remote: string): Promise<string> { if (!/^[\w.-]+$/.test(remote) || remote.startsWith('-')) throw new Error('无效远程'); await this.runner.text(['ls-remote', '--exit-code', remote, 'HEAD'], { allowed: [2], timeout: 30000 }); return '连接成功'; }
  fingerprint(text: string): string { return createHash('sha256').update(text).digest('hex'); }
  dispose(): void { this.runner.dispose(); }
}
