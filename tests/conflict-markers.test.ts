import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictBlocks, remainingConflictMarkers } from '../src/git/parsers';

test('conflict blocks support configured widths, diff3, CRLF and multiple independent blocks', () => {
  for (const size of [1, 7, 9, 32]) {
    const source = `before\r\n${'<'.repeat(size)} HEAD\r\nours\r\n${'|'.repeat(size)} base\r\nbase\r\n${'='.repeat(size)}\r\ntheirs\r\n${'>'.repeat(size)} topic\r\nafter\r\n`;
    const blocks = conflictBlocks(source + source, size);
    assert.equal(blocks.length, 2); assert.equal(blocks[0].ours, 'ours\r\n'); assert.equal(blocks[0].theirs, 'theirs\r\n'); assert.equal(blocks[0].base, 'base\r\n');
    assert.equal(blocks[1].start, source.length + blocks[0].start);
    assert.equal(source.slice(blocks[0].start, blocks[0].end).startsWith('<'.repeat(size)), true);
    assert.equal(remainingConflictMarkers(source, size).length, 4);
  }
});

test('orphaned and incomplete markers are detected even when no complete block remains', () => {
  for (const source of ['<<<<<<< HEAD\nours\n', '=======\ntheirs\n>>>>>>> topic\n', '||||||| base\n', '>>>>>>> topic', '<<<<<<< HEAD\nours\n>>>>>>> topic\n']) {
    assert.equal(conflictBlocks(source).length, 0);
    assert.ok(remainingConflictMarkers(source).length > 0);
  }
  assert.deepEqual(remainingConflictMarkers('resolved\n=======\n'), [2]);
  assert.equal(conflictBlocks('<<<<<<< HEAD\nours\n=======\ntheirs\n=======\nmore\n>>>>>>> topic\n').length, 0);
});

test('ordinary comparisons, other marker widths and existing literal marker lines are preserved', () => {
  assert.deepEqual(remainingConflictMarkers('a < b\n>>> quote\n<<<<<<<identifier\n========\n'), []);
  const heading = 'Heading\n=======\n';
  assert.deepEqual(remainingConflictMarkers(heading, 7, [heading]), []);
  assert.deepEqual(remainingConflictMarkers(heading + '=======\n', 7, [heading]), [3]);
  assert.deepEqual(remainingConflictMarkers(heading + '=======\n', 7, [heading, heading, heading]), [3]);
});
