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
test('alert stays until a button, replaces on new event, and ignores late updates', async () => {
  const root = new Element('root');
  let listener;
  const sent = [];
  const context = vm.createContext({
    document: { documentElement: root, createElement: tag => new Element(tag), getElementById: id => walk(root).find(node => node.id === id) },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async message => { sent.push(message); return { ok: true }; } } },
    setTimeout: () => assert.fail('alert must not schedule auto-dismiss'),
  });
  vm.runInContext(await readFile(new URL('../extension/content.js', import.meta.url), 'utf8'), context);
  const emit = (cmd, moment) => listener({ to: 'content', cmd, moment }, {}, () => {});
  const first = { id: '1', tabId: 11, topic: '강의', time: '12:00', summary: '자막', evidence: [], summaryStatus: 'loading' };
  const second = { ...first, id: '2', tabId: 12 };
  emit('moment', first);
  assert.deepEqual(walk(root).filter(node => node.tag === 'button').map(node => node.textContent), ['여기에 집중', '나중에']);
  emit('moment-update', { ...first, summary: '완료된 요약', summaryStatus: 'ai' });
  assert(walk(root).some(node => node.textContent === '완료된 요약'));
  emit('moment', second);
  emit('moment-update', { ...first, summary: '오래된 요약' });
  assert(!walk(root).some(node => node.textContent === '오래된 요약'));
  assert.equal(root.children.length, 1);
  await walk(root).find(node => node.textContent === '여기에 집중').onclick();
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
  listener({ to: 'content', cmd: 'moment-clear', id: null }, {}, () => {});
  assert.equal(root.children.length, 0, 'a new event in another tab can clear the old card');
});
