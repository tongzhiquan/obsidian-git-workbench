// Read-only diagnostic for a real vault; never stages, commits or contacts a remote.
import { GitService } from '../src/git/service';
import { layoutGraph } from '../src/git/graph';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveVaultPath } from './local-config.cjs';
const git = new GitService(resolveVaultPath(process.argv[2]));
try {
  const repo = await git.discover();
  if (!repo) throw new Error('No Git repository found');
  const [status, commits, refs, index] = await Promise.all([git.status(), git.log({}, 0, 200), git.refs(), readFile(join(repo.gitDir, 'index'))]);
  console.log(JSON.stringify({ repository: repo, head: status.head, indexHash: createHash('sha256').update(index).digest('hex'), stagedFiles: status.files.filter(f=>!f.untracked && f.index!=='.').length, branch: status.branch, changedFiles: status.files.length, conflictFiles: status.files.filter(f=>f.conflict).length, outsideVaultFiles: status.files.filter(f=>git.vaultPath(f.path)===undefined).length, commits: commits.length, graphRows: layoutGraph(commits).length, refs: refs.length, automation: 'disabled by default', readOnly: true }, null, 2));
} finally { git.dispose(); }
