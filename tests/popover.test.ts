import { test } from 'node:test';
import assert from 'node:assert/strict';
import { popoverPosition } from '../src/ui/popover-position';

test('popover appears near pointer above the line and flips below near window top', () => {
  assert.deepEqual(popoverPosition({ x: 400, y: 500 }, { width: 380, height: 200 }, { width: 1200, height: 800 }), { left: 412, top: 288 });
  assert.deepEqual(popoverPosition({ x: 400, y: 100 }, { width: 380, height: 200 }, { width: 1200, height: 800 }), { left: 412, top: 112 });
});
test('popover stays within edge margins at narrow window and bottom/right corner', () => {
  assert.deepEqual(popoverPosition({ x: 350, y: 650 }, { width: 336, height: 200 }, { width: 360, height: 700 }), { left: 12, top: 438 });
  const position = popoverPosition({ x: 1200, y: 799 }, { width: 380, height: 200 }, { width: 1200, height: 800 });
  assert.equal(position.left + 380, 1188); assert.equal(position.top + 200, 787);
});
