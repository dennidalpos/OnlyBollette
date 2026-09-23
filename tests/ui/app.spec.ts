import { test, expect } from '@playwright/test';

test('four categories, responsive layout, no account gate', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Da dove vuoi iniziare?' })).toBeVisible();
  await expect(page.locator('.category-card')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await page.setViewportSize({ width: 720, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: /Assicurazioni Auto/ })).toBeVisible();
  await page.setViewportSize({ width: 420, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('browser preview does not present fictitious offers', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Luce Prezzo fisso · Indicizzato' }).click();
  await expect(page.getByRole('alert')).toContainText('ricerca è disponibile nell’app Windows');
  await expect(page.locator('.offer-card')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('results.png'), fullPage: true });
  await page.locator('.electricity-comparison summary').click();
  await expect(page.getByRole('button', { name: 'Confronta costi annui' })).toBeDisabled();
  await expect(page.locator('.electricity-comparison')).toContainText('Aggiorna le offerte');
  await page.getByRole('button', { name: 'Tutte le categorie' }).click();
  await expect(page.locator('.category-card')).toHaveCount(4);
});

test('energy filters allow multiple choices and explain their limits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Luce Prezzo fisso · Indicizzato' }).click();
  await page.locator('.multi-filter summary', { hasText: 'Tipo prezzo' }).click();
  await page.getByRole('checkbox', { name: 'Fisso', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Indicizzato' }).check();
  await expect(page.getByRole('button', { name: 'Cancella filtri (2)' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancella filtri (2)' }).click();
  await page.locator('.multi-filter summary', { hasText: 'Tipo prezzo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Fisso', exact: true })).not.toBeChecked();
  await page.locator('.results-guide summary').click();
  await expect(page.locator('.results-guide')).toContainText('Durata prezzo');
  await page.setViewportSize({ width: 420, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const width of [320, 420, 720, 1024]) {
    await page.setViewportSize({ width, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const filter of await page.locator('.contract-filters .multi-filter').all()) {
      await filter.locator('summary').click();
      const rect = await filter.locator('.multi-filter-menu').boundingBox();
      expect(rect).not.toBeNull();
      const label = await filter.locator('summary').innerText();
      expect(rect!.x, `${width}px ${label}`).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width, `${width}px ${label}`).toBeLessThanOrEqual(width + 1);
      await filter.locator('summary').click();
    }
  }
});

test('price range shows comparable units and validates bounds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Internet Casa · FWA · Mobile' }).click();
  await expect(page.getByRole('textbox', { name: 'Prezzo minimo' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Prezzo minimo' }).fill('20');
  await page.getByRole('textbox', { name: 'Prezzo massimo' }).fill('10');
  await expect(page.locator('.price-filter-error')).toContainText('minimo');
  await page.getByRole('textbox', { name: 'Prezzo massimo' }).fill('30');
  await expect(page.locator('.price-filter-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancella filtri (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancella filtri (1)' }).click();
  await expect(page.getByRole('textbox', { name: 'Prezzo minimo' })).toHaveValue('');
  await page.getByRole('button', { name: 'Tutte le categorie' }).click();
  await page.getByRole('button', { name: 'Gas Prezzo fisso · Indicizzato' }).click();
  await expect(page.getByRole('textbox', { name: 'Prezzo minimo' })).toBeDisabled();
  await expect(page.locator('.price-filter-note')).toContainText('Portale Offerte');
});

test('mock native refresh blocks interaction until completion or cancellation is confirmed', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { name: string; callback: (event: unknown) => void }>();
    let nextId = 1;
    let requestId = '';
    let failNextSearch = false;
    const mock = window as unknown as Record<string, unknown>;
    mock.isTauri = true;
    mock.__TAURI_INTERNALS__ = {
      transformCallback(callback: (event: unknown) => void) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        if (command === 'plugin:event|listen') {
          const id = nextId++;
          listeners.set(id, {
            name: String(args.event),
            callback: callbacks.get(Number(args.handler))!,
          });
          return id;
        }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'model_status')
          return { installed: false, downloading: false, size: 1396198496 };
        if (command === 'cached_offers') return [];
        if (command === 'provider_directory')
          return {
            providers: [
              { id: '1', name: 'Venditore Uno', website: 'https://example.org/' },
              { id: '2', name: 'Venditore Due', website: null },
            ],
            sourceUrl: 'https://www.arera.it/area-operatori/ricerca-operatori',
            fetchedAt: new Date().toISOString(),
            note: 'Venditori nel registro ARERA.',
          };
        if (command === 'search_offers') {
          requestId = String(args.requestId);
          if (failNextSearch) {
            failNextSearch = false;
            throw new Error('Ricerca non disponibile');
          }
          return;
        }
        if (command === 'cancel_search') return;
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    mock.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        listeners.delete(id);
      },
    };
    mock.__testSearch = {
      failNext() {
        failNextSearch = true;
      },
      emit(result: unknown, done: boolean, cancelled = false) {
        for (const [id, listener] of listeners) {
          if (listener.name === 'search-update') {
            listener.callback({ id, payload: { requestId, result, done, cancelled } });
          }
        }
      },
    };
  });
  const emit = (result: unknown, done: boolean, cancelled = false) =>
    page.evaluate(
      ({ result, done, cancelled }) => {
        const mock = window as unknown as {
          __testSearch: { emit: (result: unknown, done: boolean, cancelled: boolean) => void };
        };
        mock.__testSearch.emit(result, done, cancelled);
      },
      { result, done, cancelled },
    );

  await page.goto('/');
  await page.getByRole('button', { name: 'Luce Prezzo fisso · Indicizzato' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aggiornamento offerte in corso' });
  await expect(dialog).toBeVisible();
  expect(await page.locator('.app-shell').evaluate((element) => element.inert)).toBe(true);
  await page.setViewportSize({ width: 420, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('refresh-blocking.png') });
  await emit(
    {
      source: 'Portale Offerte',
      url: '',
      offers: [],
      fetchedAt: new Date().toISOString(),
      error: null,
      cached: false,
    },
    false,
  );
  await expect(dialog).toContainText('Fonti completate: 1 su 1');
  await expect(dialog).toBeVisible();
  await emit(null, true);
  await expect(dialog).toHaveCount(0);
  expect(await page.locator('.app-shell').evaluate((element) => element.inert)).toBe(false);
  await page.locator('.provider-directory summary').click();
  await expect(page.locator('.provider-directory li')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Cerca operatore' }).fill('Due');
  await expect(page.locator('.provider-directory li')).toHaveCount(1);
  await expect(page.locator('.provider-directory li')).toContainText('Venditore Due');

  await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Interrompi' }).click();
  await expect(dialog).toContainText('Interruzione in corso');
  await expect(dialog).toBeVisible();
  await emit(null, true, true);
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => {
    const mock = window as unknown as { __testSearch: { failNext: () => void } };
    mock.__testSearch.failNext();
  });
  await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Ricerca non disponibile');
});

test('AI setup is accessible and describes the download', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'AI locale' }).click();
  await expect(page.getByRole('dialog')).toContainText('1,4 GB');
  await expect(page.getByRole('button', { name: 'Scarica e attiva AI' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ai-settings.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('theme choice is saved across reloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Attiva tema chiaro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Attiva tema scuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
