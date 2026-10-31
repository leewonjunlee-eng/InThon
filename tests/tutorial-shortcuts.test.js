import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorialShortcutRouter, connectTutorialShortcuts, TUTORIAL_PORT } from '../extension/lib/tutorial-shortcuts.js';
const event = () => {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } };
};
test('tutorial receives Chrome commands exclusively, then releases them on close', () => {
  const runtime = { id: 'test-extension', onConnect: event() };
  runtime.connect = ({ name }) => {
    const client = { onMessage: event(), onDisconnect: event() };
    const server = { name, onMessage: event(), onDisconnect: event() };
    client.postMessage = message => server.onMessage.emit(message);
    server.postMessage = message => client.onMessage.emit(message);
    client.disconnect = () => { server.onDisconnect.emit(); client.onDisconnect.emit(); };
    runtime.onConnect.emit(server);
    return client;
  };
  const route = createTutorialShortcutRouter(runtime);
  assert.equal(route('switch-focus'), false);
  const commands = [];
  const close = connectTutorialShortcuts(runtime, command => commands.push(command));
  try {
    for (const command of ['connect-tab', 'switch-focus', 'restore']) assert.equal(route(command), true);
    assert.deepEqual(commands, ['connect-tab', 'switch-focus', 'restore']);
  } finally { close(); }
  assert.equal(route('switch-focus'), false);
});
test('failed tutorial delivery cannot trigger a real audio command', () => {
  const runtime = { onConnect: event() };
  const route = createTutorialShortcutRouter(runtime);
  runtime.onConnect.emit({ name: TUTORIAL_PORT, onMessage: event(), onDisconnect: event(), postMessage() { throw Error('closed'); } });
  assert.equal(route('switch-focus'), true);
});
