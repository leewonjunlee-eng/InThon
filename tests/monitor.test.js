import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorSnapshot } from '../extension/lib/monitor.js';
import { AudioEngine } from '../extension/engine.js';
const base=()=>({tabId:1,title:'중계',role:'standby',profileId:'auto',alertSetup:{status:'ready'},monitor:{at:1000,audio:'ready',speech:'ready',judge:'idle',screen:'idle'}});
test('monitor counts connected versus detecting and does not mark silence as failure',()=>{
 const s=base();const result=monitorSnapshot([s,{...base(),tabId:2,role:'main'}],2000);
 assert.equal(result.connected,2);assert.equal(result.ready,1);assert.equal(result.errors,0);
});
test('monitor distinguishes setup, stale heartbeat, capture failure and judgment failure',()=>{
 const s=base();s.alertSetup.status='generating';assert.equal(monitorSnapshot([s],2000).preparing,1);
 assert.equal(monitorSnapshot([base()],18000).delayed,1);
 s.monitor.audio='error';assert.equal(monitorSnapshot([s],2000).errors,1);
 const j=base();j.monitor.judge='error';assert.equal(monitorSnapshot([j],2000).errors,1);
 j.monitor.judge='ready';assert.equal(monitorSnapshot([j],2000).ready,1);
});
test('AI request failure is reported and a successful retry restores health',async()=>{
 const e=Object.create(AudioEngine.prototype),events=[];e.emit=v=>events.push(v);
 const c={id:1,health:{judge:'idle'}};
 await assert.rejects(e.monitored(c,'judge',async()=>{throw new Error('offline')}));
 assert.equal(c.health.judge,'error');
 await e.monitored(c,'judge',async()=>({important:false}));
 assert.equal(c.health.judge,'ready');assert.equal(events.at(-1).type,'monitor');
});
test('slow judgment becomes delayed then recovers, without waiting on real time',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const e=Object.create(AudioEngine.prototype),events=[];e.emit=v=>events.push(v);
 const c={id:1,health:{judge:'idle'}};let finish;
 const pending=e.monitored(c,'judge',()=>new Promise(resolve=>{finish=resolve}));
 t.mock.timers.tick(5001);assert.equal(c.health.judge,'delay');
 finish({important:false});await pending;assert.equal(c.health.judge,'ready');
});
test('disabled rules are not counted as actively monitored',()=>{
 const s=base();s.monitor.alertEnabled=false;
 assert.equal(monitorSnapshot([s],2000).ready,0);
 assert.equal(monitorSnapshot([s],2000).items[0].status,'off');
});
