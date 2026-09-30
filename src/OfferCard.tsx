import { ArrowRight, Info } from 'lucide-react';
import type { Offer } from './types';
import type { ElectricityEstimate } from './electricity';
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

export interface OfferCardProps {
  offer: Offer;
  estimate?: ElectricityEstimate;
  status: SourceStatus;
  onSelect: () => void;
}

export function OfferCard({ offer, estimate, status, onSelect }: OfferCardProps) {
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
