import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import * as api from 'firebase/firestore';
import { createCloudStore } from '../cloud-store.mjs';
import '../data.js';
import { initialRegistry, memberPalette, appendProfile, createParticipantRegistry } from '../participants.mjs';

// A missing/misconfigured emulator must never fall back to production.
const emulatorAddress = /^127\.0\.0\.1:(\d{1,5})$/.exec(process.env.FIRESTORE_EMULATOR_HOST ?? '');
assert.ok(emulatorAddress, 'Run npm run test:rules, never against a real project');
const emulatorPort = Number(emulatorAddress[1]);
const planner = globalThis.OfficePlanner;
const projectId = 'demo-gooffice-rules';
let env, db;
const stores = [];
const today = () => planner.dateId(new Date());
const shifted = days => {
  const date = new Date(today() + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return planner.dateId(date);
};
const mark = (date = today(), id = 'alan') => api.doc(db, 'days', date, 'marks', id);
const data = (date = today(), id = 'alan') => ({ memberId: id, dayStart: api.Timestamp.fromDate(new Date(date + 'T00:00:00Z')), createdAt: api.serverTimestamp() });
const marksQuery = (date = today(), count = 20) => api.query(api.collection(db, 'days', date, 'marks'), api.limit(count));
const denied = operation => assertFails(operation).then(error => assert.equal(error.code, 'permission-denied'));
async function seed(date, id, fields = {}) {
  await env.withSecurityRulesDisabled(async context => {
    await api.setDoc(api.doc(context.firestore(), 'days', date, 'marks', id), {
      memberId: id, dayStart: api.Timestamp.fromDate(new Date(date + 'T00:00:00Z')), createdAt: api.Timestamp.now(), ...fields,
    });
  });
}
function eventually(check, description) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      try { if (check()) { resolve(); return; } } catch (error) { reject(error); return; }
      if (Date.now() > deadline) { reject(new Error('Timeout: ' + description)); return; }
      setTimeout(poll, 20);
    };
    poll();
  });
}
function storeFor(client = db) {
  const store = createCloudStore({ api, db: client, planner, storage: null });
  stores.push(store);
  return store;
}
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: {
    host: '127.0.0.1', port: emulatorPort, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  db = env.unauthenticatedContext().firestore();
});
beforeEach(async () => { await env.clearFirestore(); await api.setDoc(api.doc(db,'team','registry'), initialRegistry(planner.MEMBERS)); });
afterEach(() => { stores.splice(0).forEach(store => store.destroy()); });
after(async () => { await env?.cleanup(); });

test('list: limit(20) and onSnapshot allowed; no limit and limit(21) denied', async () => {
  await assertSucceeds(api.getDocs(marksQuery()));
  await denied(api.getDocs(api.collection(db, 'days', today(), 'marks')));
  await denied(api.getDocs(marksQuery(today(), 21)));
  await new Promise((resolve, reject) => {
    const stop = api.onSnapshot(marksQuery(), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache) { stop(); resolve(); }
    }, reject);
  });
  for (const invalid of [api.collection(db, 'days', today(), 'marks'), marksQuery(today(), 21)]) {
    await denied(new Promise((resolve, reject) => {
      const stop = api.onSnapshot(invalid, snapshot => {
        if (!snapshot.metadata.fromCache) { stop(); resolve(snapshot); }
      }, error => { stop(); reject(error); });
    }));
  }
});

test('all 14 actual cloud-store subscriptions satisfy allow list', async () => {
  for (const date of planner.calendarDates().map(planner.dateId)) {
    for (const { id } of planner.MEMBERS) await seed(date, id);
  }
  const store = storeFor();
  const dates = store.ensureWindow();
  assert.equal(dates.length, 14);
  await eventually(() => {
    if (store.state.error && !store.state.error.includes('Нет подтверждения')) throw new Error(store.state.error);
    return store.state.connected;
  }, 'all 14 days receive confirmed server snapshots');
  assert.equal(store.state.loading, false);
  for (const date of dates) assert.equal(store.list(date).length, 4);
});

test('get: valid missing documents allowed, invalid ID and other paths denied', async () => {
  assert.equal((await assertSucceeds(api.getDoc(mark()))).exists(), false);
  await denied(api.getDoc(mark(today(), 'intruder')));
  await denied(api.getDoc(api.doc(db, 'private', 'secret')));
  await denied(api.getDoc(api.doc(db, 'days', today())));
  await denied(api.getDocs(api.collectionGroup(db, 'marks')));
});

