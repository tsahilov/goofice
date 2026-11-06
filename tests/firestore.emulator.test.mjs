import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import * as api from 'firebase/firestore';
import { createCloudStore } from '../cloud-store.mjs';
import '../data.js';

// A missing/misconfigured emulator must never fall back to production.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Run npm run test:rules, never against a real project');
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
const marksQuery = (date = today(), count = 4) => api.query(api.collection(db, 'days', date, 'marks'), api.limit(count));
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
    host: '127.0.0.1', port: 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  db = env.unauthenticatedContext().firestore();
});
beforeEach(async () => { await env.clearFirestore(); });
afterEach(() => { stores.splice(0).forEach(store => store.destroy()); });
after(async () => { await env?.cleanup(); });

test('list: limit(4) and onSnapshot allowed; no limit and limit(5) denied', async () => {
  await assertSucceeds(api.getDocs(marksQuery()));
  await denied(api.getDocs(api.collection(db, 'days', today(), 'marks')));
  await denied(api.getDocs(marksQuery(today(), 5)));
  await new Promise((resolve, reject) => {
    const stop = api.onSnapshot(marksQuery(), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache) { stop(); resolve(); }
    }, reject);
  });
  for (const invalid of [api.collection(db, 'days', today(), 'marks'), marksQuery(today(), 5)]) {
    await denied(new Promise((resolve, reject) => {
      const stop = api.onSnapshot(invalid, snapshot => {
        if (!snapshot.metadata.fromCache) { stop(); resolve(snapshot); }
      }, error => { stop(); reject(error); });
    }));
  }
});

test('all 14 actual cloud-store subscriptions satisfy allow list with limit(4)', async () => {
  // Four records in every day distinguish limit(4) from a smaller allowed limit.
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
