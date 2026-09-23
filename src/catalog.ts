import type { Offer, SourceResult } from './types';

export const categoryNames = {
  luce: 'Luce',
  gas: 'Gas',
  internet: 'Internet',
  assicurazioni: 'Assicurazioni',
};
export const subcategories: Record<string, [string, string][]> = {
  internet: [
    ['casa', 'Casa · Fibra e ADSL'],
    ['fwa', 'FWA e 5G casa'],
    ['mobile', 'Mobile'],
  ],
  assicurazioni: [
    ['auto', 'Auto'],
    ['moto', 'Moto'],
    ['casa', 'Casa e famiglia'],
    ['salute', 'Salute e infortuni'],
    ['viaggi', 'Viaggi'],
    ['animali', 'Animali'],
  ],
};
export const money = (n: number, digits = 2) =>
  new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
export const dateTime = (s: string) =>
  new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(s));

export function mergeSource(current: SourceResult[], next: SourceResult): SourceResult[] {
  const previous = current.find((s) => s.source === next.source);
  const result =
    next.error && next.offers.length === 0 && previous
      ? { ...previous, cached: true, error: next.error }
      : next;
  return [...current.filter((s) => s.source !== next.source), result];
}

export type SourceStatus = 'fresh' | 'saved' | 'stale' | 'partial';

export function sourceStatus(source: SourceResult | undefined, now = Date.now()): SourceStatus {
  if (!source || source.error) return 'stale';
  const fetched = Date.parse(source.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > now || now - fetched > 86_400_000) return 'stale';
  if (source.partial) return 'partial';
  return source.cached ? 'saved' : 'fresh';
}

export function offerMarket(offer: Offer): string {
  if (!['luce', 'gas'].includes(offer.category)) return 'unknown';
  if (offer.sourceUrl.includes('_PLACET_')) return 'placet';
  if (offer.sourceUrl.includes('_MLIBERO_')) return 'libero';
  return 'unknown';
}

export function offerDuration(offer: Offer): string {
  if (offerMarket(offer) === 'placet') return '12';
  return (
    offer.conditions
      .find((value) => /^Durata condizioni economiche: \d+ mesi\.$/.test(value))
      ?.match(/\d+/)?.[0] ?? 'unknown'
  );
}

function declaredValues(offer: Offer, prefix: string): string[] {
  const value = offer.conditions.find((condition) => condition.startsWith(prefix));
  return value
    ? value
        .slice(prefix.length)
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
    : ['unknown'];
}

export const offerActivation = (offer: Offer) => declaredValues(offer, 'Attivazione: ');
export const offerPayment = (offer: Offer) => declaredValues(offer, 'Pagamento: ');
export function offerTariff(offer: Offer): string {
  if (offer.category !== 'luce') return 'unknown';
  if (offer.electricityRates?.mono !== null && offer.electricityRates?.mono !== undefined)
    return 'mono';
  if (
    offer.electricityRates?.f1 !== null &&
    offer.electricityRates?.f1 !== undefined &&
    offer.electricityRates?.f23 !== null &&
    offer.electricityRates?.f23 !== undefined
  )
    return 'bio';
  return 'unknown';
}

export interface OfferFilters {
  query: string;
  subcategory: string;
  priceTypes: string[];
  markets: string[];
  durations: string[];
  tariffs: string[];
  activations: string[];
  payments: string[];
  restrictions: string[];
  providers: string[];
  sort: string;
}

export function filterOffers(sources: SourceResult[], filters: OfferFilters): Offer[] {
  const seen = new Set<string>();
  const today = new Date().toLocaleDateString('sv-SE');
  const offers = sources
    .flatMap((s) => s.offers)
    .filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return (
        (!o.validUntil || o.validUntil >= today) &&
        (!filters.subcategory || o.subcategory === filters.subcategory) &&
        (!filters.priceTypes.length || filters.priceTypes.includes(o.priceType)) &&
        (!filters.markets.length || filters.markets.includes(offerMarket(o))) &&
        (!filters.durations.length || filters.durations.includes(offerDuration(o))) &&
        (!filters.tariffs.length || filters.tariffs.includes(offerTariff(o))) &&
        (!filters.activations.length ||
          offerActivation(o).some((value) => filters.activations.includes(value))) &&
        (!filters.payments.length ||
          offerPayment(o).some((value) => filters.payments.includes(value))) &&
        (!filters.restrictions.length ||
          filters.restrictions.includes(o.restricted ? 'restricted' : 'unmarked')) &&
        (!filters.providers.length || filters.providers.includes(o.provider)) &&
        `${o.name} ${o.provider} ${o.description}`
          .toLocaleLowerCase('it')
          .includes(filters.query.toLocaleLowerCase('it'))
      );
    });
  return offers.sort((a, b) => {
    if (filters.sort === 'monthly') {
      const difference = (a.monthlyPrice ?? Infinity) - (b.monthlyPrice ?? Infinity);
      if (difference && !Number.isNaN(difference)) return difference;
    }
    if (filters.sort === 'name')
      return a.name.localeCompare(b.name, 'it') || a.provider.localeCompare(b.provider, 'it');
    if (filters.sort === 'type') {
      const rank = (offer: Offer) => ({ fixed: 0, variable: 1, other: 2 })[offer.priceType] ?? 3;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
    }
    if (filters.sort === 'market' && offerMarket(a) !== offerMarket(b)) {
      return offerMarket(a) === 'placet' ? -1 : 1;
    }
    if (filters.sort === 'expiry') {
      const difference = (a.validUntil ?? '9999').localeCompare(b.validUntil ?? '9999');
      if (difference) return difference;
    }
    if (filters.sort === 'recent') {
      const difference = Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt);
      if (difference) return difference;
    }
    return a.provider.localeCompare(b.provider, 'it') || a.name.localeCompare(b.name, 'it');
  });
}

export const priceLabels: Record<string, string> = {
  fixed: 'Prezzo fisso',
  variable: 'Indicizzato',
  advertised: 'Prezzo pubblicizzato',
  quote: 'Su preventivo',
  other: 'Condizioni dedicate',
};
export const bandLabels: Record<string, string> = {
  '01': 'F1',
  '02': 'F2',
  '03': 'F3',
  '91': 'F23',
};