test('create: all four participant IDs and real serverTimestamp accepted', async () => {
  for (const { id } of planner.MEMBERS) {
    await assertSucceeds(api.setDoc(mark(today(), id), data(today(), id)));
    const saved = (await api.getDoc(mark(today(), id))).data();
    assert.ok(saved.createdAt instanceof api.Timestamp);
    assert.equal(saved.memberId, id);
    assert.equal(saved.dayStart.toMillis(), Date.parse(today() + 'T00:00:00Z'));
  }
});

test('create: extra/missing fields, wrong IDs, types and client timestamps rejected', async () => {
  const good = data();
  for (const invalid of [
    { ...good, extra: true },
    { memberId: 'alan', createdAt: api.serverTimestamp() },
    { ...good, memberId: 'denis' },
    { ...good, memberId: 1 },
    { ...good, dayStart: shifted(1) },
    { ...good, dayStart: api.Timestamp.fromDate(new Date(shifted(1) + 'T00:00:00Z')) },
    { ...good, createdAt: api.Timestamp.fromMillis(0) },
    { ...good, createdAt: 'serverTimestamp' },
  ]) await denied(api.setDoc(mark(), invalid));
  await denied(api.setDoc(mark(today(), 'intruder'), data(today(), 'intruder')));
});

test('dates: read boundaries -6/+13; writes today..+13; past and out-of-range denied', async () => {
  for (const date of [shifted(-6), today(), shifted(13)]) await assertSucceeds(api.getDocs(marksQuery(date)));
  for (const date of [shifted(-7), shifted(14)]) await denied(api.getDocs(marksQuery(date)));
  for (const date of [today(), shifted(13)]) await assertSucceeds(api.setDoc(mark(date), data(date)));
  for (const date of [shifted(-1), shifted(14)]) await denied(api.setDoc(mark(date), data(date)));
  for (const date of ['2026-02-30', '2026-13-01', today().slice(0, 8) + '00', 'not-a-date', today().replaceAll('-', '')]) {
    await denied(api.getDoc(mark(date)));
  }
});

test('update: updateDoc, overwrite setDoc, merge, and same-data write all denied', async () => {
  await api.setDoc(mark(), data());
  const saved = (await api.getDoc(mark())).data();
  await denied(api.updateDoc(mark(), { createdAt: api.serverTimestamp() }));
  await denied(api.setDoc(mark(), data()));
  await denied(api.setDoc(mark(), { memberId: 'alan' }, { merge: true }));
  await denied(api.setDoc(mark(), saved));
});

test('delete: current valid document allowed; past, bad ID and mismatched member denied', async () => {
  await api.setDoc(mark(), data());
  await assertSucceeds(api.deleteDoc(mark()));
  await seed(shifted(-1), 'alan');
  await denied(api.deleteDoc(mark(shifted(-1))));
  await seed(today(), 'intruder');
  await denied(api.deleteDoc(mark(today(), 'intruder')));
  await seed(today(), 'alan', { memberId: 'denis' });
  await denied(api.deleteDoc(mark()));
});

test('real cloud-store transaction: create -> delete -> re-create, confirmed live order', async () => {
  const store = storeFor(); store.ensureWindow();
  await eventually(() => store.state.connected, 'ready');
  assert.equal(await store.toggle(today(), 'denis'), true);
  assert.equal(await store.toggle(today(), 'anya'), true);
  await eventually(() => store.list(today()).length === 2, 'two confirmed marks');
  assert.deepEqual(store.list(today()).map(row => row.id), ['denis', 'anya']);
  const firstTime = (await api.getDoc(mark(today(), 'denis'))).data().createdAt;
  assert.equal(await store.toggle(today(), 'denis'), false);
  assert.equal(await store.toggle(today(), 'denis'), true);
  await eventually(() => store.list(today()).map(row => row.id).join(',') === 'anya,denis', 're-add moves to end');
  const secondTime = (await api.getDoc(mark(today(), 'denis'))).data().createdAt;
  assert.ok(secondTime.toMillis() >= firstTime.toMillis());
});

test('two real clients concurrently toggle different participants without lost marks', async () => {
  const other = env.unauthenticatedContext().firestore();
  const a = storeFor(), b = storeFor(other); a.ensureWindow(); b.ensureWindow();
  await eventually(() => a.state.connected && b.state.connected, 'both clients ready');
  await Promise.all([a.toggle(today(), 'alan'), b.toggle(today(), 'dasha')]);
  await eventually(() => a.list(today()).length === 2 && b.list(today()).length === 2, 'both see two people');
  assert.deepEqual(a.list(today()).map(row => row.id), b.list(today()).map(row => row.id));
  await a.toggle(today(), 'alan');
  await eventually(() => b.list(today()).length === 1, 'deletion received');
  assert.equal(b.list(today())[0].id, 'dasha');
});

