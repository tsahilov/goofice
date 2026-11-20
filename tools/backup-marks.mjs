// Usage: node tools/backup-marks.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseConfig } from '../firebase-config.mjs';
import '../data.js';

const projectId = 'gooffice-5f6c0';
const database = '(default)';
assert.equal(firebaseConfig.projectId, projectId);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST, 'Unset FIRESTORE_EMULATOR_HOST before a production backup.');
const resource = `projects/${projectId}/databases/${database}/documents`;
const endpoint = `https://firestore.googleapis.com/v1/${resource}`;
const limit = 4; // Compatible with the published four-person rules and newer rules.
const startedAt = new Date();
const { dateId, OFFICE_TIME_ZONE } = globalThis.OfficePlanner;
const today = dateId(startedAt);
const anchor = Date.parse(today + 'T00:00:00Z');
const dates = Array.from({ length: 20 }, (_, i) =>
  new Date(anchor + (i - 6) * 86_400_000).toISOString().slice(0, 10));
const dateResults = [];
const documents = [];
const seen = new Set();
let readTime = null;
let consistencyWarning = null;

async function query(date, cursor, at) {
  const structuredQuery = {
    from: [{ collectionId: 'marks' }],
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    limit,
  };
  if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
  // runQuery uses HTTP POST, but it only reads documents.
  const response = await fetch(`${endpoint}/days/${date}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': firebaseConfig.apiKey },
    body: JSON.stringify(at ? { structuredQuery, readTime: at } : { structuredQuery }),
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.json();
  if (!response.ok) {
    const status = body?.error?.status;
    const code = typeof status === 'string' && /^[A-Z_]+$/.test(status) ? ' ' + status : '';
    throw new Error(`HTTP ${response.status}${code}`);
  }
  assert.ok(Array.isArray(body) && body.length && body.every(row => !row.error), 'Invalid runQuery response');
  assert.ok(body.some(row => typeof row.readTime === 'string'), 'Missing server readTime');
  return body;
}

// Read a server timestamp, then pin every page to it for a consistent backup.
// If the rules reject pinned reads, still save what ordinary reads can recover.
for (const date of dates) {
  const result = { date, status: 'ok', documentCount: 0 };
  let cursor;
  try {
    let firstPage;
    if (!readTime && !consistencyWarning) {
      firstPage = await query(date);
      const candidate = firstPage.findLast(row => typeof row.readTime === 'string').readTime;
      try {
        firstPage = await query(date, undefined, candidate);
        readTime = candidate;
      } catch (error) {
        consistencyWarning = `Could not pin queries to a single snapshot: ${error.message}`;
      }
    }
    do {
      const rows = firstPage ?? await query(date, cursor, readTime);
      firstPage = undefined;
      const page = rows.flatMap(row => row.document ? [row.document] : []);
      assert.ok(page.length <= limit, 'Unexpected page size');
      const prefix = `${resource}/days/${date}/marks/`;
      for (const doc of page) {
        assert.ok(typeof doc.name === 'string' && doc.name.startsWith(prefix), 'Unexpected document path');
        const id = doc.name.slice(prefix.length);
        assert.ok(id && !id.includes('/') && !seen.has(doc.name), 'Invalid or duplicate document path');
        const path = doc.name.slice(resource.length + 1);
        seen.add(doc.name);
        // Keep Firestore's typed JSON values, including Timestamp strings with fractional seconds.
        documents.push({ path, id, ...doc });
        result.documentCount++;
        cursor = doc.name;
      }
      if (page.length < limit) break;
    } while (cursor);
  } catch (error) {
    result.status = 'error';
    result.error = [error.message, error.cause?.code].filter(Boolean).join(' / ');
    console.error(`${date}: ${result.error}`);
  }
  dateResults.push(result);
}

const failedDates = dateResults.filter(row => row.status === 'error').map(row => row.date);
const completeForRange = failedDates.length === 0 && Boolean(readTime);
const backup = {
  format: 'gooffice-marks/firestore-rest-v1',
  projectId, database, timeZone: OFFICE_TIME_ZONE,
  from: dates[0], through: dates.at(-1), startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  readTime, consistencyWarning, completeForRange, failedDates,
  documentCount: documents.length, dateResults, documents,
};
const repo = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const directory = join(dirname(repo), 'gooffice-backup');
await mkdir(directory, { recursive: true });
assert.equal(await realpath(directory), directory, 'Backup directory must not redirect elsewhere');
const output = join(directory, `marks-${startedAt.toISOString().replaceAll(':', '-')}.json`);
const json = JSON.stringify(backup, null, 2) + '\n';
await writeFile(output, json, { flag: 'wx', encoding: 'utf8' });
const verified = await readFile(output, 'utf8');
assert.equal(verified, json);
assert.deepStrictEqual(JSON.parse(verified), backup);
assert.equal(dateResults.reduce((count, date) => count + date.documentCount, 0), documents.length);
console.log(JSON.stringify({ output, from: backup.from, through: backup.through,
  documentCount: documents.length, successfulDates: dates.length - failedDates.length,
  failedDates, readTime, completeForRange, consistencyWarning, jsonVerified: true }));
if (!completeForRange) process.exitCode = 1;
