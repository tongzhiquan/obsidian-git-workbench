import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChange } from '../src/git/line-change';
import { decodeGitPath } from '../src/git/parsers';
test('line preview selects only the edit block that contains the attributed historical line', () => {
  const result = lineChange('first\nold\nseparator\nlast\n', 'first\nnew\nseparator\nchanged last\n', 2, 'parent → commit');
  assert.deepEqual(result.lines.map(row => [row.kind, row.text, row.line, row.selected]), [['delete', 'old', 2, false], ['add', 'new', 2, true]]);
  assert.ok(!result.lines.some(row => row.text === 'changed last'));
});
test('first addition, CRLF and no-final-newline previews keep true line content', () => {
  assert.deepEqual(lineChange('', 'one\ntwo\n', 2, 'new').lines.map(row => row.text), ['one', 'two']);
  const result = lineChange('old\r\n', 'new\r\n', 1, 'CRLF'); assert.equal(result.lines[0].text, 'old'); assert.equal(result.lines[1].text, 'new');
  assert.equal(lineChange('old', 'new', 1, 'last line').lines[1].text, 'new');
});
test('unchanged lines are explained; long edit blocks remain bounded and include requested line', () => {
  assert.match(lineChange('same\n', 'same\n', 1, 'unchanged').notice!, /未改变/);
  const after = Array.from({ length: 200 }, (_, i) => 'line ' + (i + 1)).join('\n'); const result = lineChange('', after, 170, 'new');
  assert.equal(result.truncated, true); assert.equal(result.lines.length, 12); assert.ok(result.lines.some(row => row.selected && row.text === 'line 170'));
  const long = lineChange('old\n', 'x'.repeat(1000) + '\n', 1, 'large'); assert.equal(long.truncated, true); assert.equal(long.lines[1].text.length, 601);
});
test('Git quoted paths decode utf8, tabs, quotes and backslashes without corrupting ordinary paths', () => {
  assert.equal(decodeGitPath('"folder/\\344\\270\\255\\346\\226\\207\\tfile\\\".md"'), 'folder/中文\tfile".md');
  assert.equal(decodeGitPath('"a\\\\b.md"'), 'a\\b.md'); assert.equal(decodeGitPath('中文 空格.md'), '中文 空格.md');
});
