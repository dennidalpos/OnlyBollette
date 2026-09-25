import { test, expect, type Page } from '@playwright/test';
import type { DocumentAnalysis } from '../../src/comparisonDocuments';
import type { SourceResult } from '../../src/types';
import { profileBill } from '../fixtures/document-layout';

interface AuditWindow extends Window {
  auditCalls: string[];
  auditSources: string[];
  auditFailOcr: boolean;
  auditResolveDocument: (document: DocumentAnalysis) => void;
  auditEmit: (completed: number) => void;
  auditEmitResult: (result: SourceResult, done: boolean) => void;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const mock = window as unknown as AuditWindow & Record<string, unknown>;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { name: string; callback: (event: unknown) => void }>();
    let nextId = 1;
    let requestId = '';
    mock.auditCalls = [];
    mock.auditSources = ['Iliad', 'Fastweb'];
    mock.auditFailOcr = false;
    mock.isTauri = true;
    mock.__TAURI_INTERNALS__ = {
      transformCallback(callback: (event: unknown) => void) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        mock.auditCalls.push(command);
        if (command === 'plugin:event|listen') {
          const id = nextId++;
          listeners.set(id, {
            name: String(args.event),
            callback: callbacks.get(Number(args.handler))!,
          });
          return id;
        }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'model_status') return { installed: false, downloading: false, size: 1 };
        if (command === 'source_names') return mock.auditSources;
        if (command === 'plugin:dialog|open') return 'C:\\synthetic.pdf';
        if (command === 'analyze_document') {
          if (mock.auditFailOcr) throw new Error('OCR Windows non disponibile');
          return new Promise<DocumentAnalysis>((resolve) => {
            mock.auditResolveDocument = resolve;
          });
        }
        if (command === 'cached_offers')
          return ['Iliad', 'Fastweb'].map((source, index) => ({
            source,
            url: 'https://example.org',
            fetchedAt: new Date().toISOString(),
            cached: true,
            error: null,
            electricityParameters:
              args.category === 'luce'
                ? {
                    sourceUrl: 'https://example.org/synthetic-parameters.csv',
                    fetchedAt: new Date().toISOString(),
                    publishedOn: '2026-07-01',
                    values: {},
                  }
                : undefined,
            offers:
              args.category === 'internet'
                ? [
                    {
                      id: `offer-${index}`,
                      category: 'internet',
                      subcategory: 'casa',
                      provider: source,
                      name: `Synthetic ${index}`,
                      description: '',
                      url: 'https://example.org',
                      source,
                      sourceUrl: 'https://example.org',
                      fetchedAt: new Date().toISOString(),
                      validUntil: null,
                      priceType: 'advertised',
                      monthlyPrice: index ? 10 : 20,
                      firstYearCost: null,
                      components: [],
                      conditions: [],
                      evidence: 'Synthetic test only',
                      evidenceVersion: 1,
                      restricted: false,
                    },
                  ]
                : [],
          }));
        if (command === 'search_offers') {
          requestId = String(args.requestId);
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    mock.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        listeners.delete(id);
      },
    };
    mock.auditEmit = (completed) => {
      for (let index = 0; index < completed; index++) {
        for (const [id, listener] of listeners) {
          if (listener.name === 'search-update')
            listener.callback({
              id,
              payload: {
                requestId,
                done: false,
                cancelled: false,
                result: {
                  source: `Synthetic ${index}`,
                  url: '',
                  offers: [],
                  fetchedAt: new Date().toISOString(),
                  error: null,
                  cached: false,
                },
              },
            });
        }
      }
    };
    mock.auditEmitResult = (result, done) => {
      for (const [id, listener] of listeners) {
        if (listener.name === 'search-update')
          listener.callback({
            id,
            payload: { requestId, result, done, cancelled: false },
          });
      }
    };
  });
  await page.goto('/');
});

const field = (page: Page, label: string) =>
  page.locator('.document-fields label').filter({ hasText: label }).locator('input');

test('refreshes missing source identities and reports the configured total', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as AuditWindow).auditSources = [
      'Iliad',
      'Fastweb',
      'TIM',
      'Sky Wifi',
      'PosteCasa',
      'EOLO',
      'Tiscali',
      'CoopVoce',
      'Kena',
      'Dimensione',
      'BBBell',
    ];
  });
  await page.locator('.category-card.internet').click();
  const dialog = page.getByRole('dialog', { name: 'Aggiornamento offerte in corso' });
  await expect(dialog).toContainText('Fonti completate: 0 su 11');
  expect(
    await page.evaluate(() =>
      (window as unknown as AuditWindow).auditCalls.filter((call) => call === 'search_offers'),
    ),
  ).toHaveLength(1);
  await page.evaluate(() => (window as unknown as AuditWindow).auditEmit(3));
  await expect(dialog).toContainText('Fonti completate: 3 su 11');
  await expect(page.locator('.results-heading')).toContainText('11 fonti ufficiali');
});

