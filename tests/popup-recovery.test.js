import test from 'node:test';
import assert from 'node:assert/strict';
import { reopenPopupAfterConnect } from '../extension/lib/popup-recovery.js';

function fixture() {
  const requests = [];
  const api = {
    runtime: { getContexts: async () => [] },
    windows: { getLastFocused: async () => ({ id: 1, focused: true }) },
    tabs: { query: async () => [{ id: 11 }] },
    action: { openPopup: async options => requests.push(options) },
  };
  return { api, requests, target: { id: 11, windowId: 1 } };
}

test('reopens once after connection only when popup closed and target tab still focused', async () => {
  const { api, requests, target } = fixture();
  assert.equal(await reopenPopupAfterConnect(api, target), true);
  assert.deepEqual(requests, [{ windowId: 1 }]);
});

test('does not reopen an existing popup or interrupt a different tab, window, or app', async () => {
  for (const change of [
    api => { api.runtime.getContexts = async () => [{ contextType: 'POPUP' }]; },
    api => { api.tabs.query = async () => [{ id: 12 }]; },
    api => { api.tabs.query = async () => []; },
    api => { api.windows.getLastFocused = async () => ({ id: 2, focused: true }); },
    api => { api.windows.getLastFocused = async () => ({ id: 1, focused: false }); },
  ]) {
    const { api, requests, target } = fixture();
    change(api);
    assert.equal(await reopenPopupAfterConnect(api, target), false);
    assert.deepEqual(requests, []);
  }
});

test('browser rejection is nonfatal and never triggers a retry loop', async () => {
  const { api, target } = fixture();
  let attempts = 0;
  api.action.openPopup = async () => { attempts++; throw new Error('window closed'); };
  assert.equal(await reopenPopupAfterConnect(api, target), false);
  assert.equal(attempts, 1);
});
