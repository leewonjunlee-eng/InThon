import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../extension/engine.js';
import { normalizeSummary } from '../extension/lib/summary.js';

function fixture(api, speech = '시험에 나옵니다. 과제 제출은 금요일입니다.') {
  const events = [];
  const engine = Object.create(AudioEngine.prototype);
  engine.api = api;
  engine.emit = event => { events.push(structuredClone(event)); };
  const channel = { id: 4, profile: { name: '강의', condition: '시험 공지', summaryFocus: '시험과 과제' },
    lastMomentAt: 0, lastMomentKind: null, lines: [{ t: Date.now(), text: speech }] };
  return { engine, channel, events };
}
test('alert is emitted before AI finishes and then updated with the same ID', async () => {
  let resolve;
  const { engine, channel, events } = fixture({ summarize: () => new Promise(done => { resolve = done; }) });
  const work = engine.moment(channel, { kind: 'keyword', keyword: '시험' });
  await Promise.resolve();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'moment');
  assert.equal(events[0].moment.summaryStatus, 'loading');
  assert.match(events[0].moment.summary, /금요일/);
  resolve({ summary: '시험 안내가 있었고 과제 제출 기한은 금요일입니다.', evidence: ['과제 제출은 금요일입니다.'] });
  await work;
  assert.equal(events[1].type, 'moment-update');
  assert.equal(events[1].moment.id, events[0].moment.id);
  assert.equal(events[1].moment.summaryStatus, 'ai');
});
test('unavailable AI leaves an explicit transcript excerpt instead of losing the alert', async () => {
  const { engine, channel, events } = fixture({ summarize: async () => { throw new Error('offline'); } });
  await engine.moment(channel, { kind: 'keyword', keyword: '시험' });
  assert.equal(events[1].moment.summaryStatus, 'fallback');
  assert.match(events[1].moment.summary, /금요일/);
});
test('no recognized speech is not summarized or invented', async () => {
  const { engine, channel, events } = fixture({ summarize: () => assert.fail('must not call AI') }, '(소리 변화: 함성)');
  await engine.moment(channel, { kind: 'surge' });
  assert.equal(events.length, 1);
  assert.equal(events[0].moment.summaryStatus, 'no-transcript');
});
test('empty AI output is rejected and ungrounded evidence is excluded', () => {
  assert.throws(() => normalizeSummary({ summary: ' ' }, []));
  const result = normalizeSummary({ summary: '공지', evidence: ['없는 문장'] }, [{ text: '금요일 제출' }]);
  assert.deepEqual(result.evidence, ['금요일 제출']);
});
