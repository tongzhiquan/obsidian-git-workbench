import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeLines } from '../src/editor-changes';

test('live gutter retains existing changes and moves them after insertions and undo', () => {
  const base = 'one\ntwo\nthree\nfour\n';
  const changed = 'one\nmodified two\nthree\nfour\nnew line\n';
  assert.deepEqual([...changeLines(base, changed)], [[2, 'change'], [5, 'add']]);
  assert.deepEqual([...changeLines(base, 'inserted\n' + changed)], [[1, 'add'], [3, 'change'], [6, 'add']]);
  assert.deepEqual([...changeLines(base, base)], []);
});

test('gutter compares Obsidian LF text against CRLF index without marking untouched lines', () => {
  const base = '# note\r\nline two\r\nline three\r\n';
  assert.equal(changeLines(base, base.replace(/\r\n/g, '\n')).size, 0);
  assert.deepEqual([...changeLines(base, '# note\nchanged\nline three\n')], [[2, 'change']]);
});

test('gutter anchors deletions within the visible document including an empty or last line', () => {
  assert.deepEqual([...changeLines('one\ntwo', 'one')], [[1, 'change']]);
  assert.deepEqual([...changeLines('one\ntwo\nthree', 'one\n')], [[2, 'delete']]);
  assert.ok(changeLines('deleted', '').has(1));
  assert.deepEqual([...changeLines('', 'new\n')], [[1, 'add']]);
});
