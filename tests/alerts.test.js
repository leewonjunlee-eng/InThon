import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Minimal DOM harness: exercise the actual content script's lifecycle and buttons.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute() {}
  attachShadow() { this.shadowRoot = new Element('shadow'); return this.shadowRoot; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
}
const walk = node => [node, ...node.children.flatMap(walk), ...(node.shadowRoot ? walk(node.shadowRoot) : [])];
test('alerts expire, stack, report dismissal, and preserve the original deadline', async () => {
  const root = new Element('root');
  let listener;
  const sent = [];
  let now = 1000, timerId = 0;
  const timers = new Map();
  const context = vm.createContext({
    document: { documentElement: root, createElement: tag => new Element(tag), getElementById: id => walk(root).find(node => node.id === id) },
    chrome: { runtime: { getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async message => { sent.push(message); return { ok: true }; } } },
    Date: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(await readFile(new URL('../extension/content.js', import.meta.url), 'utf8'), context);
  const emit = (cmd, moment) => listener({ to: 'content', cmd, moment }, {}, () => {});
  const first = { id: '1', tabId: 11, topic: '강의', time: '12:00', summary: '자막', evidence: [], summaryStatus: 'loading' };
  const second = { ...first, id: '2', tabId: 12 };
  emit('moment', first);
  assert.deepEqual(walk(root).filter(node => node.tag === 'button').map(node => node.textContent), ['×', '이 탭에 집중', '나중에']);
  emit('moment-update', { ...first, summary: '완료된 요약', summaryStatus: 'ai' });
  assert(walk(root).some(node => node.textContent === '완료된 요약'));
  const details = walk(root).find(node => node.tag === 'details');
  assert(!details.open, 'evidence is collapsed initially');
  details.open = true;
  emit('moment-update', { ...first, summary: '새 요약', evidence: ['자막 근거'], summaryStatus: 'ai' });
  assert.equal(details.open, true, 'updates preserve expanded details');
  assert(walk(details).some(node => node.textContent === '자막 근거' && !node.hidden));
  emit('moment', second);
  emit('moment-update', { ...first, summary: '오래된 요약' });
  assert(walk(root).some(node => node.textContent === '오래된 요약'), 'the open first card still updates');
  const cards = () => walk(root).filter(node => node.className === 'card compact').length;
  assert.equal(cards(), 2, 'a new event joins the open card');
  listener({ to: 'content', cmd: 'moment-clear', id: first.id }, {}, () => {});
  assert.equal(cards(), 1);
  await walk(root).find(node => node.textContent === '이 탭에 집중').onclick();
  assert.equal(sent[0].cmd, 'focus'); assert.equal(sent[0].tabId, 12);
  assert.equal(root.children.length, 0);
  emit('moment-update', { ...second, summary: '늦게 온 요약' });
  assert.equal(root.children.length, 0, 'must not reopen dismissed alert');
  emit('moment', first);
  walk(root).find(node => node.textContent === '나중에').onclick();
  assert.equal(root.children.length, 0);
  emit('moment', first);
  listener({ to: 'content', cmd: 'moment-clear', id: 'different-id' }, {}, () => {});
  assert.equal(root.children.length, 1, 'clearing another event cannot close this card');
  listener({ to: 'content', cmd: 'moment-clear', id: first.id }, {}, () => {});
  assert.equal(root.children.length, 0);
  emit('moment-update', { ...first, summary: '늦은 요약' });
  assert.equal(root.children.length, 0);
  emit('moment', second);
  walk(root).find(node => node.textContent === '×').onclick();
  emit('moment-update', { ...second, summary: '닫은 뒤 요약' });
  assert.equal(root.children.length, 0, 'close button dismisses late updates too');
  emit('moment', second);
  listener({ to: 'content', cmd: 'moment-clear', id: null }, {}, () => {});
  assert.equal(root.children.length, 0, 'clearing without an id closes every card');
  listener({ to: 'content', cmd: 'focus-suggestion', tabId: 12, title: '대기 탭' }, {}, () => {});
  assert(walk(root).some(node => node.textContent === '이 탭에 집중할까요?'));
  assert.equal(sent.filter(message => message.cmd === 'focus').length, 1, 'showing a suggestion does not change focus');
  walk(root).find(node => node.textContent === '유지하기').onclick();
  assert.equal(root.children.length, 0);
  assert.equal(sent.filter(message => message.cmd === 'focus').length, 1);
  listener({ to: 'content', cmd: 'focus-suggestion', tabId: 12 }, {}, () => {});
  await walk(root).find(node => node.textContent === '이 탭에 집중').onclick();
  assert.equal(sent.at(-1).cmd, 'accept-focus-suggestion');
  assert.equal(sent.at(-1).tabId, 12);
  listener({ to: 'content', cmd: 'focus-suggestion', tabId: 12 }, {}, () => {});
  listener({ to: 'content', cmd: 'focus-suggestion-clear' }, {}, () => {});
  assert.equal(root.children.length, 0, 'leaving clears the suggestion');
  assert(sent.some(message => message.cmd === 'dismiss' && message.id === first.id), 'manual closing is shared with the background');
  now = 5000;
  const expiring = { ...first, id: 'deadline', expiresAt: 11000 };
  emit('moment', expiring);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 6000, 'moved alerts use only the remaining lifetime');
  const originalTimer = timerId;
  emit('moment', expiring);
  emit('moment-update', { ...expiring, summary: '늦은 요약' });
  assert.equal(timerId, originalTimer, 'moving or updating never extends the deadline');
  now = 11000;
  await [...timers.values()][0].fn();
  assert.equal(root.children.length, 0);
  assert(sent.some(message => message.cmd === 'dismiss' && message.id === 'deadline'));
  emit('moment', expiring);
  assert.equal(root.children.length, 0, 'an expired re-delivery cannot reopen the card');


});
