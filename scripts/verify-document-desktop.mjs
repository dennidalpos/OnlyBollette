import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const scratch = resolve(root, '.scratch');
const fixture = resolve(process.argv[2] ?? '');
const marker = process.argv[3];
assert.ok(process.argv[2] && marker, 'Pass fixture path and expected text');
assert.ok(existsSync(fixture), 'Fixture does not exist');
await mkdir(scratch, { recursive: true });
const dataDirectory = await mkdtemp(resolve(scratch, 'document-check-'));
let app;
let browser;
let failure;

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch {
      /* WebView starting. */
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for the native application');
}

try {
  const reserve = createServer();
  await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
  const port = reserve.address().port;
  await new Promise((done) => reserve.close(done));
  const executable = resolve(
    process.argv[4] ?? resolve(root, 'src-tauri/target/release/onlybollette.exe'),
  );
  app = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ONLYBOLLETTE_DATA_DIR: dataDirectory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: resolve(dataDirectory, 'webview'),
    },
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 20000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = () =>
    context
      .pages()
      .find((item) =>
        ['localhost', '127.0.0.1', 'tauri.localhost'].includes(new URL(item.url()).hostname),
      );
  await waitFor(() => !!page(), 10000);
  const current = page();
  await current.getByRole('heading', { name: 'Da dove vuoi iniziare?' }).waitFor();
  const status = await current.evaluate(() => window.__TAURI_INTERNALS__.invoke('model_status'));
  assert.equal(status.dataDirectory, dataDirectory, 'App must use the isolated data directory');
  const analysis = await current.evaluate(
    (path) =>
      window.__TAURI_INTERNALS__.invoke('analyze_document', {
        path,
        requestId: crypto.randomUUID(),
      }),
    fixture,
  );
  assert.equal(analysis.readable, true);
  assert.ok(
    analysis.pages.some((item) => item.text.includes(marker)),
    'Marker was not recognized',
  );
  assert.equal(
    existsSync(resolve(dataDirectory, 'offers.sqlite')),
    false,
    'Personal text must not create an offer database',
  );
  assert.equal(
    existsSync(resolve(dataDirectory, 'models')),
    false,
    'OCR must not download an AI model',
  );
  console.log(`Native document IPC passed: ${analysis.pages.length} page(s), no offer database`);
} catch (error) {
  failure = error;
} finally {
  let cleanupFailure;
  try {
    if (app?.exitCode === null) {
      await new Promise((done) => {
        const closer = spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        closer.on('exit', done);
        closer.on('error', done);
      });
    }
  } catch (error) {
    cleanupFailure = error;
  }
  try {
    if (browser) await browser.close();
  } catch (error) {
    cleanupFailure ??= error;
  }
  try {
    assert.equal(dirname(dataDirectory), scratch, 'Cleanup must stay inside the workspace');
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    cleanupFailure ??= error;
  }
  if (cleanupFailure) {
    if (failure) console.error('Cleanup also failed:', cleanupFailure);
    else failure = cleanupFailure;
  }
}
if (failure) throw failure;
