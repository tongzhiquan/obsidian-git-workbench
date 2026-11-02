import type { FileStatus } from '../types';

export function statusPaths(files: FileStatus[], target: 'index' | 'worktree'): string[] {
  // oldPath belongs to the rename reported on one side of HEAD -> index -> worktree.
  // A rename already staged in the index must not add its absent source again.
  return [...new Set(files.flatMap(file => file.oldPath && file[target] === 'R' ? [file.oldPath, file.path] : [file.path]))];
}
