import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results');
await mkdir(output, { recursive: true });
const scratch = resolve(root, '.scratch');
await mkdir(scratch, { recursive: true });
const dataDirectory = await mkdtemp(resolve(scratch, 'desktop-check-'));
const testModel = process.env.ONLYBOLLETTE_TEST_MODEL;
const requestedCategory = process.argv[3];
const categories = ['Luce', 'Gas', 'Internet', 'Assicurazioni'];
assert.ok(!requestedCategory || categories.includes(requestedCategory), 'Unknown verification category');
let vite;
let app;
let browser;
let failure;
const evidence = { categories: {}, errors: [], startedAt: new Date().toISOString() };
const requestTimings = [];
try {
  if (testModel) {
    await mkdir(resolve(dataDirectory, 'models'));
    await copyFile(resolve(testModel), resolve(dataDirectory, 'models/qwen3.5-2b-q4-k-m.gguf'));
  }
  const reserve = createServer();
  await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
  const port = reserve.address().port;
  await new Promise((done) => reserve.close(done));
  try {
    await fetch('http://127.0.0.1:1420');
  } catch {
    vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
    });
    await waitFor(async () => (await fetch('http://127.0.0.1:1420')).ok, 15000);
  }
  const executable = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(root, 'src-tauri/target/debug/onlybollette.exe');
  app = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ONLYBOLLETTE_DATA_DIR: dataDirectory,
      ONLYBOLLETTE_SOURCE_DIAGNOSTICS: '1',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: resolve(dataDirectory, 'webview'),
    },
  });
  app.stderr.on('data', (chunk) => requestTimings.push(chunk.toString()));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 20000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const applicationPage = () =>
    context
      .pages()
      .find((page) =>
        ['localhost', '127.0.0.1', 'tauri.localhost'].includes(new URL(page.url()).hostname),
      );
  await waitFor(async () => !!applicationPage(), 10000);
  const page = applicationPage();
  evidence.progress = [];
  await page.exposeFunction('recordSourceProgress', (event) => {
    evidence.progress.push({ at: new Date().toISOString(), ...event });
  });
  await page.evaluate(async () => {
    const internals = window.__TAURI_INTERNALS__;
    await internals.invoke('plugin:event|listen', {
      event: 'search-update', target: { kind: 'Any' },
      handler: internals.transformCallback(({ payload }) => window.recordSourceProgress({
        requestId: payload.requestId, done: payload.done, cancelled: payload.cancelled,
        source: payload.result?.source, count: payload.result?.offers.length,
        failed: !!payload.result?.error, partial: payload.result?.partial,
      })),
    });
  });
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  await page.getByRole('heading', { name: 'Da dove vuoi iniziare?' }).waitFor();
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('model_status'));
  assert.equal(
    status.dataDirectory,
    dataDirectory,
    'Executable must support isolated data before any search or download',
  );
  await page.screenshot({ path: resolve(output, 'desktop-home.png') });
  assert.equal(await page.locator('.category-card').count(), 4);
  await page.setViewportSize({ width: 420, height: 600 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Home has no horizontal overflow at 420 px',
  );
  await page.screenshot({ path: resolve(output, 'desktop-home-narrow.png') });
  await page.setViewportSize({ width: 1180, height: 820 });
  for (const category of requestedCategory ? [requestedCategory] : categories) {
    const start = performance.now();
    await page
      .locator('.category-card')
      .filter({ has: page.locator('.category-name', { hasText: new RegExp(`^${category}$`) }) })
      .click();
    await page.locator('.offer-card').first().waitFor({ timeout: 90000 });
    const firstResultMs = Math.round(performance.now() - start);
    await page.getByRole('button', { name: 'Aggiorna offerte' }).waitFor({ timeout: 90000 });
    const refreshStartedAt = Date.now();
    await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
    await page.getByRole('button', { name: 'Aggiorna offerte' }).waitFor({ timeout: 90000 });
    const countText = await page.locator('.list-meta').innerText();
    assert.equal(
      await page.locator('.offer-card .data-status.stale').count(),
      0,
      `${category}: freshly refreshed cards must not be marked stale`,
    );
    const snapshot = await page.evaluate(
      async (category) => window.__TAURI_INTERNALS__.invoke('cached_offers', { category }),
      category.toLowerCase(),
    );
    evidence.categories[category] = {
      firstResultMs,
      countText,
      sources: snapshot.map((s) => ({
        source: s.source,
        count: s.offers.length,
        fetchedAt: s.fetchedAt,
        error: s.error,
        calculationError: s.calculationError,
        partial: s.partial,
      })),
    };
    await writeFile(
      resolve(output, `${category.toLowerCase()}-snapshot.json`),
      JSON.stringify(snapshot, null, 2),
    );
    assert.ok(
      snapshot.some((s) => s.offers.length > 0),
      `${category}: no real offers`,
    );
    assert.equal(
      await page.locator('.source-warning').count(),
      0,
      `${category}: source warning after refresh`,
    );
    const expectedSources = {
      Luce: ['Portale Offerte'],
      Gas: ['Portale Offerte'],
      Internet: [
        'Iliad', 'Fastweb', 'TIM', 'Sky Wifi', 'PosteCasa',
        'EOLO', 'Tiscali', 'CoopVoce', 'Kena', 'Dimensione', 'BBBell', 'BBBell Kiara', 'Enel Fibra',
        'Vodafone', '1Mobile', 'ho.', 'spusu',
      ],
      Assicurazioni: ['Bene', 'Allianz'],
    };
    assert.deepEqual(
      snapshot.map((source) => source.source).sort(),
      expectedSources[category].sort(),
      `${category}: missing or unexpected source`,
    );
    if (category === 'Internet') {
      assert.ok(
        (await page.locator('.results-heading').innerText()).includes(
          `${expectedSources.Internet.length} fonti ufficiali`,
        ),
      );
      const variants = snapshot.find((source) => source.source === 'BBBell').offers;
      assert.equal(variants.length, 6, 'All current BBBell Family variants survive cache loading');
      assert.equal(new Set(variants.map((offer) => offer.id)).size, variants.length);
      assert.ok(variants.every((offer) => offer.firstYearCost === null));
      const kiara = snapshot.find((source) => source.source === 'BBBell Kiara').offers;
      assert.equal(kiara.length, 3);
      assert.ok(kiara.every((offer) => offer.monthlyPrice === null && offer.firstYearCost === null));
      const enel = snapshot.find((source) => source.source === 'Enel Fibra').offers;
      assert.equal(enel.length, 6);
      assert.ok(enel.every((offer) => offer.monthlyPrice > 0 && offer.firstYearCost === null));
      const vodafone = snapshot.find((source) => source.source === 'Vodafone').offers;
      assert.equal(vodafone.length, 2);
      assert.ok(vodafone.every((offer) => offer.monthlyPrice > 0 && offer.firstYearCost === null));
      const unomobile = snapshot.find((source) => source.source === '1Mobile').offers;
      assert.equal(unomobile.length, 1);
      assert.ok(unomobile[0].monthlyPrice > 0);
      assert.equal(unomobile[0].firstYearCost, null);
      const ho = snapshot.find((source) => source.source === 'ho.').offers;
      assert.equal(ho.length, 2);
      assert.deepEqual(ho.map((offer) => offer.monthlyPrice).sort((a, b) => a - b), [12.95, 14.95]);
      assert.ok(ho.every((offer) => offer.firstYearCost === null));
      const spusu = snapshot.find((source) => source.source === 'spusu').offers;
      assert.equal(spusu.length, 3);
      assert.deepEqual(spusu.map((offer) => offer.monthlyPrice).sort((a, b) => a - b), [3.98, 5.98, 7.89]);
      assert.ok(spusu.every((offer) => offer.firstYearCost === null));
    }
    for (const source of snapshot) {
      assert.equal(source.error, null, `${source.source}: failed refresh`);
      assert.equal(
        source.calculationError,
        null,
        `${source.source}: failed calculation parameters`,
      );
      assert.equal(source.partial, false, `${source.source}: incomplete catalog`);
      assert.ok(source.offers.length > 0, `${source.source}: empty source`);
      assert.ok(
        Date.parse(source.fetchedAt) >= refreshStartedAt,
        `${source.source}: previous snapshot used`,
      );
      assert.ok(
        source.offers.every((o) => o.evidenceVersion === 1),
        `${source.source}: legacy evidence`,
      );
    }
    if (category === 'Assicurazioni')
      assert.ok(
        snapshot
          .flatMap((s) => s.offers)
          .every(
            (o) =>
              !o.url.includes('/investimento/') &&
              !o.url.includes('/previdenza/') &&
              !o.url.includes('/impresa/'),
          ),
        'Cached insurance remains within household scope',
      );
    await page.screenshot({ path: resolve(output, `desktop-${category.toLowerCase()}.png`) });
    await page.getByRole('button', { name: 'Dettagli', exact: true }).first().click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes('Vai al sito ufficiale'));
    await page.getByRole('button', { name: 'Chiudi dettagli' }).click();
    if (category === 'Luce') {
      const parameters = snapshot.find((s) => s.electricityParameters)?.electricityParameters;
      assert.ok(parameters, 'Live official electricity parameters');
      await page.locator('.electricity-comparison summary').click();
      await page.getByLabel('Consumo annuo (kWh)').fill('2700');
      await page.getByRole('button', { name: 'Confronta costi annui', exact: true }).click();
      const readAnnual = async () =>
        (await page.locator('.offer-price > strong').allTextContents()).map((s) =>
          Number(
            s
              .replace(/\./g, '')
              .replace(',', '.')
              .replace(/[^\d.]/g, ''),
          ),
        );
      const prices = await readAnnual();
      assert.ok(prices.length > 0 && prices.every(Number.isFinite));
      assert.deepEqual(
        prices,
        [...prices].sort((a, b) => a - b),
      );
      const firstName = await page.locator('.offer-card h2').first().innerText();
      const firstProvider = (
        await page.locator('.offer-card .provider-name').first().textContent()
      ).trim();
      const candidate = snapshot
        .flatMap((s) => s.offers)
        .find(
          (o) =>
            o.name === firstName &&
            o.provider === firstProvider &&
            o.electricityRates?.mono !== null &&
            o.electricityRates,
        );
      assert.ok(candidate, 'Ranked offer is backed by parsed PLACET data');
      const p = parameters.values;
      // Bill reconstruction: 2,700 kWh, resident, 3 kW.
      const energy = candidate.electricityRates.annualFee + 2700 * candidate.electricityRates.mono;
      const regulated =
        p.dispbt_d +
        2700 * p.cdispd +
        p.sigma1 +
        3 * p.sigma2 +
        2700 * p.sigma3 +
        2700 * p.uc3 +
        2700 * p.uc6p_d +
        3 * p.uc6s_d +
        2700 * p.asos_dr +
        2700 * p.arim_dr;
      const expected = (energy + regulated + 960 * p.acc_c_r_l) * (1 + p.iva_c);
      assert.ok(
        Math.abs(prices[0] - expected) < 0.0051,
        'Displayed total matches independent calculation',
      );
      evidence.electricityComparison = {
        countText: await page.locator('.list-meta').innerText(),
        firstOfferId: candidate.id,
        annualTotal: prices[0],
        expected,
        parametersDate: parameters.publishedOn,
      };
      await page.screenshot({
        path: resolve(output, 'desktop-electricity-comparison.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Dettagli', exact: true }).first().click();
      assert.ok((await page.locator('.estimate-details').innerText()).includes('Accisa'));
      await page.screenshot({ path: resolve(output, 'desktop-electricity-breakdown.png') });
      await page.getByRole('button', { name: 'Chiudi dettagli' }).click();
      await page.getByLabel('Tariffa', { exact: true }).selectOption('bio');
      await page.getByRole('button', { name: 'Confronta costi annui', exact: true }).click();
      const bioPrices = await readAnnual();
      assert.ok(bioPrices.length > 0);
      assert.deepEqual(
        bioPrices,
        [...bioPrices].sort((a, b) => a - b),
      );
      await page.setViewportSize({ width: 720, height: 600 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Comparison has no horizontal overflow',
      );
      await page.screenshot({ path: resolve(output, 'desktop-electricity-narrow.png') });
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.getByRole('button', { name: 'Torna a tutte le offerte', exact: true }).click();
      assert.equal(
        await page.locator('.offer-price > strong').filter({ hasText: '/ anno' }).count(),
        0,
      );
    }
    if (category === 'Internet') {
      await page.getByLabel('Prezzo minimo').fill('20');
      await page.getByLabel('Prezzo massimo').fill('30');
      assert.ok((await page.locator('.offer-card').count()) > 0);
      await page.getByRole('button', { name: /Cancella filtri/ }).click();
      await page.getByRole('button', { name: 'Mobile', exact: true }).click();
      await page.getByLabel('Ordina offerte').selectOption('monthly');
      assert.ok((await page.locator('.offer-card').count()) > 0);
      await page.locator('.filters .multi-filter > summary').click();
      await page.getByRole('checkbox', { name: 'Iliad', exact: true }).check();
      await page.getByRole('button', { name: 'Dettagli', exact: true }).first().click();
      const aiButton = page.getByRole('button', { name: 'Evidenzia i punti chiave' });
      if (await aiButton.isVisible()) {
        const aiStart = performance.now();
        await aiButton.click();
        await page.locator('.ai-panel li').first().waitFor({ timeout: 120000 });
        evidence.ai = {
          elapsedMs: Math.round(performance.now() - aiStart),
          quoteCount: await page.locator('.ai-panel li').count(),
        };
        await page.screenshot({ path: resolve(output, 'desktop-ai.png') });
      } else {
        assert.ok(!testModel, 'Requested AI verification must run');
        evidence.ai = {
          status: 'not-run',
          reason: 'Set ONLYBOLLETTE_TEST_MODEL to test inference on an isolated copy.',
        };
      }
      await page.getByRole('button', { name: 'Chiudi dettagli' }).click();
    }
    if (category === 'Assicurazioni') {
      await page.getByRole('button', { name: 'Animali', exact: true }).click();
      assert.ok((await page.locator('.offer-card').count()) > 0, 'Animal insurance filter');
    }
    await page.getByRole('button', { name: 'Tutte le categorie' }).click();
  }
  if (!requestedCategory) {
    // Category isolation check on cancellation.
    await page.locator('.category-card.luce').click();
    await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
    await page.getByRole('button', { name: 'Interrompi' }).click();
    await page.getByRole('button', { name: 'Aggiorna offerte' }).waitFor();
    await page.getByRole('button', { name: 'Tutte le categorie' }).click();
    await page.locator('.category-card.gas').click();
    await page.getByRole('heading', { name: 'Offerte gas' }).waitFor();
    await page.locator('.offer-card').first().waitFor();
    assert.equal(await page.locator('.electricity-comparison').count(), 0);
    await page.getByRole('button', { name: 'Tutte le categorie' }).click();
  }
  assert.deepEqual(evidence.errors, []);
  await writeFile(resolve(output, 'desktop-verification.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.failure = String(error);
  if (browser) {
    evidence.pages = await Promise.allSettled(
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .map(async (page) => ({
          url: page.url(),
          title: await page.title(),
          text: (await page.locator('body').innerText()).slice(0, 1500),
        })),
    );
  }
  await writeFile(resolve(output, 'desktop-verification.json'), JSON.stringify(evidence, null, 2));
  failure = error;
} finally {
  await writeFile(resolve(output, 'desktop-source-timings.log'), requestTimings.join(''));
  let cleanupError;
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
    if (browser) await browser.close();
    if (vite) vite.kill();
    assert.equal(
      dirname(dataDirectory),
      scratch,
      'Cleanup must remain inside the workspace scratch directory',
    );
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    cleanupError = error;
  }
  if (cleanupError) {
    if (failure) console.error('Cleanup also failed:', cleanupError);
    else failure = cleanupError;
  }
}
if (failure) throw failure;

async function waitFor(predicate, timeout) {
  const start = performance.now();
  let error;
  while (performance.now() - start < timeout) {
    try {
      if (await predicate()) return;
    } catch (e) {
      error = e;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw error ?? new Error('Timed out waiting for application');
}
