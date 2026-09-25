import { useEffect, useRef, useState } from 'react';
import { ElectricityComparison, EstimateDetails } from './ElectricityComparison';
import { DocumentComparison } from './DocumentComparison';
import { estimateElectricity, parametersError } from './electricity';
import type { ElectricityEstimate, ElectricityProfile } from './electricity';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Flame,
  Info,
  LoaderCircle,
  Moon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import type {
  Category,
  Highlights,
  ModelProgress,
  ModelStatus,
  Offer,
  ProviderDirectory,
  SearchEvent,
  SourceResult,
} from './types';
import {
  bandLabels,
  categoryNames,
  dateTime,
  filterOffers,
  inPriceRange,
  mergeSource,
  money,
  offerActivation,
  offerDuration,
  offerMarket,
  offerPayment,
  offerTariff,
  priceLabels,
  priceRangeError,
  sourceStatus,
  subcategories,
} from './catalog';
import type { SourceStatus } from './catalog';

const icons = { luce: Zap, gas: Flame, internet: Wifi, assicurazioni: ShieldCheck };
const categorySubtitles = {
  luce: 'Prezzo fisso · Indicizzato',
  gas: 'Prezzo fisso · Indicizzato',
  internet: 'Casa · FWA · Mobile',
  assicurazioni: 'Auto · Casa · Salute · Viaggi e altro',
};
const sourceNames = {
  luce: 'Portale Offerte · Acquirente Unico',
  gas: 'Portale Offerte · Acquirente Unico',
  internet: 'Fonti ufficiali · copertura in ampliamento',
  assicurazioni: 'Bene · Allianz',
};
const portal = 'https://www.ilportaleofferte.it/portaleOfferte/';
const placetGuide = 'https://www.arera.it/consumatori/offerte-standard-per-i-clienti-finali-placet';
const statusLabels: Record<SourceStatus, string> = {
  fresh: 'Acquisito',
  saved: 'Salvato',
  stale: 'Da aggiornare',
  partial: 'Parziale',
};
const priceDescriptions: Record<string, string> = {
  fixed:
    'Il prezzo della componente energia resta fisso per la durata delle condizioni economiche.',
  variable: 'Il prezzo segue un indice: gli importi mostrati possono essere solo spread e quote.',
  other: 'La formula di prezzo va verificata nelle condizioni ufficiali.',
  advertised: 'Canone pubblicizzato: copertura, attivazione e requisiti vanno verificati.',
  quote: 'Il premio dipende dal profilo e richiede un preventivo personale.',
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri())
    throw new Error(
      'La ricerca è disponibile nell’app Windows. Questa è l’anteprima dell’interfaccia.',
    );
  return invoke<T>(command, args);
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function App() {
  const [category, setCategory] = useState<Category | null>(null);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completedSources, setCompletedSources] = useState(0);
  const [expectedSources, setExpectedSources] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [priceTypes, setPriceTypes] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [durations, setDurations] = useState<string[]>([]);
  const [tariffs, setTariffs] = useState<string[]>([]);
  const [activations, setActivations] = useState<string[]>([]);
  const [payments, setPayments] = useState<string[]>([]);
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [sort, setSort] = useState('provider');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [electricityProfile, setElectricityProfile] = useState<ElectricityProfile | null>(null);
  const [limit, setLimit] = useState(30);
  const [directories, setDirectories] = useState<Partial<Record<Category, ProviderDirectory>>>({});
  const [directoryLoading, setDirectoryLoading] = useState<Partial<Record<Category, boolean>>>({});
  const [directoryErrors, setDirectoryErrors] = useState<Partial<Record<Category, string>>>({});
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directoryLimit, setDirectoryLimit] = useState(40);
  const [selected, setSelected] = useState<Offer | null>(null);
  const [settings, setSettings] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );
  const [model, setModel] = useState<ModelStatus>({
    installed: false,
    downloading: false,
    size: 1396198496,
  });
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [aiError, setAiError] = useState('');
  const [highlights, setHighlights] = useState<Highlights | null>(null);
  const [thinking, setThinking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const activeRequest = useRef('');
  const loadingRef = useRef<HTMLDivElement>(null);
  const selectionEpoch = useRef(0);
  const aiEpoch = useRef(0);
  const listenerReady = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const listeners = Promise.all([
      listen<SearchEvent>('search-update', ({ payload }) => {
        if (disposed || payload.requestId !== activeRequest.current) return;
        if (payload.result) {
          setNow(Date.now());
          setSources((current) => mergeSource(current, payload.result!));
          setCompletedSources((count) => count + 1);
        }
        if (payload.done) {
          activeRequest.current = '';
          setBusy(false);
          setRefreshing(false);
          setCancelling(false);
        }
      }),
      listen<ModelProgress>('model-progress', ({ payload }) => {
        if (!disposed) setProgress(payload);
      }),
    ]);
    listenerReady.current = listeners.then(() => undefined);
    void call<ModelStatus>('model_status')
      .then((s) => {
        if (!disposed) setModel(s);
      })
      .catch((e) => {
        if (!disposed) setAiError(errorText(e));
      });
    return () => {
      disposed = true;
      void listeners.then((stops) => stops.forEach((stop) => stop()));
    };
  }, []);

  useEffect(() => {
    if (!category) return;
    const updateTime = () => setNow(Date.now());
    const timer = window.setInterval(updateTime, 60_000);
    window.addEventListener('focus', updateTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateTime);
    };
  }, [category]);

  useEffect(() => {
    if (!busy) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    loadingRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [busy]);

  async function cancelSearch() {
    const requestId = activeRequest.current;
    if (!requestId) return;
    setCancelling(true);
    try {
      await call('cancel_search', { requestId });
    } catch (error) {
      setCancelling(false);
      throw error;
    }
  }

  async function refresh(target: Category) {
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setBusy(true);
    setRefreshing(true);
    setCancelling(false);
    setCompletedSources(0);
    setError('');
    try {
      await listenerReady.current;
      if (activeRequest.current !== requestId) return;
      await call('search_offers', { category: target, requestId });
    } catch (e) {
      if (activeRequest.current === requestId) {
        activeRequest.current = '';
        setError(errorText(e));
        setBusy(false);
        setRefreshing(false);
        setCancelling(false);
      }
    }
  }

  async function choose(target: Category) {
    const epoch = ++selectionEpoch.current;
    if (activeRequest.current && isTauri())
      void call('cancel_search', { requestId: activeRequest.current }).catch((e) =>
        setError(errorText(e)),
      );
    activeRequest.current = '';
    setCategory(target);
    setRefreshing(false);
    setCancelling(false);
    setCompletedSources(0);
    setExpectedSources([]);
    setNow(Date.now());
    setSources([]);
    setQuery('');
    setSubcategory('');
    setProviders([]);
    setPriceTypes([]);
    setMarkets([]);
    setDurations([]);
    setTariffs([]);
    setActivations([]);
    setPayments([]);
    setRestrictions([]);
    setSort('provider');
    setPriceFrom('');
    setPriceTo('');
    setElectricityProfile(null);
    setLimit(30);
    setDirectoryQuery('');
    setDirectoryLimit(40);
    setError('');
    setBusy(true);
    try {
      const [cached, expected] = await Promise.all([
        call<SourceResult[]>('cached_offers', { category: target }),
        call<string[]>('source_names', { category: target }),
      ]);
      if (epoch !== selectionEpoch.current) return;
      setNow(Date.now());
      setSources(cached);
      setExpectedSources(expected);
      if (
        expected.some((name) => !cached.some((source) => source.source === name)) ||
        cached.some((s) => Date.now() - Date.parse(s.fetchedAt) > 86400000) ||
        (target === 'luce' && !cached.some((s) => s.electricityParameters)) ||
        cached.some((s) => s.offers.some((offer) => offer.evidenceVersion !== 1))
      )
        await refresh(target);
      else setBusy(false);
    } catch (e) {
      if (epoch === selectionEpoch.current) {
        setError(errorText(e));
        setBusy(false);
        setRefreshing(false);
      }
    }
  }

  function home() {
    ++selectionEpoch.current;
    if (activeRequest.current && isTauri())
      void cancelSearch().catch((e) => setError(errorText(e)));
    setCategory(null);
    setError('');
  }

  async function open(url: string) {
    try {
      await call('open_link', { url });
    } catch (e) {
      setError(errorText(e));
    }
  }
  function selectOffer(offer: Offer | null) {
    ++aiEpoch.current;
    if (thinking) void call('cancel_ai').catch((e) => setAiError(errorText(e)));
    setSelected(offer);
    setHighlights(null);
    setThinking(false);
    setAiError('');
  }

  async function download() {
    setAiError('');
    setModel((s) => ({ ...s, downloading: true }));
    try {
      await call('download_model');
      setModel((s) => ({ ...s, installed: true }));
    } catch (e) {
      setAiError(errorText(e));
    } finally {
      setModel((s) => ({ ...s, downloading: false }));
      if (isTauri())
        void call<ModelStatus>('model_status')
          .then(setModel)
          .catch((e) => setAiError(errorText(e)));
    }
  }

  async function summarize() {
    if (!selected) return;
    if (!model.installed) {
      setSettings(true);
      return;
    }
    const epoch = ++aiEpoch.current;
    setThinking(true);
    setAiError('');
    try {
      const result = await call<Highlights>('offer_highlights', { offerId: selected.id });
      if (epoch === aiEpoch.current) setHighlights(result);
    } catch (e) {
      if (epoch === aiEpoch.current) setAiError(errorText(e));
    } finally {
      if (epoch === aiEpoch.current) setThinking(false);
    }
  }

  const filteredOffers = filterOffers(sources, {
    query,
    subcategory,
    priceTypes,
    markets,
    durations,
    tariffs,
    activations,
    payments,
    restrictions,
    providers,
    sort,
  });
  const electricitySource = sources.find((s) => s.source === 'Portale Offerte');
  const electricityParameters = electricitySource?.electricityParameters;
  const estimates = new Map<string, ElectricityEstimate>();
  if (
    category === 'luce' &&
    electricityProfile &&
    electricityParameters &&
    !electricitySource?.calculationError &&
    !parametersError(electricityParameters)
  ) {
    for (const offer of filteredOffers) {
      const estimate = estimateElectricity(offer, electricityParameters, electricityProfile);
      if (estimate) estimates.set(offer.id, estimate);
    }
  }
  const rankedOffers =
    category === 'luce' && electricityProfile
      ? [...filteredOffers]
          .filter((offer) => estimates.has(offer.id))
          .sort((a, b) => estimates.get(a.id)!.total - estimates.get(b.id)!.total)
      : filteredOffers;
  const canFilterPrice = category === 'internet' || (category === 'luce' && !!electricityProfile);
  const priceError = priceRangeError(priceFrom, priceTo);
  const offers =
    canFilterPrice && !priceError
      ? rankedOffers.filter((offer) =>
          inPriceRange(
            category === 'luce' ? estimates.get(offer.id)?.total : offer.monthlyPrice,
            priceFrom,
            priceTo,
          ),
        )
      : rankedOffers;
  const allCount = sources.reduce((n, s) => n + s.offers.length, 0);
  const allOffers = sources.flatMap((source) => source.offers);
  const providerOptions = [...new Set(allOffers.map((offer) => offer.provider))]
    .sort((a, b) => a.localeCompare(b, 'it'))
    .map((value): [string, string] => [value, value]);
  const durationOptions = [...new Set(allOffers.map(offerDuration))]
    .sort((a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : Number(a) - Number(b)))
    .map((value): [string, string] => [
      value,
      value === 'unknown' ? 'Non indicata' : `${value} mesi`,
    ]);
  const tariffOptions = [...new Set(allOffers.map(offerTariff))].map((value): [string, string] => [
    value,
    { mono: 'Monoraria', bio: 'Bioraria', unknown: 'Non indicata' }[value] ?? value,
  ]);
  const activationOptions = [...new Set(allOffers.flatMap(offerActivation))]
    .sort((a, b) => a.localeCompare(b, 'it'))
    .map((value): [string, string] => [
      value,
      value === 'unknown' ? 'Non indicata' : value.replace(/^Offerta attivabile /, ''),
    ]);
  const paymentOptions = [...new Set(allOffers.flatMap(offerPayment))]
    .sort((a, b) => a.localeCompare(b, 'it'))
    .map((value): [string, string] => [value, value === 'unknown' ? 'Non indicata' : value]);
  const selectedFilterCount = [
    priceTypes,
    markets,
    durations,
    tariffs,
    activations,
    payments,
    restrictions,
    providers,
  ].reduce((count, values) => count + values.length, 0);
  const activeFilterCount = selectedFilterCount + Number(!!priceFrom || !!priceTo);
  const energy = category === 'luce' || category === 'gas';
  const Icon = category ? icons[category] : Zap;
  const selectedStatus = sourceStatus(
    sources.find((source) => source.source === selected?.source),
    now,
  );

  function clearFilters() {
    setPriceTypes([]);
    setMarkets([]);
    setDurations([]);
    setTariffs([]);
    setActivations([]);
    setPayments([]);
    setRestrictions([]);
    setProviders([]);
    setPriceFrom('');
    setPriceTo('');
    setLimit(30);
  }

  async function loadDirectory(target: Category) {
    if (directories[target] || directoryLoading[target]) return;
    setDirectoryLoading((current) => ({ ...current, [target]: true }));
    setDirectoryErrors((current) => ({ ...current, [target]: '' }));
    try {
      const result = await call<ProviderDirectory>('provider_directory', { category: target });
      setDirectories((current) => ({ ...current, [target]: result }));
    } catch (error) {
      setDirectoryErrors((current) => ({ ...current, [target]: errorText(error) }));
    } finally {
      setDirectoryLoading((current) => ({ ...current, [target]: false }));
    }
  }

  function showAllOffers() {
    setElectricityProfile(null);
    clearFilters();
    setSort('provider');
  }

  function toggleFilter(values: string[], setValues: (next: string[]) => void, value: string) {
    setValues(
      values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
    );
    setLimit(30);
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('onlybollette-theme', next);
    setTheme(next);
  }

  return (
    <>
      <div className="app-shell" inert={busy} aria-busy={busy}>
        <header className="app-header">
          <button className="brand" onClick={home} aria-label="OnlyBollette, schermata iniziale">
            <span className="brand-mark">
              <Zap size={20} fill="currentColor" />
            </span>
            Only<span>Bollette</span>
            <span className="brand-dot">.</span>
          </button>
          <div className="header-actions">
            <button
              className="theme-button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'}
              title={theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="ai-status" onClick={() => setSettings(true)}>
              <span className={`status-dot ${model.installed ? 'ready' : ''}`} />
              <span>AI locale</span>
              <SlidersHorizontal size={15} />
            </button>
          </div>
        </header>

        {!category ? (
          <main className="home">
            <div className="home-heading">
              <span className="eyebrow">LE TUE SPESE, UNA SCELTA ALLA VOLTA</span>
              <h1>Da dove vuoi iniziare?</h1>
            </div>
            <div className="category-grid">
              {(Object.keys(categoryNames) as Category[]).map((key) => {
                const CategoryIcon = icons[key];
                return (
                  <button
                    className={`category-card ${key}`}
                    key={key}
                    onClick={() => void choose(key)}
                  >
                    <span className="category-top">
                      <span className="category-icon">
                        <CategoryIcon size={29} strokeWidth={1.6} />
                      </span>
                      <ArrowRight className="category-arrow" size={22} />
                    </span>
                    <span className="category-name">{categoryNames[key]}</span>
                    <span className="category-subtitle">{categorySubtitles[key]}</span>
                  </button>
                );
              })}
            </div>
            <div className="home-footnote">
              <ShieldCheck size={15} />
              <span>Fonti ufficiali</span>
              <span className="separator">·</span>
              <Sparkles size={15} />
              <span>AI sul tuo PC</span>
              <span className="separator">·</span>
              <span>Nessun account</span>
            </div>
          </main>
        ) : (
          <main className="results">
            <button className="back" onClick={home}>
              <ArrowLeft size={16} />
              Tutte le categorie
            </button>
            <div className="results-heading">
              <div className="heading-title">
                <span className={`small-category-icon ${category}`}>
                  <Icon size={24} />
                </span>
                <div>
                  <h1>Offerte {categoryNames[category].toLocaleLowerCase('it')}</h1>
                  <p>
                    {category === 'internet' && expectedSources.length > 0
                      ? `${expectedSources.length} fonti ufficiali · copertura in ampliamento`
                      : sourceNames[category]}
                  </p>
                </div>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void refresh(category)}
              >
                {busy ? (
                  <>
                    <LoaderCircle size={14} className="spin" />
                    Aggiornamento…
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    Aggiorna offerte
                  </>
                )}
              </button>
            </div>
            {!!subcategories[category] && (
              <div className="tabs" aria-label="Sottocategorie">
                <button
                  className={!subcategory ? 'active' : ''}
                  onClick={() => {
                    setSubcategory('');
                    setLimit(30);
                  }}
                >
                  Tutte
                </button>
                {subcategories[category].map(([value, label]) => (
                  <button
                    className={subcategory === value ? 'active' : ''}
                    key={value}
                    onClick={() => {
                      setSubcategory(value);
                      setLimit(30);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="filters">
              <label className="search-field">
                <Search size={17} />
                <input
                  aria-label="Cerca offerte"
                  placeholder="Cerca offerta o fornitore"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(30);
                  }}
                />
              </label>
              <MultiFilter
                title="Fornitori"
                options={providerOptions}
                selected={providers}
                onToggle={(value) => toggleFilter(providers, setProviders, value)}
                searchable
              />
              <div className="price-filter">
                <span>
                  {category === 'luce'
                    ? 'Stima annua €'
                    : category === 'internet'
                      ? 'Canone €/mese'
                      : 'Prezzo €'}
                </span>
                <label>
                  <span>Da</span>
                  <input
                    aria-label="Prezzo minimo"
                    inputMode="decimal"
                    placeholder="0"
                    value={priceFrom}
                    disabled={!canFilterPrice}
                    onChange={(event) => {
                      setPriceFrom(event.target.value.trim());
                      setLimit(30);
                    }}
                  />
                </label>
                <label>
                  <span>A</span>
                  <input
                    aria-label="Prezzo massimo"
                    inputMode="decimal"
                    placeholder="∞"
                    value={priceTo}
                    disabled={!canFilterPrice}
                    onChange={(event) => {
                      setPriceTo(event.target.value.trim());
                      setLimit(30);
                    }}
                  />
                </label>
              </div>
              <label className="sort-control">
                <span>Ordina</span>
                <select
                  aria-label="Ordina offerte"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  {category === 'luce' && electricityProfile ? (
                    <option value="annual">Stima annua crescente</option>
                  ) : (
                    <>
                      <option value="provider">Fornitore A–Z</option>
                      <option value="name">Nome offerta A–Z</option>
                      <option value="recent">Acquisizione recente</option>
                      {energy && <option value="type">Fisso prima</option>}
                      {energy && <option value="market">PLACET prima</option>}
                      {energy && <option value="expiry">Scadenza più vicina</option>}
                      {category === 'internet' && <option value="monthly">Canone crescente</option>}
                    </>
                  )}
                </select>
              </label>
            </div>
            {priceError && (
              <p className="price-filter-error" role="alert">
                {priceError}
              </p>
            )}
            {!canFilterPrice && (
              <p className="price-filter-note">
                {category === 'luce'
                  ? 'Per filtrare il prezzo, avvia la stima annua PLACET fissa.'
                  : category === 'gas'
                    ? 'Filtro prezzo non disponibile: confronta il totale con il tuo profilo sul Portale Offerte.'
                    : 'Filtro prezzo non disponibile: il premio richiede un preventivo personale.'}
              </p>
            )}
            {activeFilterCount > 0 && (
              <button className="clear-filters" onClick={clearFilters}>
                Cancella filtri ({activeFilterCount})
              </button>
            )}
            {energy && (
              <div className="contract-filters" aria-label="Filtri contratto">
                <MultiFilter
                  title="Tipo prezzo"
                  hint="Fisso, indicizzato o altra formula dichiarata dalla fonte."
                  options={[
                    ['fixed', 'Fisso'],
                    ['variable', 'Indicizzato'],
                    ['other', 'Altro'],
                  ]}
                  selected={priceTypes}
                  onToggle={(value) => toggleFilter(priceTypes, setPriceTypes, value)}
                />
                <MultiFilter
                  title="Formato offerta"
                  hint="Le PLACET hanno condizioni standard ARERA e prezzi scelti dal venditore."
                  options={[
                    ['libero', 'Altre offerte libero'],
                    ['placet', 'PLACET'],
                  ]}
                  selected={markets}
                  onToggle={(value) => toggleFilter(markets, setMarkets, value)}
                />
                <MultiFilter
                  title="Durata prezzo"
                  hint="Riguarda le condizioni economiche, non la durata del contratto."
                  options={durationOptions}
                  selected={durations}
                  onToggle={(value) => toggleFilter(durations, setDurations, value)}
                />
                {category === 'luce' && (
                  <MultiFilter
                    title="Tariffa luce"
                    hint="Disponibile per PLACET fisse luce con dati di tariffa riconosciuti."
                    options={tariffOptions}
                    selected={tariffs}
                    onToggle={(value) => toggleFilter(tariffs, setTariffs, value)}
                  />
                )}
                <MultiFilter
                  title="Requisiti"
                  hint="Nessuno segnalato non garantisce che l’offerta sia accessibile a tutti."
                  options={[
                    ['restricted', 'Requisiti segnalati'],
                    ['unmarked', 'Nessuno segnalato'],
                  ]}
                  selected={restrictions}
                  onToggle={(value) => toggleFilter(restrictions, setRestrictions, value)}
                />
                <MultiFilter
                  title="Attivazione"
                  hint="Modalità dichiarate nei dati PLACET; altre offerte possono non indicarle."
                  options={activationOptions}
                  selected={activations}
                  onToggle={(value) => toggleFilter(activations, setActivations, value)}
                />
                <MultiFilter
                  title="Pagamento"
                  hint="Metodi dichiarati nei dati PLACET; verifica sempre i dettagli."
                  options={paymentOptions}
                  selected={payments}
                  onToggle={(value) => toggleFilter(payments, setPayments, value)}
                />
              </div>
            )}
            <div className="comparison-note">
              <Info size={16} />
              <p>
                {energy
                  ? electricityProfile && category === 'luce'
                    ? 'Stima limitata alle offerte luce PLACET fisse calcolabili. Non è una classifica dell’intero mercato.'
                    : 'Prezzi e quote di vendita, non totale bolletta. Per il costo annuo completo servono consumi e dati della fornitura.'
                  : category === 'internet'
                    ? 'Canoni pubblicizzati: copertura, attivazione e requisiti vanno verificati. La lista copre le fonti indicate.'
                    : 'Prodotti e coperture disponibili. Il premio dipende dal tuo profilo e si ottiene sul sito della compagnia.'}
              </p>
              {energy && (
                <button onClick={() => void open(portal)}>
                  Confronto completo <ExternalLink size={13} />
                </button>
              )}
              {category === 'assicurazioni' && (
                <button onClick={() => void open('https://www.preventivass.it/')}>
                  Preventivass RC auto <ExternalLink size={13} />
                </button>
              )}
            </div>
            <details className="results-guide">
              <summary>
                <Info size={15} /> Come leggere offerte e stato dei dati
              </summary>
              <div>
                {energy && (
                  <>
                    <p>
                      <strong>Fisso</strong>: la componente energia non segue un indice nel periodo
                      indicato. <strong>Indicizzato</strong>: spread e quote non sono il prezzo
                      finale.
                    </p>
                    <p>
                      <strong>PLACET</strong>: condizioni e struttura standard definite da ARERA,
                      prezzo scelto dal venditore. Le condizioni economiche si rinnovano ogni 12
                      mesi; il contratto non ha una scadenza automatica.
                    </p>
                    <p>
                      <strong>Durata prezzo</strong>: mesi delle condizioni economiche, non durata
                      del contratto. La tariffa mono/bioraria è classificata solo per le PLACET luce
                      riconosciute. Attivazione e pagamento sono filtrabili solo quando dichiarati
                      in modo strutturato; “Non indicata” non significa che l’opzione sia esclusa.
                    </p>
                  </>
                )}
                <p>
                  <strong>Acquisito</strong>: letto dalla fonte in questa sessione.{' '}
                  <strong>Salvato</strong>: copia locale entro 24 ore.{' '}
                  <strong>Da aggiornare</strong>: dati più vecchi o aggiornamento fallito.{' '}
                  <strong>Parziale</strong>: catalogo incompleto. Data, fonte e condizioni restano
                  consultabili nei dettagli.
                </p>
                {energy && (
                  <button onClick={() => void open(placetGuide)}>
                    Definizioni ARERA <ExternalLink size={13} />
                  </button>
                )}
              </div>
            </details>
            <DocumentComparison
              key={category}
              category={category}
              offers={allOffers}
              electricityParameters={electricityParameters}
            />
            {category === 'luce' && (
              <ElectricityComparison
                profile={electricityProfile}
                onChange={(profile) => {
                  if (!profile) {
                    showAllOffers();
                  } else {
                    setElectricityProfile(profile);
                    setPriceTypes(['fixed']);
                    setMarkets(['placet']);
                    setSort('annual');
                    setLimit(30);
                  }
                }}
                parameters={electricityParameters}
                error={electricitySource?.calculationError}
                count={estimates.size}
              />
            )}
            {category === 'luce' && electricityProfile && (
              <div className="comparison-active" role="status">
                <span>
                  Stima PLACET fisso · {electricityProfile.consumption.toLocaleString('it-IT')}{' '}
                  kWh/anno · {electricityProfile.power.toLocaleString('it-IT')} kW ·{' '}
                  {electricityProfile.resident ? 'residente' : 'non residente'} ·{' '}
                  {electricityProfile.tariff === 'mono' ? 'monoraria' : 'bioraria'}
                  {electricitySource?.calculationError || parametersError(electricityParameters)
                    ? ' · Aggiorna le offerte per ripristinare la stima.'
                    : ''}
                </span>
                <button className="text-button" onClick={showAllOffers}>
                  Tutte le offerte
                </button>
              </div>
            )}
            {error && (
              <div role="alert" className="error-banner">
                {error}
              </div>
            )}
            {sources
              .filter((s) => s.error)
              .map((s) => (
                <div role="status" className="source-warning" key={s.source}>
                  <Info size={16} />
                  <span>
                    <strong>{s.source}:</strong> {s.error}
                    {s.offers.length > 0 ? ' Mostrati i dati salvati in precedenza.' : ''}
                  </span>
                  {s.url && (
                    <button onClick={() => void open(s.url)}>
                      Apri fonte <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              ))}
            {sources
              .filter((s) => s.partial)
              .map((s) => (
                <div role="status" className="source-warning" key={`partial-${s.source}`}>
                  <Info size={16} />
                  <span>
                    <strong>{s.source}:</strong> Catalogo parziale: alcune pagine non sono state
                    acquisite.
                  </span>
                </div>
              ))}
            <div className="list-meta">
              <span>
                {offers.length} {offers.length === 1 ? 'offerta' : 'offerte'}
                {offers.length !== allCount && ` su ${allCount}`}
              </span>
              {busy ? (
                <span className="loading-label">
                  <LoaderCircle size={14} className="spin" />
                  Ricerca nelle fonti ufficiali…
                </span>
              ) : (
                <span>
                  {sources.length
                    ? `Dati del ${dateTime(sources.map((s) => s.fetchedAt).sort()[0])}`
                    : 'Nessun dato ancora acquisito'}
                </span>
              )}
            </div>
            <div className="offer-list">
              {offers.slice(0, limit).map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  estimate={estimates.get(offer.id)}
                  status={sourceStatus(
                    sources.find((source) => source.source === offer.source),
                    now,
                  )}
                  onSelect={() => selectOffer(offer)}
                />
              ))}
            </div>
            {busy && !offers.length && (
              <div className="skeletons" aria-label="Caricamento offerte">
                {[1, 2, 3].map((i) => (
                  <div className="skeleton" key={i}>
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            )}
            {!busy && !offers.length && !error && (
              <div className="empty-state">
                <Search size={30} />
                <h2>Nessuna offerta trovata</h2>
                <p>
                  {sources.length
                    ? 'Prova a cambiare i filtri o consulta le fonti indicate.'
                    : 'Aggiorna per cercare le offerte disponibili.'}
                </p>
              </div>
            )}
            {offers.length > limit && (
              <button className="button load-more" onClick={() => setLimit((n) => n + 30)}>
                Mostra altre offerte <ChevronDown size={16} />
              </button>
            )}
            <details
              className="provider-directory"
              onToggle={(event) => {
                if (event.currentTarget.open) void loadDirectory(category);
              }}
            >
              <summary>Operatori dai registri ufficiali</summary>
              <p>
                Questo elenco è separato dalle offerte acquisite. La presenza nel registro non prova
                che un operatore abbia un’offerta attiva per questa categoria.
              </p>
              {directoryLoading[category] && <p role="status">Caricamento registro ufficiale…</p>}
              {directoryErrors[category] && <p role="alert">{directoryErrors[category]}</p>}
              {directories[category] && (
                <>
                  <p>{directories[category].note}</p>
                  <p>
                    {directories[category].providers.length} operatori nel registro · Acquisito il{' '}
                    {dateTime(directories[category].fetchedAt)}
                  </p>
                  <label className="directory-search">
                    Cerca operatore
                    <input
                      value={directoryQuery}
                      onChange={(event) => {
                        setDirectoryQuery(event.target.value);
                        setDirectoryLimit(40);
                      }}
                    />
                  </label>
                  <ul>
                    {directories[category].providers
                      .filter((provider) =>
                        provider.name
                          .toLocaleLowerCase('it')
                          .includes(directoryQuery.toLocaleLowerCase('it')),
                      )
                      .slice(0, directoryLimit)
                      .map((provider) => (
                        <li key={provider.id}>
                          <span>{provider.name}</span>
                          {provider.website && (
                            <button onClick={() => void open(provider.website!)}>
                              Sito <ExternalLink size={12} />
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                  {directories[category].providers.filter((provider) =>
                    provider.name
                      .toLocaleLowerCase('it')
                      .includes(directoryQuery.toLocaleLowerCase('it')),
                  ).length > directoryLimit && (
                    <button
                      className="directory-more"
                      onClick={() => setDirectoryLimit((count) => count + 40)}
                    >
                      Mostra altri operatori
                    </button>
                  )}
                </>
              )}
              <button
                className="directory-source"
                onClick={() =>
                  void open(
                    directories[category]?.sourceUrl ??
                      {
                        luce: 'https://www.arera.it/area-operatori/ricerca-operatori',
                        gas: 'https://www.arera.it/area-operatori/ricerca-operatori',
                        internet: 'https://datiroc.agcom.it/elenco-pubblico',
                        assicurazioni:
                          'https://www.ivass.it/consumatori/siti-imprese-intermediari/',
                      }[category],
                  )
                }
              >
                Apri registro ufficiale <ExternalLink size={12} />
              </button>
              {category === 'assicurazioni' && (
                <button
                  className="directory-source"
                  onClick={() =>
                    void open('https://www.ivass.it/operatori/imprese/albi/index.html')
                  }
                >
                  Albo completo IVASS <ExternalLink size={12} />
                </button>
              )}
            </details>
            <p className="results-footer">
              Le offerte visualizzate coprono le fonti indicate; il registro elenca operatori, non
              offerte. Nessuna offerta sponsorizzata.
            </p>
          </main>
        )}

        <Dialog.Root
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) selectOffer(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog offer-dialog">
              {selected && (
                <>
                  <Dialog.Close className="icon-button close" aria-label="Chiudi dettagli">
                    <X size={20} />
                  </Dialog.Close>
                  <span className="eyebrow">{selected.provider}</span>
                  <Dialog.Title>{selected.name}</Dialog.Title>
                  <Dialog.Description>
                    {selected.description || 'Condizioni e informazioni dalla fonte ufficiale.'}
                  </Dialog.Description>
                  <div className="detail-tags">
                    <span
                      className={`tag price-${selected.priceType}`}
                      title={priceDescriptions[selected.priceType]}
                    >
                      {priceLabels[selected.priceType]}
                    </span>
                    {offerMarket(selected) === 'placet' && (
                      <span
                        className="tag placet"
                        title="Condizioni standard ARERA, prezzo scelto dal venditore"
                      >
                        PLACET
                      </span>
                    )}
                    <span className={`data-status ${selectedStatus}`}>
                      {statusLabels[selectedStatus]}
                    </span>
                    {selected.validUntil && (
                      <span>
                        Valida fino al{' '}
                        {new Date(`${selected.validUntil}T12:00:00`).toLocaleDateString('it-IT')}
                      </span>
                    )}
                  </div>
                  <section className="reliability-note">
                    <h3>Fonte e limiti</h3>
                    <p>
                      {selected.category === 'luce' || selected.category === 'gas'
                        ? 'Componenti e condizioni provengono dai dati pubblicati dal Portale Offerte. Non rappresentano la spesa totale né confermano l’idoneità della tua fornitura.'
                        : selected.category === 'internet'
                          ? 'Canone e condizioni provengono dalle pagine del gestore. Copertura, promozioni e costi di attivazione richiedono conferma.'
                          : 'La fonte descrive il prodotto. Il premio e le coperture applicabili richiedono un preventivo personale.'}
                    </p>
                    <p>
                      Stato: {statusLabels[selectedStatus]} · acquisizione{' '}
                      {dateTime(selected.fetchedAt)}. Verifica sempre l’offerta sul sito ufficiale
                      prima di aderire.
                    </p>
                  </section>
                  {estimates.has(selected.id) && electricityParameters && (
                    <EstimateDetails
                      estimate={estimates.get(selected.id)!}
                      parameters={electricityParameters}
                      open={(url) => void open(url)}
                    />
                  )}
                  {!!selected.components.length && (
                    <section>
                      <h3>Componenti pubblicate</h3>
                      <div className="component-table">
                        {selected.components.map((c, i) => (
                          <div key={i}>
                            <span>
                              {c.name}
                              {c.band ? ` · ${bandLabels[c.band] ?? c.band}` : ''}
                            </span>
                            <strong>
                              {money(
                                c.amount,
                                c.unit.includes('kWh') || c.unit.includes('Smc') ? 4 : 2,
                              )}{' '}
                              <small>{c.unit}</small>
                            </strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {selected.monthlyPrice !== null && (
                    <div className="detail-price">
                      {money(selected.monthlyPrice)} € <span>/ mese · canone pubblicizzato</span>
                    </div>
                  )}
                  {selected.firstYearCost !== null && (
                    <p className="annual-cost">
                      <strong>{money(selected.firstYearCost)} €</strong> per 12 canoni e attivazione
                      SIM · extra esclusi
                    </p>
                  )}
                  <section className="ai-panel">
                    <div className="ai-panel-title">
                      <Sparkles size={18} />
                      <h3>Punti chiave</h3>
                      <span>AI locale</span>
                    </div>
                    <p>
                      L’AI seleziona passaggi della fonte. Ogni citazione viene verificata sul testo
                      acquisito.
                    </p>
                    {highlights ? (
                      <>
                        <ul>
                          {highlights.quotes.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                        <small>
                          Elaborazione locale ·{' '}
                          {highlights.backend === 'cpu' ? 'CPU' : 'GPU Vulkan'}
                        </small>
                      </>
                    ) : (
                      <button
                        className="button primary"
                        disabled={thinking || model.downloading || selected.evidenceVersion !== 1}
                        onClick={() => void summarize()}
                      >
                        {thinking ? (
                          <>
                            <LoaderCircle size={15} className="spin" />
                            Analisi in corso…
                          </>
                        ) : (
                          <>
                            <Sparkles size={15} />
                            {model.installed ? 'Evidenzia i punti chiave' : 'Attiva AI gratuita'}
                          </>
                        )}
                      </button>
                    )}
                    {thinking && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void call('cancel_ai').catch((e) => setAiError(errorText(e)))
                        }
                      >
                        Annulla
                      </button>
                    )}
                    {aiError && (
                      <p role="alert" className="inline-error">
                        {aiError}
                      </p>
                    )}
                    {selected.evidenceVersion !== 1 && (
                      <p role="status">
                        Aggiorna le offerte per acquisire il testo della fonte prima dell’analisi
                        AI.
                      </p>
                    )}
                  </section>
                  <section>
                    <h3>Da sapere</h3>
                    <ul className="conditions">
                      {selected.conditions.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </section>
                  <details className="source-details">
                    <summary>Testo acquisito dalla fonte</summary>
                    <p>
                      {selected.evidenceVersion === 1
                        ? selected.evidence
                        : 'Testo di una versione precedente: aggiorna le offerte per verificarne la provenienza.'}
                    </p>
                  </details>
                  <div className="detail-source">
                    <span>
                      {selected.source} · {dateTime(selected.fetchedAt)}
                    </span>
                    <button onClick={() => void open(selected.sourceUrl)}>
                      Fonte dati <ExternalLink size={13} />
                    </button>
                  </div>
                  <button
                    className="button primary full-width"
                    onClick={() => void open(selected.url)}
                  >
                    Vai al sito ufficiale <ExternalLink size={16} />
                  </button>
                </>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <Dialog.Root open={settings} onOpenChange={setSettings}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog model-dialog">
              <Dialog.Close className="icon-button close" aria-label="Chiudi impostazioni AI">
                <X size={20} />
              </Dialog.Close>
              <span className="model-icon">
                <Sparkles size={26} />
              </span>
              <Dialog.Title>La tua AI, sul tuo PC.</Dialog.Title>
              <Dialog.Description>
                Gratuita, senza account e senza chiavi API. Il modello viene scaricato una volta e
                lavora in locale.
              </Dialog.Description>
              <div className="model-spec">
                <strong>Qwen3.5 · 2B</strong>
                <span>1,4 GB · Apache 2.0</span>
                <p>Le offerte arrivano dalle fonti online. L’AI aiuta a leggerne le condizioni.</p>
              </div>
              {model.downloading && (
                <div className="download-progress">
                  <div>
                    <span>{progress?.stage ?? 'Preparazione download…'}</span>
                    <span>{Math.round(((progress?.downloaded ?? 0) / model.size) * 100)}%</span>
                  </div>
                  <progress max={model.size} value={progress?.downloaded ?? 0} />
                </div>
              )}
              {model.installed ? (
                <div className="model-ready">
                  <Check size={18} />
                  Modello pronto all’uso
                </div>
              ) : (
                <button
                  className="button primary full-width"
                  disabled={model.downloading}
                  onClick={() => void download()}
                >
                  {model.downloading ? (
                    <>
                      <LoaderCircle className="spin" size={16} />
                      Download in corso
                    </>
                  ) : (
                    <>
                      <ArrowDownToLine size={17} />
                      Scarica e attiva AI
                    </>
                  )}
                </button>
              )}
              {model.downloading && (
                <button
                  className="text-button"
                  onClick={() =>
                    void call('cancel_download').catch((e) => setAiError(errorText(e)))
                  }
                >
                  Sospendi download
                </button>
              )}
              {model.installed && !model.downloading && (
                <button className="text-button" onClick={() => void download()}>
                  Verifica o ripara il modello
                </button>
              )}
              {aiError && (
                <p role="alert" className="inline-error">
                  {aiError}
                </p>
              )}
              <p className="model-note">
                Puoi continuare a consultare le offerte durante il download. Il modello richiede
                memoria aggiuntiva durante l’uso.
              </p>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      {busy && (
        <div className="update-overlay">
          <div
            className="update-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
            tabIndex={-1}
            ref={loadingRef}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              event.preventDefault();
              const button =
                event.currentTarget.querySelector<HTMLButtonElement>('button:not(:disabled)');
              (button ?? event.currentTarget).focus();
            }}
          >
            <LoaderCircle className="spin" size={28} aria-hidden="true" />
            <h2 id="update-title">
              {refreshing ? 'Aggiornamento offerte in corso' : 'Caricamento offerte'}
            </h2>
            <p>
              {refreshing
                ? 'Attendi il completamento della ricerca nelle fonti. Le offerte saranno consultabili al termine.'
                : 'Lettura dei dati salvati in corso.'}
            </p>
            {refreshing && (
              <p className="update-progress" aria-live="polite">
                {cancelling
                  ? 'Interruzione in corso…'
                  : `Fonti completate: ${completedSources}${expectedSources.length ? ` su ${expectedSources.length}` : ''}`}
              </p>
            )}
            {refreshing && (
              <button
                className="button secondary"
                disabled={cancelling}
                onClick={() => void cancelSearch().catch((e) => setError(errorText(e)))}
              >
                <Square size={14} />
                {cancelling ? 'Interruzione…' : 'Interrompi'}
              </button>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MultiFilter({
  title,
  hint,
  options,
  selected,
  onToggle,
  searchable = false,
}: {
  title: string;
  hint?: string;
  options: [string, string][];
  selected: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  function positionMenu() {
    if (!details.current?.open || !menu.current) return;
    if (window.innerWidth <= 850) {
      menu.current.style.left = '';
      return;
    }
    const anchor = details.current.getBoundingClientRect();
    const width = menu.current.offsetWidth;
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
    menu.current.style.left = `${left - anchor.left}px`;
  }
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) {
        details.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details.current?.open) details.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', positionMenu);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', positionMenu);
    };
  }, []);
  const visible = searchable
    ? options.filter(([, label]) =>
        label.toLocaleLowerCase('it').includes(search.toLocaleLowerCase('it')),
      )
    : options;
  return (
    <details
      className="multi-filter"
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open) requestAnimationFrame(positionMenu);
      }}
    >
      <summary>
        {title}
        {selected.length > 0 && <span className="filter-count">{selected.length}</span>}
      </summary>
      <div className="multi-filter-menu" ref={menu}>
        {hint && <p className="filter-hint">{hint}</p>}
        {searchable && (
          <input
            aria-label={`Cerca ${title.toLocaleLowerCase('it')}`}
            placeholder="Cerca…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        {visible.length ? (
          visible.map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={() => onToggle(value)}
              />
              <span>{label}</span>
            </label>
          ))
        ) : (
          <p>Nessuna opzione disponibile</p>
        )}
      </div>
    </details>
  );
}

function OfferCard({
  offer,
  estimate,
  status,
  onSelect,
}: {
  offer: Offer;
  estimate?: ElectricityEstimate;
  status: SourceStatus;
  onSelect: () => void;
}) {
  const components = offer.components.slice(0, 2);
  return (
    <article className="offer-card">
      <div className="provider-avatar">
        {offer.provider.replace('www.', '').slice(0, 2).toUpperCase()}
      </div>
      <div className="offer-content">
        <div className="offer-topline">
          <span
            className={`tag price-${offer.priceType}`}
            title={priceDescriptions[offer.priceType]}
          >
            {priceLabels[offer.priceType]}
          </span>
          {offerMarket(offer) === 'placet' && (
            <span
              className="tag placet"
              title="Condizioni standard ARERA, prezzo scelto dal venditore"
            >
              PLACET
            </span>
          )}
        </div>
        <span className="provider-name">{offer.provider}</span>
        <h2>
          <button onClick={onSelect}>{offer.name}</button>
        </h2>
        <p className="offer-description">
          {offer.description || 'Scopri le condizioni sul sito ufficiale.'}
        </p>
        {offer.restricted && (
          <span className="restriction">Requisiti di accesso da verificare</span>
        )}
        <div className="offer-source">
          <Info size={12} />
          {offer.source} <span>·</span> {dateTime(offer.fetchedAt)}
          <span className={`data-status ${status}`}>{statusLabels[status]}</span>
        </div>
      </div>
      <div className="offer-price">
        {estimate ? (
          <>
            <strong>
              {money(estimate.total)} <small>€ / anno</small>
            </strong>
            <span>Stima PLACET · imposte incluse</span>
          </>
        ) : offer.monthlyPrice !== null ? (
          <>
            <strong>
              {money(offer.monthlyPrice)} <small>€</small>
            </strong>
            <span>al mese, condizioni da verificare</span>
          </>
        ) : components.length ? (
          <>
            {components.map((c, i) => (
              <div className="mini-component" key={i}>
                <strong>
                  {money(c.amount, c.unit.includes('kWh') || c.unit.includes('Smc') ? 4 : 2)}{' '}
                  <small>{c.unit}</small>
                </strong>
                <span>
                  {c.name}
                  {c.band ? ` · ${bandLabels[c.band] ?? c.band}` : ''}
                </span>
              </div>
            ))}
            <span className="component-note">
              {offer.priceType === 'variable'
                ? 'Spread e quote · indice escluso'
                : 'Componenti di vendita'}
            </span>
          </>
        ) : (
          <>
            <strong className="quote-price">
              {offer.category === 'assicurazioni' ? 'Su preventivo' : 'Consulta prezzo'}
            </strong>
            <span>Sul sito ufficiale</span>
          </>
        )}
        <button className="details-button" onClick={onSelect}>
          Dettagli <ArrowRight size={15} />
        </button>
      </div>
    </article>
  );
}
