import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Category, ElectricityParameters, Offer } from './types';
import { categoryNames, money } from './catalog';
import {
  compareDocuments,
  fieldSpecs,
  numeric,
  parseDocument,
  type Clause,
  type DocumentAnalysis,
  type DocumentRole,
  type Fields,
} from './comparisonDocuments';

const roleNames: Record<DocumentRole, string> = {
  current: 'Documento attuale',
  terms: 'Condizioni contrattuali',
  quote: 'Nuova proposta',
};

const freshOffer = (offer: Offer) => {
  const now = new Date();
  const age = now.getTime() - Date.parse(offer.fetchedAt);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 86_400_000 &&
    (!offer.validUntil || offer.validUntil >= today)
  );
};

export function DocumentComparison({
  category,
  offers,
  electricityParameters,
}: {
  category: Category;
  offers: Offer[];
  electricityParameters?: ElectricityParameters | null;
}) {
  const [step, setStep] = useState(1);
  const [documents, setDocuments] = useState<
    { name: string; role: DocumentRole; readable: boolean }[]
  >([]);
  const [fields, setFields] = useState<Fields>({});
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [basisConfirmed, setBasisConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [conflictsResolved, setConflictsResolved] = useState(false);
  const [catalogOfferId, setCatalogOfferId] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [manualQuoteConfirmed, setManualQuoteConfirmed] = useState(false);
  const documentEpoch = useRef(0);
  useEffect(
    () => () => {
      documentEpoch.current++;
    },
    [],
  );
  const specs = [...fieldSpecs(category, 'current'), ...fieldSpecs(category, 'quote')];
  const selectedCatalogOffer = offers.find((offer) => offer.id === catalogOfferId);
  const visibleCatalogOffers = offers
    .filter((offer) =>
      `${offer.provider} ${offer.name}`
        .toLocaleLowerCase('it')
        .includes(catalogQuery.toLocaleLowerCase('it')),
    )
    .slice(0, 50);
  if (
    selectedCatalogOffer &&
    !visibleCatalogOffers.some((offer) => offer.id === selectedCatalogOffer.id)
  )
    visibleCatalogOffers.unshift(selectedCatalogOffer);
  const hasQuote =
    documents.some((doc) => doc.role === 'quote' && !doc.name.startsWith('Catalogo:')) ||
    (category !== 'assicurazioni' && !!(selectedCatalogOffer && freshOffer(selectedCatalogOffer)));
  const comparison = compareDocuments(
    category,
    fields,
    hasQuote || manualQuoteConfirmed,
    basisConfirmed,
    electricityParameters,
  );

  async function addDocument(role: DocumentRole) {
    setError('');
    if (!isTauri()) {
      setError('Caricamento disponibile nell’app Windows.');
      return;
    }
    const epoch = ++documentEpoch.current;
    setLoading(true);
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'PDF e immagini',
            extensions: ['pdf', 'png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff'],
          },
        ],
      });
      if (epoch !== documentEpoch.current || typeof path !== 'string') return;
      const result = await invoke<DocumentAnalysis>('analyze_document', { path });
      if (epoch !== documentEpoch.current) return;
      const parsed = parseDocument(category, role === 'terms' ? 'current' : role, result);
      const found = Object.entries(parsed.fields)
        .filter(([key, value]) => fields[key] && fields[key].value.trim() !== value.value.trim())
        .map(([key]) => key);
      if (found.length || parsed.conflicts.length)
        setConflicts((current) => [...new Set([...current, ...found, ...parsed.conflicts])]);
      setConflictsResolved(false);
      setDocuments((items) => [
        ...items,
        { name: result.fileName, role, readable: result.readable },
      ]);
      setFields((current) => {
        const next = { ...current };
        for (const key of parsed.conflicts) {
          if (next[key]) next[key] = { ...next[key], confirmed: false };
        }
        for (const [key, value] of Object.entries(parsed.fields)) {
          if (
            !next[key] ||
            (role === 'quote' && next[key].document.startsWith('Catalogo:') && !next[key].confirmed)
          )
            next[key] = value;
        }
        return next;
      });
      setClauses((current) =>
        [...current, ...parsed.clauses.map((clause) => ({ ...clause, role }))].slice(0, 60),
      );
      setBasisConfirmed(false);
      setManualQuoteConfirmed(false);
      setReviewed(false);
      setStep(2);
      if (!result.readable)
        setError('Testo non riconosciuto. Inserisci manualmente i dati necessari.');
    } catch (e) {
      if (epoch === documentEpoch.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (epoch === documentEpoch.current) setLoading(false);
    }
  }

  function setField(key: string, value: string) {
    setFields((current) => ({
      ...current,
      [key]: {
        value,
        document: current[key]?.document ?? 'Inserito manualmente',
        page: current[key]?.page ?? 0,
        confirmed: false,
      },
    }));
    setReviewed(false);
    setBasisConfirmed(false);
    setManualQuoteConfirmed(false);
  }

  function confirmFields() {
    setFields((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, field]) => [
          key,
          { ...field, confirmed: !!field.value.trim() },
        ]),
      ),
    );
    setReviewed(true);
    setStep(3);
  }

  function clear() {
    documentEpoch.current++;
    setLoading(false);
    setDocuments([]);
    setFields({});
    setClauses([]);
    setBasisConfirmed(false);
    setReviewed(false);
    setError('');
    setStep(1);
    setCatalogOfferId('');
    setCatalogQuery('');
    setConflicts([]);
    setConflictsResolved(false);
    setManualQuoteConfirmed(false);
  }

  function chooseCatalogOffer(id: string) {
    documentEpoch.current++;
    setLoading(false);
    setCatalogOfferId(id);
    setClauses((items) => items.filter((item) => item.role !== 'quote'));
    setConflicts((keys) => keys.filter((key) => !key.endsWith('Quote')));
    setConflictsResolved(false);
    setManualQuoteConfirmed(false);
    const offer = offers.find((item) => item.id === id);
    setDocuments((items) =>
      items
        .filter((item) => item.role !== 'quote')
        .concat(
          offer
            ? [{ name: `Catalogo: ${offer.name}`, role: 'quote' as const, readable: true }]
            : [],
        ),
    );
    setFields((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.endsWith('Quote')),
      );
      if (!offer || !freshOffer(offer)) return next;
      const add = (key: string, value: number | string | null | undefined) => {
        if (value !== null && value !== undefined && value !== '' && !next[key])
          next[key] = {
            value: typeof value === 'number' ? String(value).replace('.', ',') : value,
            document: `Catalogo: ${offer.source} · ${offer.sourceUrl}`,
            page: 0,
            confirmed: false,
          };
      };
      if (category === 'internet') add('monthlyQuote', offer.monthlyPrice);
      if (category === 'luce' || category === 'gas') {
        add(
          'priceTypeQuote',
          offer.priceType === 'fixed'
            ? 'fisso'
            : offer.priceType === 'variable'
              ? 'indicizzato'
              : null,
        );
        if (category === 'luce') {
          if (offer.electricityRates?.mono != null) add('tariffQuote', 'monoraria');
          else if (offer.electricityRates?.f1 != null && offer.electricityRates?.f23 != null)
            add('tariffQuote', 'bioraria');
          add('unitQuote', offer.electricityRates?.mono);
          add('fixedQuote', offer.electricityRates?.annualFee);
          if (offer.electricityRates) {
            add('lossesQuote', 'incluse');
            add('dispatchModeQuote', 'parametro ufficiale');
            add('commercialModeQuote', 'parametro ufficiale');
          }
        }
      }
      return next;
    });
    setBasisConfirmed(false);
    setReviewed(false);
  }

  return (
    <details className="document-comparison">
      <summary>Confronta con il tuo contratto</summary>
      <p>
        Carica i documenti, verifica i dati letti e confronta solo importi sostenuti dalle fonti. I
        file e i dati personali restano in questa sessione.
      </p>
      {(loading || documents.length > 0 || Object.keys(fields).length > 0) && (
        <button type="button" className="text-button" onClick={clear}>
          Cancella confronto
        </button>
      )}
      <nav className="document-steps" aria-label="Passaggi confronto">
        {(['Carica', 'Verifica', 'Confronta'] as const).map((label, index) => (
          <button
            key={label}
            type="button"
            className={step === index + 1 ? 'active' : ''}
            onClick={() => setStep(index + 1)}
            disabled={loading || (index === 2 && !reviewed)}
          >
            {index + 1}. {label}
          </button>
        ))}
      </nav>
      {step === 1 && (
        <div className="document-panel">
          <h3>Documenti {categoryNames[category].toLowerCase()}</h3>
          <div className="document-actions">
            {(['current', 'terms', 'quote'] as DocumentRole[]).map((role) => (
              <button
                key={role}
                type="button"
                className="button secondary"
                onClick={() => void addDocument(role)}
                disabled={loading}
              >
                {roleNames[role]}
              </button>
            ))}
          </div>
          {offers.length > 0 && (
            <label className="document-catalog">
              Oppure scegli un’offerta pubblicata
              <input
                aria-label="Cerca offerta per il confronto"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder="Cerca fornitore o offerta"
              />
              <select
                value={catalogOfferId}
                onChange={(event) => chooseCatalogOffer(event.target.value)}
              >
                <option value="">Seleziona offerta</option>
                {visibleCatalogOffers.map((offer) => (
                  <option value={offer.id} key={offer.id}>
                    {offer.provider} · {offer.name}
                  </option>
                ))}
              </select>
              <small>
                Se mancano prezzi o condizioni personalizzate, aggiungi il preventivo o la scheda
                dell’offerta.
              </small>
              {selectedCatalogOffer && !freshOffer(selectedCatalogOffer) && (
                <small>Offerta da aggiornare: carica una nuova proposta prima del confronto.</small>
              )}
            </label>
          )}
          {loading && <p role="status">Lettura locale in corso…</p>}
          <ul>
            {documents.map((doc, index) => (
              <li key={`${doc.name}-${index}`}>
                {roleNames[doc.role]}: {doc.name}
                {!doc.readable && ' · testo non riconosciuto'}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => setStep(2)}
          >
            Inserisci i dati manualmente
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="document-panel">
          <h3>Verifica i dati</h3>
          <p>
            Correggi i valori letti. Per i dati assenti puoi compilare il campo; lascia vuoto ciò
            che non conosci.
          </p>
          {conflicts.length > 0 && (
            <div role="alert">
              <p>
                Valori discordanti nei documenti:{' '}
                {conflicts
                  .map((key) => specs.find((spec) => spec.key === key)?.label ?? key)
                  .join(', ')}
                . Verifica quale condizione si applica.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={conflictsResolved}
                  onChange={(event) => setConflictsResolved(event.target.checked)}
                />{' '}
                Ho risolto le differenze nei valori riportati.
              </label>
            </div>
          )}
          <div className="document-fields">
            {specs.map((spec) => (
              <label key={spec.key}>
                <span>
                  {spec.label} · {spec.key.endsWith('Current') ? 'attuale' : 'proposta'}
                  {spec.unit && ` (${spec.unit})`}
                </span>
                <input
                  value={fields[spec.key]?.value ?? ''}
                  onChange={(event) => setField(spec.key, event.target.value)}
                  inputMode={
                    spec.unit === '€' ||
                    (spec.unit ?? '').includes('kWh') ||
                    (spec.unit ?? '').includes('Smc') ||
                    spec.unit === 'mesi'
                      ? 'decimal'
                      : 'text'
                  }
                />
                <small>
                  {fields[spec.key]
                    ? `${fields[spec.key].document}${fields[spec.key].page ? ` · pagina ${fields[spec.key].page}` : ''}${fields[spec.key].period ? ` · ${fields[spec.key].period}` : ''} · da confermare`
                    : 'Non trovato · inserimento manuale'}
                </small>
              </label>
            ))}
          </div>
          <div className="document-actions">
            <button type="button" className="button secondary" onClick={() => setStep(1)}>
              Aggiungi documento
            </button>
            <button
              type="button"
              className="button primary"
              onClick={confirmFields}
              disabled={conflicts.length > 0 && !conflictsResolved}
            >
              Conferma dati
            </button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="document-panel">
          <h3>Confronto</h3>
          {!hasQuote && (
            <label className="document-confirm">
              <input
                type="checkbox"
                checked={manualQuoteConfirmed}
                onChange={(event) => setManualQuoteConfirmed(event.target.checked)}
              />
              Ho trascritto i dati della nuova proposta da un preventivo o una scheda in mio
              possesso.
            </label>
          )}
          <label className="document-confirm">
            <input
              type="checkbox"
              checked={basisConfirmed}
              onChange={(event) => setBasisConfirmed(event.target.checked)}
            />
            {category === 'assicurazioni'
              ? 'Ho verificato che il premio attuale valga per il prossimo rinnovo e che garanzie, esclusioni e profilo di rischio siano equivalenti.'
              : 'Ho verificato che periodo, componenti e condizioni siano confrontabili.'}
          </label>
          <p role="status">
            <strong>
              {comparison.status === 'comparable'
                ? 'Confrontabile'
                : comparison.status === 'partial'
                  ? 'Parziale'
                  : 'Non confrontabile'}
            </strong>
          </p>
          {comparison.status === 'comparable' && (
            <div className="component-table">
              <div>
                <span>Situazione attuale · {comparison.period}</span>
                <strong>{money(comparison.current!)} €</strong>
              </div>
              <div>
                <span>Nuova proposta · {comparison.period}</span>
                <strong>{money(comparison.candidate!)} €</strong>
              </div>
              <div>
                <span>Differenza prima dei costi di uscita</span>
                <strong>{money(comparison.difference!)} €</strong>
              </div>
            </div>
          )}
          {comparison.electricityBreakdown && (
            <details>
              <summary>Dettaglio stima luce</summary>
              <div className="component-table">
                {(
                  [
                    ['energy', 'Vendita energia'],
                    ['commercial', 'Commercializzazione'],
                    ['dispatch', 'Dispacciamento'],
                    ['network', 'Rete'],
                    ['levies', 'Oneri'],
                    ['excise', 'Accisa'],
                    ['vat', 'IVA'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <strong>
                      {money(comparison.electricityBreakdown!.current[key])} € →{' '}
                      {money(comparison.electricityBreakdown!.candidate[key])} €
                    </strong>
                  </div>
                ))}
              </div>
            </details>
          )}
          {comparison.status === 'comparable' && comparison.next24 && (
            <div className="component-table">
              <div>
                <span>Situazione attuale · 24 mesi</span>
                <strong>{money(comparison.next24.current)} €</strong>
              </div>
              <div>
                <span>Nuova proposta · 24 mesi</span>
                <strong>{money(comparison.next24.candidate)} €</strong>
              </div>
              <div>
                <span>Differenza · 24 mesi</span>
                <strong>{money(comparison.next24.difference)} €</strong>
              </div>
            </div>
          )}
          {(numeric(fields.exitCurrent) !== null || numeric(fields.exitQuote) !== null) && (
            <p>
              <small>
                Possibili costi di uscita, separati dalla differenza: attuale{' '}
                {numeric(fields.exitCurrent) === null
                  ? 'non confermato'
                  : `${money(numeric(fields.exitCurrent)!)} €`}
                ; nuova proposta{' '}
                {numeric(fields.exitQuote) === null
                  ? 'non confermato'
                  : `${money(numeric(fields.exitQuote)!)} €`}
                . Verifica la clausola applicabile.
              </small>
            </p>
          )}
          {comparison.reasons.length > 0 && (
            <ul>
              {comparison.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {comparison.notes.map((note) => (
            <p key={note}>
              <small>{note}</small>
            </p>
          ))}
          {clauses.length > 0 && (
            <details>
              <summary>Clausole individuate nei documenti</summary>
              <ul>
                {clauses.map((clause, index) => (
                  <li key={index}>
                    <strong>
                      {clause.document} · pagina {clause.page}
                    </strong>
                    : {clause.text}
                    {clause.kind === 'continuation' && (
                      <p>La prosecuzione non conferma i prezzi per i prossimi 12 mesi.</p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p>
            <small>
              Le clausole sono riportate come testo del documento. Verifica l’originale prima di
              decidere.
            </small>
          </p>
          <div className="document-actions">
            <button type="button" className="button secondary" onClick={() => setStep(2)}>
              Correggi dati
            </button>
            <button type="button" className="button secondary" onClick={() => setStep(1)}>
              Aggiungi documento
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </details>
  );
}
