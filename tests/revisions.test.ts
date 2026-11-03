import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, HEAD, INDEX, WORKTREE, parseRevision } from '../src/types';

test('comparison inputs accept the same snapshots, refs and empty input defaults on either side', () => {
  for (const [value, expected] of [[':empty', EMPTY], [':index', INDEX], [':worktree', WORKTREE], ['', HEAD], ['  ', HEAD]] as const) {
    assert.deepEqual(parseRevision(value), expected);
    assert.deepEqual(parseRevision(` ${value} `), expected);
  }
  for (const ref of ['HEAD', 'HEAD~1', 'main', 'refs/tags/v1', 'a'.repeat(40)]) {
    assert.deepEqual(parseRevision(` ${ref} `), { kind: 'commit', ref });
  }
});
