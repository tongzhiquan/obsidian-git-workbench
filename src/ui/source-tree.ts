import type { FileStatus } from '../types';

export type SourceGroup = 'conflict' | 'index' | 'worktree' | 'untracked';
export type SourceRow =
  | { kind: 'group'; type: SourceGroup; key: string; title: string; files: FileStatus[]; depth: number }
  | { kind: 'folder'; type: SourceGroup; key: string; path: string; name: string; files: FileStatus[]; depth: number }
  | { kind: 'file'; type: SourceGroup; key: string; file: FileStatus; name: string; directory: string; depth: number };
const compare = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' }).compare;

export function scopedSourceFiles(files: FileStatus[], prefix: string, vaultOnly: boolean): FileStatus[] {
  if (!vaultOnly || !prefix) return files;
  const inside = (path: string) => path.startsWith(prefix + '/');
  return files.flatMap(file => {
    if (inside(file.path)) {
      if (!file.oldPath || inside(file.oldPath)) return [file];
      return [{ ...file, oldPath: undefined, index: /[RC]/.test(file.index) ? 'A' : file.index, worktree: /[RC]/.test(file.worktree) ? 'A' : file.worktree }];
    }
    if (!file.oldPath || !inside(file.oldPath)) return [];
    // A move out of the vault is a deletion here; changes at its destination belong outside.
    const index = file.index === 'R' ? 'D' : '.', worktree = file.index === '.' && file.worktree === 'R' ? 'D' : '.';
    return index === '.' && worktree === '.' ? [] : [{ ...file, path: file.oldPath, oldPath: undefined, index, worktree }];
  });
}

export function sourcePaths(files: FileStatus[], prefix: string, vaultOnly: boolean): string[] {
  return [...new Set(scopedSourceFiles(files, prefix, vaultOnly).flatMap(file => file.oldPath ? [file.oldPath, file.path] : [file.path]))]
    .filter(path => !vaultOnly || !prefix || path.startsWith(prefix + '/'));
}

export function sourceRows(files: FileStatus[], layout: 'tree' | 'list', collapsed: ReadonlySet<string>): SourceRow[] {
  const rows: SourceRow[] = [];
  const groups: [SourceGroup, string, FileStatus[]][] = [
    ['conflict', '冲突', files.filter(f => f.conflict)],
    ['index', '已暂存', files.filter(f => !f.conflict && !f.untracked && f.index !== '.')],
    ['worktree', '未暂存', files.filter(f => !f.conflict && !f.untracked && f.worktree !== '.')],
    ['untracked', '未跟踪', files.filter(f => f.untracked)],
  ];
  for (const [type, title, group] of groups) {
    if (!group.length) continue;
    const key = `group:${type}`;
    rows.push({ kind: 'group', type, key, title, files: group, depth: 0 });
    if (collapsed.has(key)) continue;
    const addFile = (file: FileStatus, depth: number) => {
      const parts = file.path.split('/'), name = parts.pop()!;
      rows.push({ kind: 'file', type, key: `${type}:file:${file.path}`, file, name, directory: parts.join('/'), depth });
    };
    if (layout === 'list') {
      [...group].sort((a, b) => compare(a.path, b.path)).forEach(file => addFile(file, 0));
      continue;
    }
    interface Folder { name: string; path: string; folders: Map<string, Folder>; files: FileStatus[]; descendants: FileStatus[] }
    const folder = (name = '', path = ''): Folder => ({ name, path, folders: new Map(), files: [], descendants: [] });
    const root = folder();
    for (const file of group) {
      const parts = file.path.split('/'); parts.pop(); let node = root;
      for (const name of parts) {
        let child = node.folders.get(name);
        if (!child) { child = folder(name, node.path ? `${node.path}/${name}` : name); node.folders.set(name, child); }
        child.descendants.push(file); node = child;
      }
      node.files.push(file);
    }
    const visit = (node: Folder, depth: number) => {
      for (const child of [...node.folders.values()].sort((a, b) => compare(a.name, b.name))) {
        const key = `${type}:folder:${child.path}`;
        rows.push({ kind: 'folder', type, key, path: child.path, name: child.name, files: child.descendants, depth });
        if (!collapsed.has(key)) visit(child, depth + 1);
      }
      [...node.files].sort((a, b) => compare(a.path, b.path)).forEach(file => addFile(file, depth));
    };
    visit(root, 0);
  }
  return rows;
}
