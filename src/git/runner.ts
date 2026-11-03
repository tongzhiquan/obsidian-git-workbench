import { t } from '../i18n';
import { spawn } from 'node:child_process';
import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export class GitError extends Error {
  constructor(public args: string[], public code: number, public stderr: string, public stdout = '') {
    const raw = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || t('error.gitCommand', { p0: code, p1: args[0] });
    const hint = /CONFLICT|unmerged|fix conflicts/i.test(raw) ? t('error.conflictHint')
      : /Authentication failed|could not read Username|Permission denied|could not read from remote repository/i.test(raw) ? t('error.authHint')
      : /index\.lock|another git process/i.test(raw) ? t('error.lockHint')
      : /Not possible to fast-forward|non-fast-forward|fetch first/i.test(raw) ? t('error.divergedHint')
      : /unable to auto-detect email|Please tell me who you are/i.test(raw) ? t('error.identityHint') : '';
    super(raw + (hint ? '\n\n' + hint : '')); this.name = 'GitError';
  }
}
export interface RunOptions { input?: string | Buffer; allowed?: number[]; timeout?: number; maxBytes?: number; signal?: AbortSignal; indexFile?: string }
export class GitRunner {
  private children = new Set<ReturnType<typeof spawn>>();
  private tail: Promise<unknown> = Promise.resolve();
  disposed = false;
  constructor(public executable: string, public cwd: string, public commonDir?: string) {}
  async run(args: string[], options: RunOptions = {}): Promise<Buffer> {
    if (this.disposed) throw new Error(t('error.unloaded'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], {
        cwd: this.cwd, windowsHide: true, shell: false,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1', ...(options.indexFile ? { GIT_INDEX_FILE: options.indexFile } : {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.children.add(child); const out: Buffer[] = []; const err: Buffer[] = []; let size = 0; let failure: Error | undefined;
      const stop = (error: Error) => { failure = error; child.kill(); };
      const timer = setTimeout(() => stop(new Error(t('error.timeout'))), options.timeout ?? 120000);
      const abort = () => stop(new Error(t('error.cancelled')));
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      const collect = (chunks: Buffer[]) => (chunk: Buffer) => { size += chunk.length; if (size > (options.maxBytes ?? 32 * 1024 * 1024)) stop(new Error(t('error.outputLimit'))); else chunks.push(chunk); };
      child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
      child.stdin.on('error', () => {});
      child.on('error', error => { failure = new Error(t('error.executeGit', { p0: error.message })); });
      child.on('close', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort); this.children.delete(child);
        if (failure) reject(failure); else if (code !== 0 && !(options.allowed ?? []).includes(code ?? -1)) reject(new GitError(args, code ?? -1, Buffer.concat(err).toString('utf8'), Buffer.concat(out).toString('utf8'))); else resolve(Buffer.concat(out));
      });
      child.stdin.end(options.input);
    });
  }
  async text(args: string[], options?: RunOptions): Promise<string> { return (await this.run(args, options)).toString('utf8'); }
  write<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.catch(() => {}).then(async () => {
      if (!this.commonDir) return action();
      const lock = join(this.commonDir, 'git-workbench.lock'); const token = `${process.pid}:${Date.now()}:${Math.random()}`;
      try {
        const handle = await open(lock, 'wx'); await handle.writeFile(token); await handle.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const previous = await readFile(lock, 'utf8'); const pid = Number(previous.split(':')[0]);
          let alive = true; try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (alive) throw new Error(t('error.otherWindow'));
          await unlink(lock); const handle = await open(lock, 'wx'); await handle.writeFile(token); await handle.close();
        } else throw error;
      }
      try { return await action(); }
      finally { if (await readFile(lock, 'utf8').catch(() => '') === token) await unlink(lock).catch(() => {}); }
    });
    this.tail = task; return task;
  }
  dispose(): void { this.disposed = true; for (const child of this.children) child.kill(); this.children.clear(); }
}