test('same participant concurrent toggles retry as create/delete, never update', async () => {
  const a = storeFor(), b = storeFor(env.unauthenticatedContext().firestore());
  a.ensureWindow(); b.ensureWindow();
  await eventually(() => a.state.connected && b.state.connected, 'ready');
  const outcomes = await Promise.all([a.toggle(today(), 'alan'), b.toggle(today(), 'alan')]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal((await api.getDoc(mark())).exists(), false);
});

test('timestamp ties have identical stable ID ordering for every reader', async () => {
  const stamp = api.Timestamp.fromMillis(Date.now() - 1000);
  await seed(today(), 'denis', { createdAt: stamp });
  await seed(today(), 'alan', { createdAt: stamp });
  const store = storeFor(); store.ensureWindow();
  await eventually(() => store.state.connected && store.list(today()).length === 2, 'same timestamps read');
  assert.deepEqual(store.list(today()).map(row => row.id), ['alan', 'denis']);
});
const registryRef = (client=db) => api.doc(client,'team','registry');
async function readyStore(client=db) {
 const store=storeFor(client);store.ensureWindow();
 await eventually(()=>store.state.connected,'registry and marks ready');
 return store;
}
async function rawRegistry() { return (await api.getDoc(registryRef())).data(); }
function candidate(old, name, id='p_'+crypto.randomUUID().replaceAll('-','')) {
 return appendProfile(structuredClone(old),name,id,memberPalette(planner.MEMBERS),()=>0).registry;
}
async function fillTo(store, count) {
 while(store.members.length<count) {
  const n=store.members.length;
  const profile=await store.addMember('Тест '+String.fromCharCode(65+n));
  await eventually(()=>store.members.some(member=>member.id===profile.id),'new member snapshot');
 }
}

test('migration: two clients initialize once, preserving original profiles, colors, ID and marks',async()=>{
 await env.clearFirestore();
 // The already published four-person client still works before migration.
 await assertSucceeds(api.setDoc(mark(today(),'alan'),data(today(),'alan')));
 const before=(await api.getDoc(mark())).data();
 const a=storeFor(),b=storeFor(env.unauthenticatedContext().firestore());
 a.ensureWindow();b.ensureWindow();
 await eventually(()=>a.state.connected&&b.state.connected,'concurrent initialization');
 assert.deepEqual(a.members, initialRegistry(planner.MEMBERS).order.map(id=>initialRegistry(planner.MEMBERS).profiles[id]));
 assert.deepEqual(a.members,b.members);
 assert.deepEqual((await rawRegistry()).order,['alan','denis','anya','dasha']);
 assert.deepEqual((await api.getDoc(mark())).data(),before);
 await eventually(()=>a.list(today()).length===1,'old mark visible');
 assert.equal(a.list(today())[0].id,'alan');
});

test('registry bootstrap permits only exact original four and never overwrites existing data',async()=>{
 await env.clearFirestore();
 const initial=initialRegistry(planner.MEMBERS);
 await denied(api.setDoc(registryRef(),{...initial,version:2}));
 const bad=structuredClone(initial);bad.profiles.alan.color='#000000';await denied(api.setDoc(registryRef(),bad));
 await assertSucceeds(api.setDoc(registryRef(),initial));
 await denied(api.setDoc(registryRef(),initial));
 await denied(api.deleteDoc(registryRef()));
 await denied(api.getDocs(api.collection(db,'team')));
 await denied(api.setDoc(api.doc(db,'profiles','invented'),{name:'Имя'}));
});

test('new member synchronizes between clients, keeps color and order after reload, and can mark immediately',async()=>{
 const a=await readyStore(),b=await readyStore(env.unauthenticatedContext().firestore());
 const created=await a.addMember('  Сергей  ');
 await eventually(()=>a.members.length===5&&b.members.length===5,'both lists updated');
 assert.equal(created.name,'Сергей');assert.equal(created.nameKey,'сергей');
 assert.match(created.id,/^p_[0-9a-f]{32}$/);
 assert.deepEqual(a.members.map(m=>m.id),['alan','denis','anya','dasha',created.id]);
 assert.deepEqual(a.members,b.members);
 assert.equal(new Set(a.members.map(m=>m.color)).size,5);
 const reloaded=await readyStore(env.unauthenticatedContext().firestore());
 assert.deepEqual(reloaded.members,a.members);
 assert.equal(await a.toggle(today(),created.id),true);
 await eventually(()=>b.list(today()).some(mark=>mark.id===created.id),'new mark shared');
 assert.equal(await a.toggle(today(),created.id),false);
 await eventually(()=>!b.list(today()).some(mark=>mark.id===created.id),'new mark removed');
 assert.deepEqual(a.members,b.members);
});

test('case-insensitive names enforced by server, not just UI; empty, long and bad names rejected',async()=>{
 const store=await readyStore();
 await store.addMember('Alice');await eventually(()=>store.members.length===5,'Alice saved');
 await assert.rejects(store.addMember('  ALICE  '),/существует/);
 await assert.rejects(store.addMember(' аНя '),/существует/);
 const old=await rawRegistry();
 for(const name of ['', ' ', 'A'.repeat(25),'<script>', 'Имя1',' leading','trailing ']) {
  const id='p_'+crypto.randomUUID().replaceAll('-','');
  const proposed=candidate(old,'Корректное',id),p=proposed.profiles[id];
  delete proposed.names[p.nameKey];p.name=name;p.nameKey=name ? name.toLowerCase() : 'пусто';proposed.names[p.nameKey]=id;
  await denied(api.setDoc(registryRef(),proposed));
 }
 const id='p_'+crypto.randomUUID().replaceAll('-','');
 const proposed=candidate(old,'Другое',id),p=proposed.profiles[id];
 delete proposed.names[p.nameKey];p.name='aLiCe';p.nameKey='alice';proposed.names.alice=id;
 await denied(api.setDoc(registryRef(),proposed));
 assert.equal((await rawRegistry()).order.length,5);
});

test('extra spaces are canonicalized by the client and raw noncanonical writes are denied',async()=>{
 const store=await readyStore();
 const profile=await store.addMember('  Новое   Имя  ');
 assert.equal(profile.name,'Новое Имя');
 await assert.rejects(store.addMember('нОВОЕ    имя'),/существует/);
 const proposed=candidate(await rawRegistry(),'Новое Другое');
 const id=proposed.order.at(-1), p=proposed.profiles[id];
 delete proposed.names[p.nameKey];
 p.name='Новое  Имя';p.nameKey='новое  имя';proposed.names[p.nameKey]=id;
 await denied(api.setDoc(registryRef(),proposed));
 assert.equal((await rawRegistry()).order.length,5);
});

test('all existing fields, colors, order and IDs are immutable for clients',async()=>{
 const old=await rawRegistry();
 const variants=[];
 for(const field of ['name','nameKey','color','id']) {
  const next=structuredClone(old);next.profiles.alan[field]='changed';variants.push(next);
 }
 const removed=structuredClone(old);delete removed.profiles.alan;variants.push(removed);
 const reordered=structuredClone(old);reordered.order.reverse();variants.push(reordered);
 const extra=structuredClone(old);extra.admin=true;variants.push(extra);
 const reused=candidate(old,'Ещё');reused.profiles.alan.name='Другой';variants.push(reused);
 for(const next of variants) await denied(api.setDoc(registryRef(),next));
 assert.deepEqual(await rawRegistry(),old);
});

test('server enforces palette and unique colors; one request cannot append two profiles',async()=>{
 const old=await rawRegistry();
 const invalid=candidate(old,'Пример');const id=invalid.order.at(-1);
 delete invalid.colors[invalid.profiles[id].color];invalid.profiles[id].color='#000000';invalid.colors['#000000']=id;
 await denied(api.setDoc(registryRef(),invalid));
 const used=candidate(old,'Пример');const uid=used.order.at(-1);
 delete used.colors[used.profiles[uid].color];used.profiles[uid].color=old.profiles.alan.color;used.colors[old.profiles.alan.color]=uid;
 await denied(api.setDoc(registryRef(),used));
 await denied(api.setDoc(registryRef(),candidate(candidate(old,'Первый'),'Второй')));
});

test('5th, 12th, 13th and 19th append; concurrent clients can add only one 20th profile',async()=>{
 const a=await readyStore(),b=await readyStore(env.unauthenticatedContext().firestore());
 for(const size of [5,12,13,19]) {
  await fillTo(a,size);
  await eventually(()=>b.members.length===size,'second client sees '+size);
  assert.deepEqual(a.members,b.members);
 }
 const results=await Promise.allSettled([a.addMember('Последний А'),b.addMember('Последний Б')]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/20 участников/);
 const full=await rawRegistry();assert.equal(full.order.length,20);
 assert.equal(Object.keys(full.profiles).length,20);assert.equal(Object.keys(full.colors).length,20);
 await eventually(()=>a.members.length===20&&b.members.length===20,'both clients see full registry');
 assert.deepEqual(a.members,b.members);
 await assert.rejects(a.addMember('Лишний'),/20 участников/);
});

test('rules independently deny an otherwise valid 21st append even with a free palette color',async()=>{
 const a=await readyStore();await fillTo(a,20);
 const full=await rawRegistry();
 // Simulate an admin-assigned color outside the client palette to leave one free color.
 const profile=full.profiles[full.order.at(-1)];
 delete full.colors[profile.color];profile.color='#000000';full.colors[profile.color]=profile.id;
 await env.withSecurityRulesDisabled(context=>api.setDoc(registryRef(context.firestore()),full));
 const overflow=candidate({...full,order:full.order.slice(0,-1)},'Лишний');
 overflow.order.splice(19,0,profile.id);
 await denied(api.setDoc(registryRef(),overflow));
 assert.deepEqual(await rawRegistry(),full);
});

test('simultaneous additions reserve distinct free palette colors',async()=>{
 const a=await readyStore(),b=await readyStore(env.unauthenticatedContext().firestore());
 const [first,second]=await Promise.all([a.addMember('Первый новый'),b.addMember('Второй новый')]);
 assert.notEqual(first.color,second.color);
 const registry=await rawRegistry();
 assert.equal(registry.order.length,6);
 assert.equal(new Set(Object.values(registry.profiles).map(profile=>profile.color)).size,6);
 for(const profile of [first,second]) assert.equal(registry.colors[profile.color],profile.id);
});

test('simultaneous same-name additions create exactly one profile',async()=>{
 const a=await readyStore(),b=await readyStore(env.unauthenticatedContext().firestore());
 const results=await Promise.allSettled([a.addMember('  Новое имя '),b.addMember('нОвОе ИмЯ')]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((await rawRegistry()).order.length,5);
});

test('administrative deletion hides orphan marks, releases slot/color/name, never reuses ID',async()=>{
 const a=await readyStore();const removed=await a.addMember('Уходящий');
 await eventually(()=>a.members.length===5,'created');await a.toggle(today(),removed.id);
 const old=await rawRegistry();
 await env.withSecurityRulesDisabled(async context=>{
  const next=structuredClone(old);delete next.profiles[removed.id];delete next.names[removed.nameKey];delete next.colors[removed.color];next.order=next.order.filter(id=>id!==removed.id);
  await api.setDoc(registryRef(context.firestore()),next);
 });
 await eventually(()=>a.members.length===4&&a.list(today()).length===0,'profile and mark hidden');
 const current=await rawRegistry();assert.equal(current.usedIds[removed.id],true);
 const reused=candidate({...current,usedIds:{}},'Уходящий',removed.id);
 reused.usedIds={...current.usedIds};
 await denied(api.setDoc(registryRef(),reused));
 const replacement=await a.addMember('Уходящий');
 assert.notEqual(replacement.id,removed.id);
 await eventually(()=>a.members.length===5,'replacement visible');
 assert.equal(a.list(today()).length,0);
 await denied(api.setDoc(mark(today(),removed.id),data(today(),removed.id)));
 await a.toggle(today(),replacement.id);
 await eventually(()=>a.list(today()).length===1,'replacement can mark');
 assert.equal(a.list(today())[0].id,replacement.id);
});

test('20 active participants are fully queried even with more than 20 orphan marks',async()=>{
 const a=await readyStore();await fillTo(a,20);await eventually(()=>a.state.connected,'new query ready');
 await env.withSecurityRulesDisabled(async context=>{
  for(let i=0;i<21;i++) await api.setDoc(api.doc(context.firestore(),'days',today(),'marks','p_'+String(i).padStart(32,'0')),data(today(),'p_'+String(i).padStart(32,'0')));
 });
 for(const member of a.members) await a.toggle(today(),member.id);
 await eventually(()=>a.list(today()).length===20,'all active marks, no orphan consumes query slots');
 assert.deepEqual(new Set(a.list(today()).map(mark=>mark.id)),new Set(a.members.map(member=>member.id)));
});

test('old limit(4) client keeps all original marks after dynamic additions',async()=>{
 const a=await readyStore();const added=await a.addMember('Ёлка');
 for(const member of a.members) await a.toggle(today(),member.id);
 const snapshot=await api.getDocs(marksQuery(today(),4));
 assert.deepEqual(new Set(snapshot.docs.map(doc=>doc.id)),new Set(planner.MEMBERS.map(member=>member.id)));
 assert.equal(a.members.find(member=>member.id===added.id).name,'Ёлка');
 await assert.rejects(a.addMember('ёЛКА'),/уже существует/);
 const longName='А'.repeat(24);const long=await a.addMember(longName);
 assert.equal(long.name,longName);
});
