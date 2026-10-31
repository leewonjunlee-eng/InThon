import test from 'node:test';
import assert from 'node:assert/strict';
import { savePreset, deletePreset, numberConditions } from '../extension/lib/presets.js';

test('presets validate required fields, preserve built-ins and update without duplicates', () => {
  const builtIn = { id: 'lol', name: '롤' };
  const original = [builtIn];
  assert.throws(() => savePreset(original, { id: 'lol', name: '수정', condition: '조건' }));
  assert.throws(() => savePreset(original, { id: 'custom-test', name: ' ', condition: '조건' }));
  const first = savePreset(original, { id: 'custom-test', name: ' 경기 ', condition: '한타', keywords: ['한타', 5] });
  const updated = savePreset(first, { ...first[1], name: '수정한 경기' });
  assert.equal(updated.length, 2);
  assert.equal(updated[0], builtIn);
  assert.equal(updated[1].name, '수정한 경기');
  assert.deepEqual(updated[1].keywords, ['한타']);
  assert.equal(original.length, 1);
});

test('deleting a custom preset clears only its assignments and does not disconnect audio', () => {
  const profiles = [{ id: 'lol' }, { id: 'custom-one' }];
  const slots = [{ tabId: 11, profileId: 'custom-one' }, { tabId: 12, profileId: 'lol' }];
  assert.throws(() => deletePreset(profiles, slots, 'lol'));
  assert.deepEqual(deletePreset(profiles, slots, 'custom-one'), [{ id: 'lol' }]);
  assert.deepEqual(slots, [{ tabId: 11, profileId: null }, { tabId: 12, profileId: 'lol' }]);
});

test('generated conditions are numbered once, skipping empty lines', () => {
  assert.equal(numberConditions('첫 조건\n\n두 번째 조건'), '1. 첫 조건\n2. 두 번째 조건');
  assert.equal(numberConditions('1. 첫 조건\n2) 두 번째 조건'), '1. 첫 조건\n2. 두 번째 조건');
  assert.equal(numberConditions('- 단일 조건'), '1. 단일 조건');
  assert.equal(numberConditions(''), '');
});
