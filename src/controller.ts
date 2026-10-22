import { GitService } from './git/service';
import { formatCommitMessage } from './commit-message';
import type { BlameLine, BlameChange, Commit, FileDiff, LogFilter, RepoStatus, Revision, Settings } from './types';
export class LruCache<T> {
  private values = new Map<string, T>();
  constructor(private limit = 80) {}
  get(key: string): T | undefined { const value = this.values.get(key); if (value !== undefined) { this.values.delete(key); this.values.set(key, value); } return value; }
  set(key: string, value: T): T { this.values.delete(key); this.values.set(key, value); while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!); return value; }
  clear(): void { this.values.clear(); }
}
export class RepositoryController {
  status?: RepoStatus;
  busy = false;
  message = '';
  error = '';
  generation = 0;
  automationPaused = false;
  private listeners = new Set<() => void>();
  private refreshing?: Promise<void>;
  private again = false;
  private timer?: ReturnType<typeof setTimeout>;
  private historyCache = new LruCache<Commit[]>();
  private blameCache = new LruCache<BlameLine[]>(12);
  private diffCache = new LruCache<FileDiff>(8);
  private lineChangeCache = new LruCache<BlameChange>(64);
  private alive = true;
  constructor(public git: GitService, public settings: Settings, private notice: (message: string) => void) {}
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(): void { if (this.alive) for (const fn of this.listeners) fn(); }
  invalidate(): void { this.generation++; this.historyCache.clear(); this.blameCache.clear(); this.diffCache.clear(); this.lineChangeCache.clear(); }
  async refresh(invalidate = true): Promise<void> {
    if (!this.alive) return;
    if (invalidate) this.invalidate();
    if (this.refreshing) { this.again = true; return this.refreshing; }
    this.refreshing = (async () => {
      do {
        this.again = false;
        try { if (!this.git.repo) await this.git.discover(); this.status = this.git.repo ? await this.git.status() : undefined; this.error = ''; }
        catch (e) { this.error = e instanceof Error ? e.message : String(e); }
      } while (this.again && this.alive);
      this.emit();
    })();
    try { await this.refreshing; } finally { this.refreshing = undefined; }
  }
  scheduleRefresh(): void { clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), 600); }
  async run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) { this.notice('已有 Git 操作正在执行'); return undefined; }
    this.busy = true; this.message = label; this.error = ''; this.emit();
    try { const result = await work(); this.notice(`${label}完成`); return result; }
    catch (e) { this.error = e instanceof Error ? e.message : String(e); this.notice(this.error); }
    finally { const failure = this.error; await this.refresh(); this.error = failure || this.error; this.busy = false; this.message = ''; this.emit(); }
  }
  private async cached<T>(cache: LruCache<T>, key: string, read: () => Promise<T>): Promise<T> {
    const cached = cache.get(key); if (cached !== undefined) return cached;
    const generation = this.generation, value = await read();
    if (this.alive && generation === this.generation) cache.set(key, value);
    return value;
  }
  async log(filter: LogFilter, skip: number, limit: number): Promise<Commit[]> {
    return this.cached(this.historyCache, JSON.stringify([filter, skip, limit]), () => this.git.log(filter, skip, limit));
  }
  async history(path: string, limit: number): Promise<Commit[]> { return this.cached(this.historyCache, `file:${path}:${limit}`, () => this.git.history(path, limit)); }
  async blame(path: string, text: string): Promise<BlameLine[]> {
    const key = `${path}:${this.status?.head}:${this.git.fingerprint(text)}`; return this.cached(this.blameCache, key, () => this.git.blame(path, text));
  }
  async diff(path: string, left: Revision, right: Revision, oldPath = path): Promise<FileDiff> {
    return this.cached(this.diffCache, JSON.stringify([path, left, right, oldPath]), () => this.git.diff(path, left, right, oldPath));
  }
  async lineChange(path: string, blame: BlameLine, contents: string): Promise<BlameChange> {
    const key = JSON.stringify([path, blame.path, blame.hash, blame.originalLine, blame.line, blame.uncommitted ? this.git.fingerprint(contents) : '']);
    return this.cached(this.lineChangeCache, key, () => this.git.lineChange(path, blame, contents));
  }
  async automation(flush: () => Promise<void>): Promise<void> {
    if (this.busy || this.automationPaused || !this.git.repo || (!this.settings.autoCommit && !this.settings.autoSync)) return;
    let failed = false;
    await this.run('自动备份', async () => {
      try {
        await flush(); const status = await this.git.status();
        if (status.operation || status.files.some(f => f.conflict)) throw new Error('仓库有未完成操作或冲突，自动备份已暂停');
        if (status.files.length) {
          const paths = status.files.flatMap(f => f.oldPath ? [f.oldPath, f.path] : [f.path]);
          await this.git.stage([...new Set(paths)]);
          await this.git.commit(formatCommitMessage(this.settings.commitTemplate));
        }
        if (this.settings.autoSync) { await this.git.network('fetch'); await this.git.network('pull'); await this.git.network('push'); }
      } catch (e) { failed = true; throw e; }
    });
    if (failed) { this.automationPaused = true; this.emit(); this.notice('自动备份已暂停，在设置中检查原因并恢复'); }
  }
  dispose(): void { this.alive = false; clearTimeout(this.timer); this.listeners.clear(); this.historyCache.clear(); this.blameCache.clear(); this.diffCache.clear(); this.lineChangeCache.clear(); this.git.dispose(); }
}