test('newly refreshed offers are immediately acquired before the next clock tick', async ({
  page,
}) => {
  await page.clock.install();
  await page.locator('.category-card.internet').click();
  await expect(page.locator('.offer-card')).toHaveCount(2);
  await page.clock.fastForward(5000);
  await page.getByRole('button', { name: 'Aggiorna offerte' }).click();
  await page.evaluate(async () => {
    const mock = window as unknown as AuditWindow & {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: Record<string, unknown>) => Promise<SourceResult[]>;
      };
    };
    const fresh = await mock.__TAURI_INTERNALS__.invoke('cached_offers', { category: 'internet' });
    mock.auditEmitResult({ ...fresh[0], cached: false }, true);
  });
  await expect(
    page.locator('.offer-card').filter({ hasText: 'Synthetic 0' }).locator('.data-status'),
  ).toHaveText('Acquisito');
});

test('refreshes when cache count matches but a required source is absent', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as AuditWindow).auditSources = ['Iliad', 'TIM'];
  });
  await page.locator('.category-card.internet').click();
  await expect(page.getByRole('dialog', { name: 'Aggiornamento offerte in corso' })).toContainText(
    '0 su 2',
  );
});

test('profile provenance and conflicting pages require review before confirmation', async ({
  page,
}) => {
  await page.locator('.category-card.luce').click();
  await page.locator('.document-comparison summary').click();
  await page.getByRole('button', { name: 'Documento attuale', exact: true }).click();
  await expect(page.getByText('Lettura locale in corso…', { exact: true })).toBeVisible();
  await page.evaluate(
    (document) => (window as unknown as AuditWindow).auditResolveDocument(document),
    {
      ...profileBill,
      pages: [
        ...profileBill.pages,
        { number: 4, text: 'Dati della fornitura\nPotenza impegnata 6 kW' },
      ],
    },
  );
  await expect(field(page, 'Consumo annuo · attuale')).toHaveValue('3.120');
  await expect(field(page, 'Residenza (residente/non residente) · attuale')).toHaveValue(
    'non residente',
  );
  await expect(field(page, 'Potenza impegnata · attuale')).toHaveValue('');
  await expect(
    page.locator('.document-fields label').filter({ hasText: 'Consumo annuo · attuale' }),
  ).toContainText('synthetic-profile.png · pagina 3');
  await expect(page.getByRole('alert')).toContainText('Potenza impegnata');
  await expect(page.getByRole('button', { name: 'Conferma dati', exact: true })).toBeDisabled();
  await field(page, 'Potenza impegnata · attuale').fill('4,5');
  await page.getByLabel('Ho risolto le differenze nei valori riportati.').check();
  await expect(page.getByRole('button', { name: 'Conferma dati', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancella confronto', exact: true }).click();
  await page.getByRole('button', { name: 'Inserisci i dati manualmente' }).click();
  await expect(field(page, 'Consumo annuo · attuale')).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('continuation clauses do not establish twelve-month economic validity', async ({ page }) => {
  await page.locator('.category-card.luce').click();
  await page.locator('.document-comparison summary').click();
  for (const role of ['Documento attuale', 'Nuova proposta']) {
    await page.getByRole('button', { name: role, exact: true }).click();
    await expect(page.getByText('Lettura locale in corso…', { exact: true })).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as AuditWindow).auditResolveDocument({
        fileName: 'synthetic-continuation.pdf',
        readable: true,
        pages: [
          {
            number: 1,
            text: 'Consumo annuo 2700 kWh\nSpesa annua stimata 1000 euro\nPrezzo fisso\nScadenza delle condizioni economiche 31/12/2025\nLe condizioni continueranno ad applicarsi\nfino alla comunicazione di nuove condizioni.',
          },
        ],
      }),
    );
    if (role === 'Documento attuale')
      await page.getByRole('button', { name: 'Aggiungi documento', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Conferma dati', exact: true }).click();
  await page
    .getByLabel('Ho verificato che periodo, componenti e condizioni siano confrontabili.')
    .check();
  await expect(page.locator('.document-panel')).not.toContainText('Differenza prima');
  await expect(page.locator('.document-panel')).toContainText('Carica le condizioni aggiornate');
  await page.getByText('Clausole individuate nei documenti', { exact: true }).click();
  await expect(
    page
      .getByText('La prosecuzione non conferma i prezzi per i prossimi 12 mesi.', { exact: true })
      .first(),
  ).toBeVisible();
});

test('switching proposal clears prior manual values, document values and clauses', async ({
  page,
}) => {
  await page.locator('.category-card.internet').click();
  await page.locator('.document-comparison summary').click();
  expect(await page.evaluate(() => (window as unknown as AuditWindow).auditCalls)).not.toContain(
    'search_offers',
  );
  await page.locator('.document-catalog select').selectOption('offer-0');
  await page.getByRole('button', { name: 'Nuova proposta', exact: true }).click();
  await expect(page.getByText('Lettura locale in corso…', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as AuditWindow).auditResolveDocument({
      fileName: 'old-quote.pdf',
      readable: true,
      pages: [
        { number: 1, text: 'Dal 7° mese 45,00 euro\nRecesso: clausola della vecchia proposta' },
      ],
    }),
  );
  await expect(field(page, 'Canone dopo promozione · proposta')).toHaveValue('45,00');
  await field(page, 'Durata promozione (0 se assente) · proposta').fill('6');
  await field(page, 'Canone mensile · attuale').fill('30');
  await page.getByRole('button', { name: 'Aggiungi documento', exact: true }).click();
  await page.locator('.document-catalog select').selectOption('offer-1');
  await expect(page.locator('.document-panel')).not.toContainText('old-quote.pdf');
  await page.getByRole('button', { name: 'Inserisci i dati manualmente' }).click();
  await expect(field(page, 'Canone mensile · proposta')).toHaveValue('10');
  await expect(field(page, 'Canone dopo promozione · proposta')).toHaveValue('');
  await expect(field(page, 'Durata promozione (0 se assente) · proposta')).toHaveValue('');
  await expect(field(page, 'Canone mensile · attuale')).toHaveValue('30');
  await page.getByRole('button', { name: 'Conferma dati', exact: true }).click();
  await expect(page.locator('.document-panel')).not.toContainText('Clausole individuate');
});

test('clearing an in-flight OCR ignores its late result and keeps the next upload usable', async ({
  page,
}) => {
  await page.locator('.category-card.internet').click();
  await page.locator('.document-comparison summary').click();
  await page.getByRole('button', { name: 'Documento attuale', exact: true }).click();
  await expect(page.getByText('Lettura locale in corso…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancella confronto', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as AuditWindow).auditCalls.filter((call) => call === 'cancel_document')
            .length,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as unknown as AuditWindow).auditResolveDocument({
      fileName: 'cleared.pdf',
      readable: true,
      pages: [{ number: 1, text: 'Canone mensile 30,00 euro' }],
    }),
  );
  await page.getByRole('button', { name: 'Inserisci i dati manualmente' }).click();
  await expect(field(page, 'Canone mensile · attuale')).toHaveValue('');
  await page.getByRole('button', { name: 'Aggiungi documento', exact: true }).click();
  await page.getByRole('button', { name: 'Documento attuale', exact: true }).click();
  await expect(page.getByText('Lettura locale in corso…', { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as AuditWindow).auditResolveDocument({
      fileName: 'new.pdf',
      readable: true,
      pages: [{ number: 1, text: 'Canone mensile 40,00 euro' }],
    }),
  );
  await expect(field(page, 'Canone mensile · attuale')).toHaveValue('40,00');
});

test('manual insurance data can recover from OCR failure with explicit provenance confirmation', async ({
  page,
}) => {
  await page.locator('.category-card.assicurazioni').click();
  await page.locator('.document-comparison summary').click();
  await page.evaluate(() => {
    (window as unknown as AuditWindow).auditFailOcr = true;
  });
  await page.getByRole('button', { name: 'Nuova proposta', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('OCR Windows non disponibile');
  await page.getByRole('button', { name: 'Inserisci i dati manualmente' }).click();
  await field(page, 'Premio annuo · attuale').fill('600');
  await field(page, 'Premio annuo · proposta').fill('400');
  await field(page, 'Garanzia principale · attuale').fill('RC auto');
  await field(page, 'Garanzia principale · proposta').fill('RC auto');
  await page.getByRole('button', { name: 'Conferma dati', exact: true }).click();
  await page.getByRole('checkbox', { name: /Ho verificato che il premio/ }).check();
  await expect(page.locator('.document-panel')).not.toContainText('Differenza prima');
  await page.getByRole('checkbox', { name: /Ho trascritto i dati/ }).check();
  await expect(page.locator('.document-panel [role="status"]')).toHaveText('Confrontabile');
  await expect(page.locator('.component-table')).toContainText('200,00 €');
  await page.getByRole('button', { name: 'Correggi dati', exact: true }).click();
  await field(page, 'Premio annuo · proposta').fill('450');
  await page.getByRole('button', { name: 'Conferma dati', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Ho trascritto i dati/ })).not.toBeChecked();
});
