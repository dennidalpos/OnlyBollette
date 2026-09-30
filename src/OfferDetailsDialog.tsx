import * as Dialog from '@radix-ui/react-dialog';
import { ExternalLink, LoaderCircle, ShieldAlert, Sparkles, X } from 'lucide-react';
import type {
  ContractAnalysis,
  ElectricityParameters,
  Highlights,
  ModelStatus,
  Offer,
} from './types';
import type { ElectricityEstimate } from './electricity';
import { EstimateDetails } from './ElectricityComparison';
import {
  bandLabels,
  dateTime,
  money,
  offerMarket,
  priceDescriptions,
  priceLabels,
  statusLabels,
  type SourceStatus,
} from './catalog';

export interface OfferDetailsDialogProps {
  selected: Offer | null;
  onClose: () => void;
  selectedStatus: SourceStatus;
  estimate?: ElectricityEstimate;
  electricityParameters?: ElectricityParameters | null;
  model: ModelStatus;
  highlights: Highlights | null;
  contractAnalysis: ContractAnalysis | null;
  thinking: boolean;
  analyzingRisks: boolean;
  fetchRemoteTerms: boolean;
  onFetchRemoteTermsChange: (value: boolean) => void;
  aiError: string;
  onSummarize: () => void;
  onAnalyzeRisks: () => void;
  onCancelAi: () => void;
  openUrl: (url: string) => void;
}

export function OfferDetailsDialog({
  selected,
  onClose,
  selectedStatus,
  estimate,
  electricityParameters,
  model,
  highlights,
  contractAnalysis,
  thinking,
  analyzingRisks,
  fetchRemoteTerms,
  onFetchRemoteTermsChange,
  aiError,
  onSummarize,
  onAnalyzeRisks,
  onCancelAi,
  openUrl,
}: OfferDetailsDialogProps) {
  return (
    <Dialog.Root
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) onClose();
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
                  {dateTime(selected.fetchedAt)}. Verifica sempre l’offerta sul sito ufficiale prima
                  di aderire.
                </p>
              </section>
              {estimate && electricityParameters && (
                <EstimateDetails
                  estimate={estimate}
                  parameters={electricityParameters}
                  open={openUrl}
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
                  <strong>{money(selected.firstYearCost)} €</strong> per 12 canoni e attivazione SIM
                  · extra esclusi
                </p>
              )}
              <section className="ai-panel">
                <div className="ai-panel-title">
                  <Sparkles size={18} />
                  <h3>Analisi AI locale</h3>
                  <span>AI locale</span>
                </div>
                <p>
                  L’AI seleziona passaggi della fonte contrattuale. Ogni citazione viene verificata
                  sul testo acquisito.
                </p>
                <div className="ai-panel-actions">
                  <button
                    className={`button ${highlights && !contractAnalysis ? 'primary' : 'secondary'}`}
                    disabled={
                      thinking ||
                      analyzingRisks ||
                      model.downloading ||
                      selected.evidenceVersion !== 1
                    }
                    onClick={onSummarize}
                  >
                    {thinking ? (
                      <>
                        <LoaderCircle size={15} className="spin" />
                        Analisi in corso…
                      </>
                    ) : (
                      <>
                        <Sparkles size={15} />
                        {model.installed ? 'Evidenzia punti chiave' : 'Attiva AI gratuita'}
                      </>
                    )}
                  </button>
                  <button
                    className={`button ${contractAnalysis ? 'primary' : 'secondary'}`}
                    disabled={
                      thinking ||
                      analyzingRisks ||
                      model.downloading ||
                      selected.evidenceVersion !== 1
                    }
                    onClick={onAnalyzeRisks}
                  >
                    {analyzingRisks ? (
                      <>
                        <LoaderCircle size={15} className="spin" />
                        Analisi rischi…
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={15} />
                        Rischi e clausole
                      </>
                    )}
                  </button>
                </div>

                {(selected.url || selected.sourceUrl) && (
                  <label className="ai-remote-checkbox">
                    <input
                      type="checkbox"
                      checked={fetchRemoteTerms}
                      disabled={thinking || analyzingRisks}
                      onChange={(e) => onFetchRemoteTermsChange(e.target.checked)}
                    />
                    Scarica e analizza anche il documento contrattuale collegato (
                    {(selected.url || selected.sourceUrl).toLowerCase().includes('.pdf')
                      ? 'PDF'
                      : 'Web'}
                    )
                  </label>
                )}

                {highlights && (
                  <div className="ai-highlights-result">
                    <ul>
                      {highlights.quotes.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                    <small>
                      Elaborazione locale · {highlights.backend === 'cpu' ? 'CPU' : 'GPU Vulkan'}
                    </small>
                  </div>
                )}

                {contractAnalysis && (
                  <div className="ai-risks-result">
                    <div className="ai-risk-list">
                      {contractAnalysis.risks.map((risk, i) => (
                        <div key={i} className={`ai-risk-item severity-${risk.severity}`}>
                          <div className="ai-risk-header">
                            <span className="ai-risk-category">{risk.category}</span>
                            <span className={`ai-risk-badge severity-${risk.severity}`}>
                              {risk.severity === 'alto'
                                ? 'Rischio Alto'
                                : risk.severity === 'medio'
                                  ? 'Attenzione'
                                  : 'Nota'}
                            </span>
                          </div>
                          <p className="ai-risk-quote">“{risk.quote}”</p>
                        </div>
                      ))}
                    </div>
                    <small>
                      Elaborazione locale (
                      {contractAnalysis.sourceType === 'documento_pdf'
                        ? 'documento PDF'
                        : contractAnalysis.sourceType === 'pagina_web'
                          ? 'pagina web'
                          : 'scheda ufficiale'}
                      ) · {contractAnalysis.backend === 'cpu' ? 'CPU' : 'GPU Vulkan'}
                    </small>
                  </div>
                )}

                {(thinking || analyzingRisks) && (
                  <button className="text-button" onClick={onCancelAi}>
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
                    Aggiorna le offerte per acquisire il testo della fonte prima dell’analisi AI.
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
                <button onClick={() => openUrl(selected.sourceUrl)}>
                  Fonte dati <ExternalLink size={13} />
                </button>
              </div>
              <button className="button primary full-width" onClick={() => openUrl(selected.url)}>
                Vai al sito ufficiale <ExternalLink size={16} />
              </button>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
