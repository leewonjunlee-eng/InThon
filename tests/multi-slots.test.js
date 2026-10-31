import test from 'node:test';
import assert from 'node:assert/strict';
import { nextConnectedSlot, computeRoles, emptySlot } from '../extension/lib/logic.js';

test('focus cycles through every connected slot and skips empty slots', () => {
  const slots = [11, null, 12, 13].map(tabId => ({ ...emptySlot(), tabId }));
  assert.equal(nextConnectedSlot(slots, 0), 2);
  assert.equal(nextConnectedSlot(slots, 2), 3);
  assert.equal(nextConnectedSlot(slots, 3), 0);
  assert.equal(nextConnectedSlot(slots, -1), 0);
  assert.equal(nextConnectedSlot([emptySlot()], -1), -1);
  assert.equal(nextConnectedSlot([], -1), -1);
  assert.deepEqual(computeRoles({ slots, view: {}, manual: 3, peek: null, auto: true }), ['standby', null, 'standby', 'main']);
});
