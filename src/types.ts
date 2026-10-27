import { DEFAULT_AI_PROMPT } from './ai-prompt';
export type Revision = { kind: 'commit'; ref: string } | { kind: 'index' } | { kind: 'worktree' } | { kind: 'empty' };
export const HEAD: Revision = { kind: 'commit', ref: 'HEAD' };
export const INDEX: Revision = { kind: 'index' };
export const WORKTREE: Revision = { kind: 'worktree' };
export const EMPTY: Revision = { kind: 'empty' };
export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';
export interface Repository { root: string; gitDir: string; commonDir: string; vaultPrefix: string; gitVersion: string }
export interface FileStatus { path: string; oldPath?: string; index: string; worktree: string; conflict: boolean; untracked: boolean; submodule: boolean }
export interface RepoStatus { branch: string; head: string; upstream: string; ahead: number; behind: number; files: FileStatus[]; operation?: Operation }
export interface Commit { hash: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string[]; body?: string; path?: string }
export interface LogFilter { author?: string; message?: string; since?: string; until?: string; path?: string; ref?: string }
export interface GitRef { name: string; fullName: string; hash: string; type: 'branch' | 'remote' | 'tag'; current: boolean; upstream: string }
export interface ChangedFile { path: string; oldPath?: string; status: string }
export interface FileContent { text: string; size: number; binary: boolean; large: boolean; exists: boolean; indexEntry?: string; mode?: string }
export type EditTarget = 'index' | 'worktree';
export type StagingMode = 'line' | 'block';
export interface PendingEdit { text: string; base: FileContent }
export interface DiffHunk { header: string; lines: string[]; patch: string; index: number }
export interface FileDiff { path: string; oldPath: string; left: Revision; right: Revision; before: FileContent; after: FileContent; patch: string; hunks: DiffHunk[]; stageable: 'stage' | 'unstage' | null; lineActions?: boolean }
export interface BlameLine { hash: string; author: string; date: number; subject: string; originalLine: number; line: number; path: string; text: string; uncommitted: boolean }
export interface BlameChangeLine { kind: 'add' | 'delete' | 'context'; text: string; line: number; selected: boolean }
export interface BlameChange { label: string; lines: BlameChangeLine[]; truncated: boolean; notice?: string }
export interface ConflictBlock { start: number; end: number; ours: string; theirs: string; base: string }
export interface Conflict { path: string; base: FileContent; ours: FileContent; theirs: FileContent; result: string; blocks: ConflictBlock[]; fileLevel: boolean }
export interface Stash { ref: string; hash: string; subject: string }
export interface Settings {
  version: 1; gitPath: string; inlineBlame: boolean; fullBlame: boolean; gutter: boolean;
  diffMode: 'split' | 'unified'; pageSize: number; autoBackup: boolean; autoCommit: boolean; autoSync: boolean;
  stagingMode: StagingMode;
  pullOnStartup: boolean; intervalMinutes: number; commitTemplate: string;
  sourceControlLayout: 'tree' | 'list';
  sourceControlVaultOnly: boolean;
  allowEditingStagedFiles: boolean;
  aiProvider: 'openai' | 'deepseek' | 'custom';
  aiBaseUrl: string;
  aiModel: string;
  aiApiKeyId: string;
  aiPrompt: string;
  aiMaxDiffChars: number;
}
export const DEFAULT_SETTINGS: Settings = {
  version: 1, gitPath: 'git', inlineBlame: true, fullBlame: false, gutter: true,
  diffMode: 'split', pageSize: 200, autoBackup: false, autoCommit: false, autoSync: false,
  stagingMode: 'line',
  pullOnStartup: false, intervalMinutes: 10, commitTemplate: 'vault backup: {{date}}',
  sourceControlLayout: 'tree',
  sourceControlVaultOnly: false,
  allowEditingStagedFiles: false,
  aiProvider: 'deepseek',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: 'deepseek-chat',
  aiApiKeyId: 'git-workbench-ai-api-key',
  aiPrompt: DEFAULT_AI_PROMPT,
  aiMaxDiffChars: 120000,
};
export function revisionLabel(ref: Revision): string {
  return ref.kind === 'commit' ? ref.ref.slice(0, 12) : ({ index: '暂存区', worktree: '工作区', empty: '空版本' })[ref.kind];
}
