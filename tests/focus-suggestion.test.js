import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusSuggestion } from '../extension/lib/focus-suggestion.js';
import { computeRoles, emptySlot } from '../extension/lib/logic.js';

test('three-second dwell suggests once per visit and cancels stale visits', async () => {
  let candidate = { tabId: 12, title: '대기 탭' };
  const pending = new Map(), shown = [], cleared = [];
  let next = 0;
  const controller = createFocusSuggestion({
    read: () => candidate,
    show: async value => { shown.push(value.tabId); },
    clear: async id => { cleared.push(id); },
    schedule: (callback, ms) => { assert.equal(ms, 3000); pending.set(++next, callback); return next; },
    cancel: id => pending.delete(id),
  });
  controller.update();
  assert.deepEqual(shown, []);
  const oldTimer = pending.get(1);
  candidate = null; controller.update();
  assert.equal(pending.size, 0);
  await oldTimer();
  assert.deepEqual(shown, [], 'leaving before three seconds cancels the suggestion');
  candidate = { tabId: 12 }; controller.update();
  await pending.get(2)();
  assert.deepEqual(shown, [12]);
  controller.update();
  assert.equal(next, 2, 'state updates or dismissal never re-prompt the same visit');
  candidate = null; controller.update();
  candidate = { tabId: 12 }; controller.update();
  await pending.get(3)();
  assert.deepEqual(shown, [12, 12], 'a new visit starts a new dwell');
  candidate = null; controller.update();
  assert(cleared.includes(12));
});

test('confirmation mode never promotes a viewed standby tab by itself', () => {
  const slots = [{ ...emptySlot(), tabId: 1, role: 'main' }, { ...emptySlot(), tabId: 2, role: 'standby' }];
  const state = { slots, view: { tabId: 2, focused: true }, manual: null, peek: null, auto: true, confirmAuto: true };
  assert.deepEqual(computeRoles(state), ['main', 'standby']);
  assert.deepEqual(computeRoles({ ...state, manual: 1 }), ['standby', 'main']);
});
