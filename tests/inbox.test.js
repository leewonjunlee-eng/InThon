import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.scrollTop = 0; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  replaceChildren() { this.children = []; }
  attachShadow() { return new Element('shadow'); }
  setAttribute() {}
  addEventListener() {}
}

test('a fresh inbox context replaces orphaned bells and reinjection does not duplicate them', async () => {
  const root = new Element('root');
  const hosts = () => root.children.filter(node => node.id === 'catchsound-dnd-inbox');
  const source = await readFile(new URL('../extension/inbox.js', import.meta.url), 'utf8');
  function createContext() {
    let listener, registrations = 0;
    const context = vm.createContext({
      document: { documentElement: root, createElement: tag => new Element(tag), querySelectorAll: hosts },
      window: { innerWidth: 1000, innerHeight: 800, addEventListener() {} },
      chrome: { runtime: {
        onMessage: { addListener(fn) { listener = fn; registrations++; } },
        sendMessage: async () => ({ ok: false }),
      } },
    });
    const inject = () => vm.runInContext(source, context);
    const update = enabled => listener({ to: 'content', cmd: 'dnd-inbox', inbox: { enabled, items: [] } }, {}, () => {});
    return { inject, update, registrations: () => registrations };
  }
  const old = createContext(); old.inject(); old.update(true);
  const staleHost = hosts()[0];
  const current = createContext(); current.inject(); current.update(true);
  assert.equal(hosts().length, 1);
  assert.notEqual(hosts()[0], staleHost, 'the old fixed bell must be removed');
  current.inject(); current.update(true);
  assert.equal(current.registrations(), 1);
  assert.equal(hosts().length, 1);
  current.update(false);
  assert.equal(hosts().length, 0);
  current.update(true);
  assert.equal(hosts().length, 1);
});
