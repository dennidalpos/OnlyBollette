import { describe, expect, it } from 'vitest';
import {
  filterOffers,
  inPriceRange,
  mergeSource,
  offerDuration,
  offerMarket,
  offerTariff,
  priceRangeError,
  sourceStatus,
} from './catalog';
import type { OfferFilters } from './catalog';
import type { Offer, SourceResult } from './types';

const offer = (id: string, price: number | null, end: string | null = null): Offer => ({
  id,
  category: 'internet',
  subcategory: 'mobile',
  provider: 'Test',
  name: id,
  description: '',
  url: 'https://example.org',
  source: 'Test',
  sourceUrl: 'https://example.org',
  fetchedAt: '2026-09-23T12:00:00Z',
  validUntil: end,
  priceType: 'advertised',
  monthlyPrice: price,
  firstYearCost: null,
  components: [],
  conditions: [],
  evidence: '',
  restricted: false,
});
const source = (offers: Offer[]): SourceResult => ({
  source: 'Test',
  url: 'https://example.org',
  offers,
  fetchedAt: '2026-09-23T12:00:00Z',
  error: null,
  cached: false,
});
const filters = (changes: Partial<OfferFilters> = {}): OfferFilters => ({
  query: '',
  subcategory: '',
  priceTypes: [],
  markets: [],
  durations: [],
  tariffs: [],
  activations: [],
  payments: [],
  restrictions: [],
  providers: [],
  sort: 'provider',
  ...changes,
});

describe('catalog integrity', () => {
  it('filters inclusive comparable prices and rejects invalid bounds', () => {
    expect(priceRangeError('9,95', '20')).toBeNull();
    expect(inPriceRange(null, '0', '20')).toBe(false);
    expect(inPriceRange(9.95, '9,95', '20')).toBe(true);
    expect(inPriceRange(20.01, '9,95', '20')).toBe(false);
    expect(priceRangeError('20', '9')).toMatch(/minimo/);
    expect(priceRangeError('9,999', '')).toMatch(/due decimali/);
  });
  it('unknown price sorts after known prices, never as free', () => {
    const results = filterOffers(
      [source([offer('unknown', null), offer('expensive', 20), offer('cheap', 5)])],
      filters({ sort: 'monthly' }),
    );
    expect(results.map((o) => o.id)).toEqual(['cheap', 'expensive', 'unknown']);
  });
  it('removes expired and duplicate offers', () => {
    expect(
      filterOffers(
        [source([offer('expired', 5, '2020-01-01'), offer('valid', 10), offer('valid', 10)])],
        filters({ sort: 'name' }),
      ).map((o) => o.id),
    ).toEqual(['valid']);
  });
  it('keeps previous timestamp and marks cache when source fails', () => {
    const previous = source([offer('saved', 8)]);
    const merged = mergeSource([previous], {
      ...source([]),
      fetchedAt: '2099-01-01T12:00:00Z',
      error: 'HTTP 403',
    });
    expect(merged[0].offers).toHaveLength(1);
    expect(merged[0].fetchedAt).toBe(previous.fetchedAt);
    expect(merged[0].cached).toBe(true);
    expect(merged[0].error).toBe('HTTP 403');
  });
  it('successful empty snapshot removes previous offers', () => {
    expect(mergeSource([source([offer('old', 10)])], source([]))[0].offers).toHaveLength(0);
  });
  it('combines category, provider and query filters', () => {
    const s = source([
      offer('Test fibra', 10),
      { ...offer('Mobile', 9), subcategory: 'casa', provider: 'Other' },
    ]);
    expect(
      filterOffers(
        [s],
        filters({
          query: 'fibra',
          subcategory: 'mobile',
          priceTypes: ['advertised'],
          providers: ['Test'],
          sort: 'name',
        }),
      ),
    ).toHaveLength(1);
    expect(filterOffers([s], filters({ subcategory: 'auto', sort: 'name' }))).toHaveLength(0);
  });
  it('combines multiple energy selections without treating unknown fields as absent conditions', () => {
    const placet = {
      ...offer('placet', null),
      category: 'luce' as const,
      priceType: 'fixed',
      sourceUrl: 'https://example.org/PO_Offerte_E_PLACET_20260923.csv',
      conditions: ['Attivazione: solo da web;Agenzia', 'Pagamento: Domiciliazione bancaria'],
      electricityRates: { annualFee: 120, mono: 0.2, f1: null, f23: null },
      restricted: false,
    };
    const free = {
      ...offer('free', null),
      category: 'luce' as const,
      priceType: 'variable',
      sourceUrl: 'https://example.org/PO_Offerte_E_MLIBERO_20260923.xml',
      conditions: ['Durata condizioni economiche: 24 mesi.'],
      restricted: true,
    };
    const s = source([placet, free]);
    expect(offerMarket(placet)).toBe('placet');
    expect(offerDuration(placet)).toBe('12');
    expect(offerTariff(placet)).toBe('mono');
    expect(
      filterOffers(
        [s],
        filters({
          priceTypes: ['fixed', 'variable'],
          markets: ['placet'],
          tariffs: ['mono'],
          activations: ['Agenzia'],
          restrictions: ['unmarked'],
        }),
      ).map((item) => item.id),
    ).toEqual(['placet']);
    expect(
      filterOffers([s], filters({ durations: ['24'], activations: ['unknown'] })).map(
        (item) => item.id,
      ),
    ).toEqual(['free']);
  });
  it('reports saved, stale and partial results without calling them verified', () => {
    const fresh = source([offer('one', 5)]);
    const now = Date.parse(fresh.fetchedAt) + 1000;
    expect(sourceStatus(fresh, now)).toBe('fresh');
    expect(sourceStatus({ ...fresh, cached: true }, now)).toBe('saved');
    expect(sourceStatus({ ...fresh, partial: true }, now)).toBe('partial');
    expect(sourceStatus({ ...fresh, error: 'HTTP 403' }, now)).toBe('stale');
  });
  it('orders energy offers by declared attributes, leaving unknown expiry last', () => {
    const free = {
      ...offer('A free', null, '2099-12-31'),
      category: 'gas' as const,
      priceType: 'variable',
      sourceUrl: 'https://example.org/PO_Offerte_G_MLIBERO_20260923.xml',
    };
    const placet = {
      ...offer('B placet', null),
      category: 'gas' as const,
      priceType: 'fixed',
      sourceUrl: 'https://example.org/PO_Offerte_G_PLACET_20260923.csv',
    };
    const records = [source([free, placet])];
    expect(filterOffers(records, filters({ sort: 'type' })).map((item) => item.id)).toEqual([
      'B placet',
      'A free',
    ]);
    expect(filterOffers(records, filters({ sort: 'market' })).map((item) => item.id)).toEqual([
      'B placet',
      'A free',
    ]);
    expect(filterOffers(records, filters({ sort: 'expiry' })).map((item) => item.id)).toEqual([
      'A free',
      'B placet',
    ]);
  });
});
