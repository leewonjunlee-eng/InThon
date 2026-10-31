import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function harness(shared = {values:{},listeners:new Set()}) {
  let listener, poll, failure=null, removed=false;
  const nodes=new Map(), attrs=new Map();
  function elem(){return {style:{setProperty(){}},setAttribute(k,v){attrs.set(k,v)},getBoundingClientRect(){return {width:294,height:38}},append(){},replaceChildren(){},remove(){removed=true},attachShadow(){return {set innerHTML(v){},querySelector(s){if(!nodes.has(s))nodes.set(s,elem());return nodes.get(s)}}}};}
  const hostNodes=[];
  const snapshot={connected:0,items:[],ready:0};
  const context=vm.createContext({document:{getElementById:()=>null,createElement:()=>{const e=elem();hostNodes.push(e);return e;},documentElement:elem()},innerWidth:1200,innerHeight:800,window:{addEventListener(){},removeEventListener(){}},chrome:{runtime:{sendMessage:async()=>{if(failure)throw Error(failure);return {ok:true,result:snapshot}},onMessage:{addListener(fn){listener=fn},removeListener(fn){if(listener===fn)listener=null}}},storage:{local:{get:async()=>({...shared.values}),set:async values=>{const changes={};for(const [key,value] of Object.entries(values)){changes[key]={newValue:value};shared.values[key]=value;}for(const fn of shared.listeners)fn(changes,'local');}},onChanged:{addListener(fn){shared.listeners.add(fn)},removeListener(fn){shared.listeners.delete(fn)}}}},setInterval:fn=>{poll=fn;return 1},clearInterval(){}});
  vm.runInContext(await readFile(new URL('../extension/status-bar.js',import.meta.url),'utf8'),context);
  await new Promise(r=>setImmediate(r));
  return {nodes,host:hostNodes[0],get removed(){return removed},get listener(){return listener},fail:v=>{failure=v},poll:()=>poll(),send:connected=>{let response;listener?.({to:'monitor',snapshot:{connected,items:[],ready:connected}},null,r=>response=r);return response}};
}

test('connected status toggles; disconnected status closes; any new connection restores it',async()=>{
  const h=await harness();assert.equal(h.host.style.display,'none');
  h.send(1);assert.equal(h.host.style.display,'block');assert.equal(h.nodes.get('.close').textContent,'▾');
  h.nodes.get('.close').onclick();assert.equal(h.nodes.get('.panel').hidden,false);assert.equal(h.host.style.display,'block');
  h.send(0);assert.equal(h.host.style.display,'block');assert.equal(h.nodes.get('.close').textContent,'×');
  h.nodes.get('.close').onclick();assert.equal(h.host.style.display,'none');
  h.send(0);assert.equal(h.host.style.display,'none');
  h.send(2);assert.equal(h.host.style.display,'block');assert.equal(h.nodes.get('.close').textContent,'▴');
});

test('temporary messaging failure recovers and invalidated context removes receiver',async()=>{
  const h=await harness();h.send(1);h.fail('Message port closed');await h.poll();
  assert.equal(h.removed,false);assert.equal(h.send(1).monitorReady,true);assert.match(h.nodes.get('.label').textContent,/감지 중 1/);
  h.fail('Extension context invalidated.');await h.poll();
  assert.equal(h.removed,true);assert.equal(h.listener,null);
});

 test('expansion syncs across windows and restores on newly opened pages',async()=>{
  const shared={values:{},listeners:new Set()};
  const a=await harness(shared),b=await harness(shared);a.send(1);b.send(1);
  a.nodes.get('.close').onclick();assert.equal(b.nodes.get('.panel').hidden,false);
  const c=await harness(shared);c.send(1);assert.equal(c.nodes.get('.panel').hidden,false);
  b.nodes.get('.close').onclick();assert.equal(a.nodes.get('.panel').hidden,true);assert.equal(c.nodes.get('.panel').hidden,true);
});
