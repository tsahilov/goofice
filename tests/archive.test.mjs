import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { archiveEntries } from '../archive/entries.mjs';

test('archive dates and static publication resolve under the GitHub Pages prefix', async () => {
  assert.deepEqual(archiveEntries.map(entry => entry.date),
    ['2026-11-17', '2026-11-10', '2026-11-03', '2026-11-02', '2026-10-28']);
  assert.equal(archiveEntries.filter(entry => entry.href).length, 1);
  const server = spawn(process.execPath, ['tools/preview.cjs', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let output = '';
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
      server.on('error', error => { clearTimeout(timer); reject(error); });
      server.on('exit', () => { clearTimeout(timer); reject(new Error('Preview exited')); });
      server.stdout.on('data', bytes => {
        output += bytes;
        const match = /127\.0\.0\.1:(\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const root = `http://127.0.0.1:${port}/goofice/`;
    const home = await fetch(root).then(response => response.text());
    assert.match(home, /id="calendar"[\s\S]*id="archive"/);
    const articleUrl = new URL(archiveEntries[0].href, root);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(articleUrl);
      assert.equal(response.status, 200);
      const article = await response.text();
      assert.match(article, /<article\b/);
      assert.match(article, /<h1>/);
      assert.doesNotMatch(article, /<script\b/);
      for (const [, href] of article.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (href.startsWith('data:')) continue;
        const target = new URL(href, articleUrl);
        assert.ok(target.pathname.startsWith('/goofice/'));
        assert.equal((await fetch(target)).status, 200, target.pathname);
      }
      assert.match(article, /href="\.\.\/\.\.\/#archive"/);
    }
    for (const path of ['archive/entries.mjs', 'archive/list.mjs', 'archive/archive.css']) {
      assert.equal((await fetch(new URL(path, root))).status, 200);
    }
    assert.equal((await fetch(new URL('archive/1999-01-01/', root))).status, 404);
    assert.equal((await fetch(new URL('archive/2026-11-17', root))).url, articleUrl.href);
    await access(new URL('../archive/2026-11-17/cooldesigners-image.png', import.meta.url));
    const image = await readFile(new URL('../archive/2026-11-17/cooldesigners-image.png', import.meta.url));
    assert.equal(image.readUInt32BE(16), 273);
    assert.equal(image.readUInt32BE(20), 273);
  } finally {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
});
