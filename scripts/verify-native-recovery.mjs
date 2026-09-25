import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { createServer, connect } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const scratch = resolve(root, '.scratch');
await mkdir(scratch, { recursive: true });
await mkdir(resolve(root, 'test-results'), { recursive: true });
const data = await mkdtemp(resolve(scratch, 'recovery-check-'));
const executable = resolve(process.argv[2] ?? 'src-tauri/target/release/onlybollette.exe');
const hosts = new Set(['www.iliad.it', 'www.fastweb.it', 'www.tim.it', 'www.sky.it', 'www.poste.it',
  'www.eolo.it', 'abbonati.tiscali.it', 'www.coopvoce.it', 'www.kenamobile.it', 'www.dimensione.com',
  'www.bbbell.it', 'www.enel.it']);
let mode = 'online';
let interrupted = false;
let kenaBytes = 0;
let app;
let browser;
let failure;
const sockets = new Set();
const evidence = { phases: [], transport: 'local CONNECT relay; original TLS and public responses; no system network changes' };
const proxy = httpServer((request, response) => response.writeHead(405).end());
proxy.on('connect', (request, client, head) => {
  const [host, port] = request.url.split(':');
  if (mode === 'stall' && hosts.has(host) && port === '443') {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    return;
  }
  if (!hosts.has(host) || port !== '443' || mode === 'offline' ||
      (mode === 'partial' && host === 'www.kenamobile.it' && interrupted)) {
    client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    return;
  }
  const upstream = connect({ host, port: 443 });
  for (const socket of [client, upstream]) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  }
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  upstream.on('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on('data', (chunk) => {
    if (mode === 'partial' && host === 'www.kenamobile.it') {
      kenaBytes += chunk.length;
      if (kenaBytes > 5_000_000) {
        interrupted = true;
        upstream.destroy();
        client.destroy();
      }
    }
  });
});
const listen = (server) => new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
async function waitFor(predicate, milliseconds) {
  const started = Date.now();
  while (Date.now() - started < milliseconds) {
    try { if (await predicate()) return; } catch { /* App startup only. */ }
    await delay(200);
  }
  throw Error('Native application startup timed out');
}
try {
  await listen(proxy);
  const reserve = createServer();
  await listen(reserve);
  const cdpPort = reserve.address().port;
  await new Promise((done) => reserve.close(done));
  app = spawn(executable, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
    ...process.env, ONLYBOLLETTE_DATA_DIR: data,
    HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: 'localhost,127.0.0.1',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    WEBVIEW2_USER_DATA_FOLDER: resolve(data, 'webview'),
  } });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 20000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = browser.contexts()[0].pages().find((p) => ['tauri.localhost', 'localhost', '127.0.0.1'].includes(new URL(p.url()).hostname));
  assert.ok(page);
  await page.getByRole('heading', { name: 'Da dove vuoi iniziare?' }).waitFor();
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('model_status'));
  assert.equal(status.dataDirectory, data);
  const cached = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('cached_offers', { category: 'internet' }));
  const finish = () => page.getByRole('button', { name: 'Aggiorna offerte' }).waitFor({ timeout: 90000 });
  const refresh = async () => {
    await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
    await finish();
  };
  const reopen = async () => {
    await page.getByRole('button', { name: 'Tutte le categorie' }).click();
    await page.locator('.category-card.internet').click();
    await finish();
  };
  const changeMode = (next) => {
    mode = next;
    for (const socket of sockets) socket.destroy();
  };
  await page.locator('.category-card.internet').click();
  await finish();
  const original = await cached();
  assert.equal(original.length, 16);
  assert.ok(original.every((s) => !s.error && !s.partial && s.offers.length > 0));
  assert.equal(await page.locator('.source-warning').count(), 0);
  evidence.phases.push('complete live seed');

  changeMode('offline');
  await refresh();
  assert.equal(await page.locator('.source-warning').count(), original.length);
  assert.deepEqual(await cached(), original, 'Failed refresh must retain successful snapshots');
  await reopen();
  assert.equal(await page.locator('.source-warning').count(), 0, 'Failure warnings are session-only');
  assert.deepEqual(await cached(), original);
  evidence.phases.push('process-only network interruption; retained cache; session-only failure warnings');

  changeMode('stall');
  await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
  await page.getByRole('button', { name: 'Interrompi' }).click();
  await finish();
  assert.deepEqual(await cached(), original, 'Cancellation must retain snapshots');
  evidence.phases.push('cancelled native search while transport was unavailable');

  changeMode('partial');
  await refresh();
  assert.ok(interrupted, 'A real source transfer must have been interrupted');
  const partial = (await cached()).find((s) => s.source === 'Kena');
  const previous = original.find((s) => s.source === 'Kena');
  assert.equal(partial.error, null);
  assert.equal(partial.partial, true);
  assert.ok(partial.offers.length > 0 && partial.offers.length < previous.offers.length);
  assert.notEqual(partial.fetchedAt, previous.fetchedAt);
  assert.equal(await page.locator('.source-warning').count(), 1);
  await reopen();
  assert.equal(await page.locator('.source-warning').count(), 1, 'Partial warning must survive reopening');
  assert.deepEqual((await cached()).find((s) => s.source === 'Kena'), partial);
  evidence.phases.push('real Kena transfer interruption; partial snapshot replaced cache; warning persisted');
  evidence.partialOffers = partial.offers.length;

  changeMode('online');
  await refresh();
  const recovered = await cached();
  assert.ok(recovered.every((s) => !s.error && !s.partial && s.offers.length > 0));
  assert.equal(await page.locator('.source-warning').count(), 0);
  assert.equal(recovered.find((s) => s.source === 'Kena').offers.length, previous.offers.length);
  evidence.phases.push('live recovery; complete snapshots; warnings cleared');
} catch (error) {
  failure = error;
  evidence.failure = String(error);
} finally {
  for (const socket of sockets) socket.destroy();
  if (proxy.listening) await new Promise((done) => proxy.close(done));
  if (app?.exitCode === null) await new Promise((done, reject) => {
    const killer = spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', reject);
    killer.on('exit', done);
  });
  if (browser) await browser.close();
  assert.equal(dirname(data), scratch);
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  await writeFile(resolve(root, 'test-results/native-recovery.json'), JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify(evidence, null, 2));
if (failure) throw failure;
