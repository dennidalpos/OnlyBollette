import { describe, expect, it } from 'vitest';
import { compareDocuments, numeric, parseDocument, type Fields } from './comparisonDocuments';
import { parameterKeys } from './electricity';
import { layoutBill, profileBill, word } from '../tests/fixtures/document-layout';

const entry = (value: string) => ({ value, document: 'prova.pdf', page: 1, confirmed: true });

describe('document comparison', () => {
  it('reads a detached annual badge and technical supply headings without nearby band totals', () => {
    const parsed = parseDocument('luce', 'current', {
      fileName: 'synthetic-badge.pdf',
      readable: true,
      pages: [
        {
          number: 4,
          text: '',
          lines: [
            { words: [word('Caratteristiche tecniche della fornitura', 40, 40)] },
            { words: [word('Tipologia cliente: domestico residente', 40, 100)] },
            { words: [word('Tipologia prezzo: fisso monoraria', 40, 160)] },
            { words: [word('Consumo annuo', 800, 300, 270)] },
            { words: [word('dal 01/01/2025 al 31/12/2025', 800, 340)] },
            { words: [word('3.250', 890, 500, 100)] },
            { words: [word('kWh', 900, 540, 80)] },
            { words: [word('F1 800 kWh', 1300, 500)] },
          ],
        },
      ],
    });
    expect(parsed.fields.residentCurrent.value).toBe('residente');
    expect(parsed.fields.tariffCurrent.value).toBe('monoraria');
    expect(parsed.fields.usageCurrent).toMatchObject({ value: '3.250', page: 4, confirmed: false });
  });
  it('recovers expiry and continuation with provenance without inferring a future term', () => {
    const parsed = parseDocument('luce', 'current', {
      fileName: 'synthetic-terms.pdf',
      readable: true,
      pages: [
        {
          number: 7,
          text: 'Scadenza delle condizioni economiche\n31/12/2025\nLe condizioni continueranno ad applicarsi\nfino alla comunicazione di nuove condizioni.\nLa prosecuzione non indica una nuova data.',
        },
      ],
    });
    expect(parsed.fields.validCurrent).toMatchObject({
      value: '31/12/2025',
      document: 'synthetic-terms.pdf',
      page: 7,
      confirmed: false,
    });
    expect(
      parsed.clauses.some(
        (clause) =>
          clause.kind === 'continuation' &&
          clause.text.includes('comunicazione di nuove condizioni'),
      ),
    ).toBe(true);
    expect(parsed.fields.applicableUntilCurrent).toBeUndefined();
  });

  it('reads the printed end of an economic validity range without extending current terms', () => {
    const parsed = parseDocument('luce', 'current', {
      fileName: 'synthetic-validity.pdf',
      readable: true,
      pages: [{ number: 2, text: '', lines: [
        { words: [word('Validità condizioni economiche: dal 01/01/2025 al 31/12/2025', 40, 100)] },
        { words: [word('Scadenza condizioni economiche', 40, 160)] },
        { words: [word('Le condizioni continuano ad applicarsi fino alla comunicazione', 40, 200)] },
      ] }],
    });
    expect(parsed.fields.validCurrent).toEqual({
      value: '31/12/2025', document: 'synthetic-validity.pdf', page: 2, confirmed: false,
    });
    expect(parsed.fields.applicableFromCurrent).toBeUndefined();
    expect(parsed.fields.applicableUntilCurrent).toBeUndefined();
  });

  it('blocks energy comparison without applicable dates even when a continuation clause exists', () => {
    const fields: Fields = Object.fromEntries(
      Object.entries({
        usageCurrent: '2700',
        usageQuote: '2700',
        annualCurrent: '1000',
        annualQuote: '900',
        priceTypeCurrent: 'fisso',
        priceTypeQuote: 'fisso',
      }).map(([key, value]) => [key, entry(value)]),
    );
    expect(compareDocuments('luce', fields, true, true).difference).toBeNull();
    for (const suffix of ['Current', 'Quote']) {
      fields[`applicableFrom${suffix}`] = entry('01/01/2020');
      fields[`applicableUntil${suffix}`] = entry('31/12/2099');
    }
    fields.validCurrent = entry('31/12/2025');
    expect(compareDocuments('luce', fields, true, true).difference).toBe(100);
    for (const value of ['31/02/2099', '01/01/2026', '']) {
      expect(
        compareDocuments('luce', { ...fields, applicableUntilCurrent: entry(value) }, true, true)
          .difference,
      ).toBeNull();
    }
    expect(
      compareDocuments(
        'luce',
        { ...fields, applicableFromCurrent: entry('01/01/2099') },
        true,
        true,
      ).difference,
    ).toBeNull();
  });
  it('uses supply profile cells and annual totals with their page provenance', () => {
    const parsed = parseDocument('luce', 'current', profileBill);
    for (const [key, value] of Object.entries({
      usageCurrent: '3.120',
      residentCurrent: 'non residente',
      powerCurrent: '4,5',
      tariffCurrent: 'Monoraria',
    })) {
      expect(parsed.fields[key]).toEqual({
        value,
        document: profileBill.fileName,
        page: 3,
        confirmed: false,
      });
    }
  });

  it('leaves conflicting profile values unresolved across pages', () => {
    const parsed = parseDocument('luce', 'current', {
      ...profileBill,
      pages: [
        ...profileBill.pages,
        { number: 4, text: 'Dati della fornitura\nPotenza impegnata 6 kW' },
      ],
    });
    expect(parsed.fields.powerCurrent).toBeUndefined();
    expect(parsed.conflicts).toContain('powerCurrent');
    expect(parsed.fields.residentCurrent.value).toBe('non residente');
  });

  it('rejects profile examples, period usage and annual band values without a total', () => {
    for (const text of [
      'Informazioni generali\nCliente domestico residente\nTariffa monoraria\nConsumo annuo 2.700 kWh\nPotenza impegnata 3 kW',
      'Consumi\nConsumo fatturato 250 kWh\nConsumo annuo\nF1 800 kWh\nF2 600 kWh\nF3 500 kWh',
    ]) {
      const parsed = parseDocument('luce', 'current', {
        fileName: 'synthetic.pdf',
        readable: true,
        pages: [{ number: 1, text }],
      });
      expect(parsed.fields.usageCurrent).toBeUndefined();
      expect(parsed.fields.residentCurrent).toBeUndefined();
      expect(parsed.fields.powerCurrent).toBeUndefined();
      expect(parsed.fields.tariffCurrent).toBeUndefined();
    }
  });
  it('recovers clause lines without mixing adjacent columns or table cells', () => {
    const parsed = parseDocument('luce', 'current', layoutBill);
    expect(parsed.clauses).toHaveLength(1);
    expect(parsed.clauses[0]).toMatchObject({ document: layoutBill.fileName, page: 2 });
    expect(parsed.clauses[0].text).toContain('Recesso con preavviso di trenta giorni.');
    expect(parsed.clauses[0].text).not.toMatch(/Importo|storico|estranee/);
    expect(parsed.fields.unitCurrent).toBeUndefined();
  });

  it('does not attach distant lines to a clause', () => {
    const parsed = parseDocument('luce', 'quote', {
      ...layoutBill,
      pages: [
        {
          ...layoutBill.pages[0],
          lines: [
            { words: [word('Recesso senza penali.', 40, 40)] },
            { words: [word('Unrelated table row', 40, 400)] },
          ],
        },
      ],
    });
    expect(parsed.clauses[0].text).toBe('Recesso senza penali.');
  });
  it('reads Italian thousands and decimal values without multiplying dot decimals', () => {
    expect(numeric(entry('2.700'))).toBe(2700);
    expect(numeric(entry('29.99'))).toBe(29.99);
    expect(numeric(entry('0,1234'))).toBe(0.1234);
    expect(numeric(entry('0.125'))).toBe(0.125);
    expect(numeric(entry('0.150'))).toBe(0.15);
    expect(numeric(entry('1.125'), true)).toBe(1.125);
    expect(numeric(entry('1.234,56'))).toBe(1234.56);
  });
  it('calculates decimal unit prices only after both monorate tariffs are confirmed', () => {
    const now = new Date();
    const parameters = {
      sourceUrl: 'https://example.org/synthetic-parameters.csv',
      fetchedAt: now.toISOString(),
      publishedOn: `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`,
      values: Object.fromEntries(parameterKeys.map((key) => [key, key === 'iva_c' ? 0.1 : 0])),
    };
    const fields = Object.fromEntries(
      Object.entries({
        usageCurrent: '2.700',
        usageQuote: '2700',
        powerCurrent: '3',
        residentCurrent: 'residente',
        priceTypeCurrent: 'fisso',
        priceTypeQuote: 'fisso',
        unitCurrent: '0.150',
        unitQuote: '0.125',
        fixedCurrent: '120',
        fixedQuote: '120',
        lossesCurrent: 'incluse',
        lossesQuote: 'incluse',
        dispatchModeCurrent: 'parametro ufficiale',
        dispatchModeQuote: 'parametro ufficiale',
        commercialModeCurrent: 'parametro ufficiale',
        commercialModeQuote: 'parametro ufficiale',
        applicableFromCurrent: '01/01/2020',
        applicableUntilCurrent: '31/12/2099',
        applicableFromQuote: '01/01/2020',
        applicableUntilQuote: '31/12/2099',
        tariffCurrent: 'monoraria',
        tariffQuote: 'monoraria',
      }).map(([key, value]) => [key, entry(value)]),
    );
    const result = compareDocuments('luce', fields, true, true, parameters);
    expect(result.status).toBe('comparable');
    expect(result.current).toBeCloseTo(577.5);
    expect(result.candidate).toBeCloseTo(503.25);
    expect(result.difference).toBeCloseTo(74.25);
    for (const tariff of ['bioraria', 'multioraria', '']) {
      for (const key of ['tariffCurrent', 'tariffQuote']) {
        const blocked = compareDocuments(
          'luce',
          { ...fields, [key]: entry(tariff) },
          true,
          true,
          parameters,
        );
        expect(blocked.difference).toBeNull();
        expect(blocked.reasons.join(' ')).toContain('monorarie confermate');
      }
    }
    expect(
      compareDocuments(
        'luce',
        {
          ...fields,
          tariffCurrent: { ...entry('monoraria'), confirmed: false },
        },
        true,
        true,
        parameters,
      ).difference,
    ).toBeNull();
    const parsed = parseDocument('luce', 'current', {
      fileName: 'synthetic-bioraria.pdf',
      readable: true,
      pages: [
        {
          number: 1,
          text: 'Tariffa bioraria\nPrezzo fisso\nPrezzo vendita F1 0,30 €/kWh\nPrezzo vendita F23 0,10 €/kWh',
        },
      ],
    });
    expect(parsed.fields.tariffCurrent.value).toBe('bioraria');
    const confirmed = Object.fromEntries(
      Object.entries(parsed.fields).map(([key, value]) => [key, { ...value, confirmed: true }]),
    );
    expect(
      compareDocuments('luce', { ...fields, ...confirmed }, true, true, parameters).difference,
    ).toBeNull();
  });
  it('does not mistake average bill prices or past activation for future contract prices', () => {
    const energy = parseDocument('luce', 'current', {
      fileName: 'bill.pdf',
      readable: true,
      pages: [{ number: 1, text: 'Quota consumi 0,30 €/kWh\nQuota fissa rete 20,00 € /anno' }],
    });
    expect(energy.fields.unitCurrent).toBeUndefined();
    expect(energy.fields.fixedCurrent).toBeUndefined();
    const internet = parseDocument('internet', 'current', {
      fileName: 'invoice.pdf',
      readable: true,
      pages: [{ number: 1, text: 'Attivazione 40,00 €\nSconto per 24 mesi' }],
    });
    expect(internet.fields.activationCurrent).toBeUndefined();
    expect(internet.fields.promoMonthsCurrent).toBeUndefined();
  });
  it('keeps billed totals out of annual energy comparisons', () => {
    const parsed = parseDocument('luce', 'current', {
      fileName: 'bolletta.pdf',
      readable: true,
      pages: [
        {
          number: 2,
          text: 'Consumo annuo 2.700 kWh\nImporto da pagare 210,00 €\nCodice offerta ABCDEFGH123\nRecesso anticipato: onere massimo 50,00 €',
        },
      ],
    });
    expect(parsed.fields.usageCurrent).toMatchObject({
      document: 'bolletta.pdf',
      page: 2,
      value: '2.700',
    });
    expect(parsed.fields.annualCurrent).toBeUndefined();
    expect(parsed.clauses.some((clause) => clause.text.includes('Recesso'))).toBe(true);
    const result = compareDocuments(
      'luce',
      {
        ...parsed.fields,
        usageQuote: entry('2.700'),
        annualQuote: entry('900'),
        priceTypeCurrent: entry('fisso'),
        priceTypeQuote: entry('fisso'),
      },
      true,
      true,
    );
    expect(result.status).not.toBe('comparable');
    expect(result.difference).toBeNull();
  });

  it('allows documented indexed scenarios but blocks conditions ending within the year', () => {
    const fields: Fields = Object.fromEntries(
      Object.entries({
        usageCurrent: '2700',
        usageQuote: '2.700',
        annualCurrent: '1.000,00',
        annualQuote: '900',
        priceTypeCurrent: 'fisso',
        priceTypeQuote: 'indicizzato',
        applicableFromCurrent: '01/01/2020',
        applicableUntilCurrent: '31/12/2099',
        applicableFromQuote: '01/01/2020',
        applicableUntilQuote: '31/12/2099',
      }).map(([key, value]) => [key, entry(value)]),
    );
    const result = compareDocuments('luce', fields, true, true);
    expect(result.difference).toBe(100);
    expect(result.notes.join(' ')).toContain('scenario');
    fields.applicableUntilCurrent = entry('01/01/2026');
    expect(compareDocuments('luce', fields, true, true).difference).toBeNull();
  });

  it('accounts for promotions and device instalments over 12 and 24 months', () => {
    const fields: Fields = Object.fromEntries(
      Object.entries({
        serviceCurrent: 'fibra',
        serviceQuote: 'fibra',
        monthlyCurrent: '30',
        monthlyQuote: '20',
        monthlyAfterQuote: '25',
        promoMonthsCurrent: '0',
        promoMonthsQuote: '6',
        activationCurrent: '0',
        activationQuote: '30',
        deviceCurrent: '0',
        deviceQuote: '5',
        deviceMonthsQuote: '12',
      }).map(([key, value]) => [key, entry(value)]),
    );
    const result = compareDocuments('internet', fields, true, true);
    expect(result).toMatchObject({
      status: 'comparable',
      current: 360,
      candidate: 360,
      difference: 0,
    });
    expect(result.next24).toMatchObject({ current: 720, candidate: 660, difference: 60 });
    delete fields.promoMonthsQuote;
    expect(compareDocuments('internet', fields, true, true).difference).toBeNull();
  });

  it('blocks insurance prices until coverages are checked', () => {
    const fields: Fields = {
      coverageCurrent: entry('RC auto'),
      coverageQuote: entry('RC auto'),
      premiumCurrent: entry('600'),
      premiumQuote: entry('450'),
    };
    expect(compareDocuments('assicurazioni', fields, true, false).difference).toBeNull();
    expect(
      compareDocuments(
        'assicurazioni',
        { ...fields, limitCurrent: entry('6000000'), limitQuote: entry('5000000') },
        true,
        true,
      ).difference,
    ).toBeNull();
    expect(compareDocuments('assicurazioni', fields, true, true).difference).toBe(150);
  });
});
