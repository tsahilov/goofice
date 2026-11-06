import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudStore } from '../cloud-store.mjs';
import '../data.js';
const planner = globalThis.OfficePlanner;
function setup() {
 const watches = [], docs = new Map(); let reject = false;
 const api = {
  doc: (_, ...path) => path.join('/'), collection: (_, ...path) => path.join('/'), limit: n => n, query: (...args) => args,
  Timestamp: { fromDate: date => date }, serverTimestamp: () => ({ seconds: 100, nanoseconds: 5 }),
  onSnapshot: (query, metadata, next, error) => { const w = {query,next,error, stopped:false}; watches.push(w); return () => w.stopped=true; },
  runTransaction: async (_, fn) => {
   if (reject) throw {code:'permission-denied'};
   const changes=[];
   const result=await fn({get:async key=>({exists:()=>docs.has(key)}), delete:key=>changes.push(()=>docs.delete(key)), set:(key,value)=>changes.push(()=>docs.set(key,value))});
   changes.forEach(change=>change()); return result;
  },
 };
 const writes=[];
 const storage={getItem:()=> 'dasha', setItem:(...args)=>writes.push(args)};
 const store=createCloudStore({api,db:{},storage,planner});
 const dates=store.ensureWindow();
 const send=(watch, values=[], metadata={fromCache:false,hasPendingWrites:false})=>watch.next({metadata,docs:values.map(([id,data])=>({id,data:()=>data}))});
 return {store, watches, dates, docs, writes, send, fail:()=>reject=true, ready:()=>watches.forEach(w=>send(w))};
}
test('14 subscriptions, loading, local identity only, no upload',()=>{
 const h=setup();assert.equal(h.watches.length,14);assert.equal(h.store.state.loading,true);assert.equal(h.docs.size,0);assert.equal(h.store.getMember(),'dasha');h.ready();assert.equal(h.store.state.connected,true);
 h.store.setMember('alan');assert.equal(h.writes.length,1);
});
test('confirmed timestamp nanoseconds and ID tie-break; pending snapshots ignored',()=>{
 const h=setup();h.ready();const w=h.watches[0], date=h.dates[0];
 const row=(id,n)=>[id,{memberId:id,createdAt:{seconds:1,nanoseconds:n}}];
 h.send(w,[row('denis',2),row('dasha',1),row('alan',1)]);
 assert.deepEqual(h.store.list(date).map(r=>r.id),['alan','dasha','denis']);
 h.send(w,[],{hasPendingWrites:true,fromCache:false});assert.equal(h.store.list(date).length,3);
});
test('transactions toggle only one member and do not lose others',async()=>{
 const h=setup();h.ready();const date=planner.dateId();
 assert.equal(await h.store.toggle(date,'alan'),true);assert.equal(await h.store.toggle(date,'anya'),true);assert.equal(h.docs.size,2);
 assert.equal(await h.store.toggle(date,'alan'),false);assert.equal(h.docs.size,1);
 assert.equal(await h.store.toggle(date,'alan'),true);assert.equal(h.docs.size,2);
});
test('write failure is rejected without fake data or success',async()=>{
 const h=setup();h.ready();h.fail();await assert.rejects(h.store.toggle(planner.dateId(),'alan'));assert.equal(h.docs.size,0);assert.match(h.store.state.error,/не сохранена/);assert.equal(h.store.state.saving,false);
});
test('subscription errors persist; cache-only results do not unlock editing',async()=>{
 const h=setup();h.watches[0].error({code:'permission-denied'});h.send(h.watches[1]);assert.equal(h.store.state.connected,false);assert.ok(h.store.state.error);
 const k=setup();k.watches.forEach(w=>k.send(w,[],{fromCache:true,hasPendingWrites:false}));await assert.rejects(k.store.toggle(planner.dateId(),'alan'));assert.equal(k.docs.size,0);
});
test('new week unsubscribes; callbacks from old window ignored',()=>{
 const h=setup();h.ready();h.store.ensureWindow(new Date(Date.now()+14*86400000));assert.ok(h.watches.slice(0,14).every(w=>w.stopped));h.watches[0].error({code:'old'});assert.equal(h.store.state.error,'');h.store.destroy();assert.ok(h.watches.every(w=>w.stopped));
});
