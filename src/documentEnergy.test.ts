import { describe, expect, it } from 'vitest';
import { parseDocument, compareDocuments, type Fields } from './comparisonDocuments';
import { parameterKeys } from './electricity';
import { word } from '../tests/fixtures/document-layout';

const componentDocument = (monthly = true) => ({
  fileName: 'synthetic-components.pdf',
  readable: true,
  pages: [
    {
      number: 5,
      text: '',
      lines: [
        { words: [word('Dettaglio componenti vendita', 40, 40)] },
        {
          words: [
            word('Voce', 40, 80),
            word('Periodo', 500, 80),
            word('Unità', 900, 80),
            word('Prezzo unitario', 1100, 80),
            word('Importo', 1400, 80),
          ],
        },
        ...[
          ['Componente energia', 'euro/kWh', '0,123456', '12,35'],
          [
            'Quota fissa vendita',
            monthly ? 'euro/mese' : 'euro/anno',
            monthly ? '10' : '120',
            '10',
          ],
          ['Dispacciamento', 'euro/kWh', '0,015', '1,50'],
          ['DISPbt', 'euro/anno', '6', '0,50'],
        ].map(([label, unit, price, total], index) => ({
          words: [
            word(label, 40, 120 + index * 40),
            word('01/01/2026 - 31/01/2026', 500, 120 + index * 40),
            word(unit, 900, 120 + index * 40),
            word(price, 1100, 120 + index * 40),
            word(total, 1400, 120 + index * 40),
          ],
        })),
        { words: [word('Prezzo energia: perdite escluse; perdite di rete 10%', 40, 340)] },
        { words: [word('Spesa annua sostenuta 999 euro', 40, 400)] },
      ],
    },
  ],
});

const entry = (value: string) => ({ value, document: 'synthetic.pdf', page: 1, confirmed: true });
const parameters = () => {
  const now = new Date();
  return {
    sourceUrl: 'https://example.org/synthetic.csv',
    fetchedAt: now.toISOString(),
    publishedOn: `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`,
    values: {
      ...Object.fromEntries(parameterKeys.map((key) => [key, 0])),
      cdispd: 0.02,
      dispbt_d: 8,
      iva_c: 0.1,
    },
  };
};
const base = (): Fields =>
  Object.fromEntries(
    Object.entries({
      usageCurrent: '1000',
      usageQuote: '1000',
      powerCurrent: '3',
      residentCurrent: 'residente',
      tariffCurrent: 'monoraria',
      tariffQuote: 'monoraria',
      priceTypeCurrent: 'fisso',
      priceTypeQuote: 'fisso',
      unitCurrent: '0,12',
      unitQuote: '0,132',
      fixedCurrent: '120',
      fixedQuote: '120',
      lossesCurrent: 'escluse',
      lossesQuote: 'incluse',
      lossPercentCurrent: '10',
      dispatchModeCurrent: 'separato',
      dispatchModeQuote: 'incluso',
      dispatchUnitCurrent: '0,015',
      commercialModeCurrent: 'separata',
      commercialModeQuote: 'inclusa',
      commercialAnnualCurrent: '6',
      applicableFromCurrent: '01/01/2020',
      applicableUntilCurrent: '31/12/2099',
      applicableFromQuote: '01/01/2020',
      applicableUntilQuote: '31/12/2099',
    }).map(([key, value]) => [key, entry(value)]),
  );

describe('document energy components', () => {
  it('reads unit-price table cells, periods and monthly fees without using line totals', () => {
    const parsed = parseDocument('luce', 'current', componentDocument());
    expect(parsed.fields.unitCurrent).toMatchObject({
      value: '0,123456',
      page: 5,
      document: 'synthetic-components.pdf',
      period: '01/01/2026 - 31/01/2026',
      confirmed: false,
    });
    expect(parsed.fields.fixedCurrent.value).toBe('120');
    expect(parsed.fields.dispatchUnitCurrent.value).toBe('0,015');
    expect(parsed.fields.commercialAnnualCurrent.value).toBe('6');
    expect(parsed.fields.lossesCurrent.value).toBe('escluse');
    expect(parsed.fields.lossPercentCurrent.value).toBe('10');
    expect(parsed.fields.annualCurrent).toBeUndefined();
    expect(
      parseDocument('luce', 'current', componentDocument(false)).fields.fixedCurrent.value,
    ).toBe('120');
  });

  it('applies losses once and replaces regulated dispatch and commercial charges with documented ones', () => {
    const result = compareDocuments('luce', base(), true, true, parameters());
    expect(result.current).toBeCloseTo((132 + 120 + 15 + 6) * 1.1);
    expect(result.candidate).toBeCloseTo((132 + 120) * 1.1);
    expect(result.electricityBreakdown?.current.dispatch).toBe(15);
    expect(result.electricityBreakdown?.current.commercial).toBe(6);
    expect(result.electricityBreakdown?.candidate.dispatch).toBe(0);
    expect(result.electricityBreakdown?.candidate.commercial).toBe(0);
  });

  it('blocks differences for absent or ambiguous component inclusion rules', () => {
    for (const key of [
      'lossesCurrent',
      'lossPercentCurrent',
      'dispatchModeCurrent',
      'dispatchUnitCurrent',
      'commercialModeQuote',
    ]) {
      const fields = base();
      delete fields[key];
      expect(compareDocuments('luce', fields, true, true, parameters()).difference, key).toBeNull();
    }
    const fields = base();
    fields.dispatchModeCurrent = entry('non noto');
    expect(compareDocuments('luce', fields, true, true, parameters()).difference).toBeNull();
  });

  it('does not extract a table with no unit-price header or assume missing charges are zero', () => {
    const doc = componentDocument();
    doc.pages[0].lines[1].words = doc.pages[0].lines[1].words.filter(
      (item) => item.text !== 'Prezzo unitario',
    );
    const parsed = parseDocument('luce', 'current', doc);
    expect(parsed.fields.unitCurrent).toBeUndefined();
    expect(parsed.fields.fixedCurrent).toBeUndefined();
    expect(parsed.fields.dispatchUnitCurrent).toBeUndefined();
  });

  it('keeps OCR letters and conflicting table prices unresolved', () => {
    const doc = componentDocument();
    doc.pages[0].lines[2].words[3].text = 'o, 123456';
    expect(parseDocument('luce', 'current', doc).fields.unitCurrent).toBeUndefined();
    expect(
      parseDocument('luce', 'current', {
        ...doc,
        pages: [{ number: 1, text: 'Componente energia o,123456 euro/kWh' }],
      }).fields.unitCurrent,
    ).toBeUndefined();
    const other = componentDocument();
    other.pages[0].lines[2].words[3].text = '0,15';
    const conflicting = parseDocument('luce', 'current', {
      ...doc,
      pages: [...componentDocument().pages, { ...other.pages[0], number: 6 }],
    });
    expect(conflicting.fields.unitCurrent).toBeUndefined();
    expect(conflicting.conflicts).toContain('unitCurrent');
  });
});
