import { spawn } from 'node:child_process';
import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export class GitError extends Error {
  constructor(public args: string[], public code: number, public stderr: string, public stdout = '') {
    const raw = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || `Git 命令失败（${code}）：${args[0]}`;
    const hint = /CONFLICT|unmerged|fix conflicts/i.test(raw) ? '在源代码管理侧栏解决冲突，再继续或中止操作。'
      : /Authentication failed|could not read Username|Permission denied|could not read from remote repository/i.test(raw) ? '请检查系统 Git 的 SSH agent 或 credential helper，再用“检测连接”重试。'
      : /index\.lock|another git process/i.test(raw) ? '请等待其他 Git 操作完成后重试。'
      : /Not possible to fast-forward|non-fast-forward|fetch first/i.test(raw) ? '远程和本地已分叉，请 Fetch 后选择 merge 或 rebase，再推送。'
      : /unable to auto-detect email|Please tell me who you are/i.test(raw) ? '请配置 git config user.name 和 git config user.email。' : '';
    super(raw + (hint ? '\n\n' + hint : '')); this.name = 'GitError';
  }
}
export interface RunOptions { input?: string | Buffer; allowed?: number[]; timeout?: number; maxBytes?: number; signal?: AbortSignal }
export class GitRunner {
  private children = new Set<ReturnType<typeof spawn>>();
  private tail: Promise<unknown> = Promise.resolve();
  disposed = false;
  constructor(public executable: string, public cwd: string, public commonDir?: string) {}
  async run(args: string[], options: RunOptions = {}): Promise<Buffer> {
    if (this.disposed) throw new Error('Git Plus 已卸载');
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], {
        cwd: this.cwd, windowsHide: true, shell: false,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.children.add(child); const out: Buffer[] = []; const err: Buffer[] = []; let size = 0; let failure: Error | undefined;
      const stop = (error: Error) => { failure = error; child.kill(); };
      const timer = setTimeout(() => stop(new Error('Git 操作超时，请检查认证、网络或仓库状态')), options.timeout ?? 120000);
      const abort = () => stop(new Error('Git 操作已取消；请刷新仓库状态'));
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      const collect = (chunks: Buffer[]) => (chunk: Buffer) => { size += chunk.length; if (size > (options.maxBytes ?? 32 * 1024 * 1024)) stop(new Error('Git 输出超过限制，请缩小查询范围')); else chunks.push(chunk); };
      child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
      child.stdin.on('error', () => {});
      child.on('error', error => { failure = new Error(`无法执行 Git：${error.message}。请检查设置中的 Git 路径。`); });
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
      const lock = join(this.commonDir, 'git-plus.lock'); const token = `${process.pid}:${Date.now()}:${Math.random()}`;
      try {
        const handle = await open(lock, 'wx'); await handle.writeFile(token); await handle.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const previous = await readFile(lock, 'utf8'); const pid = Number(previous.split(':')[0]);
          let alive = true; try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (alive) throw new Error('另一个 Git Plus 窗口正在操作此仓库，请稍后重试');
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
