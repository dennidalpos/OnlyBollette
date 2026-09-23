import { useState } from 'react';
import { calculationMethod, parametersError, profileError } from './electricity';
import type { ElectricityEstimate, ElectricityProfile } from './electricity';
import type { ElectricityParameters } from './types';
import { money } from './catalog';

export function ElectricityComparison({
  profile,
  onChange,
  parameters,
  error,
  count,
}: {
  profile: ElectricityProfile | null;
  onChange: (profile: ElectricityProfile | null) => void;
  parameters?: ElectricityParameters | null;
  error?: string | null;
  count: number;
}) {
  const [validation, setValidation] = useState('');
  const unavailable = error || parametersError(parameters);
  return (
    <details className="electricity-comparison">
      <summary>Stima annua luce · PLACET fisso</summary>
      <p>
        Confronta le offerte calcolabili con rete, oneri, accisa e IVA inclusi. I tuoi dati restano
        sul PC.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const next: ElectricityProfile = {
            consumption: Number(form.get('consumption')),
            power: Number(form.get('power')),
            resident: form.get('resident') === 'yes',
            tariff: form.get('tariff') as 'mono' | 'bio',
            f1Percent: Number(form.get('f1Percent')),
          };
          const message = profileError(next);
          setValidation(message ?? '');
          if (!message) onChange(next);
        }}
      >
        <label>
          Consumo annuo (kWh)
          <input
            name="consumption"
            type="number"
            min="1"
            max="100000"
            step="1"
            required
            placeholder="Dalla bolletta"
            defaultValue={profile?.consumption}
          />
        </label>
        <label>
          Potenza (kW)
          <input
            name="power"
            type="number"
            min="0.5"
            max="30"
            step="0.1"
            required
            defaultValue={profile?.power ?? 3}
          />
        </label>
        <label>
          Residenza
          <select
            aria-label="Residenza"
            name="resident"
            defaultValue={profile?.resident === false ? 'no' : 'yes'}
          >
            <option value="yes">Residente</option>
            <option value="no">Non residente</option>
          </select>
        </label>
        <label>
          Tariffa
          <select aria-label="Tariffa" name="tariff" defaultValue={profile?.tariff ?? 'mono'}>
            <option value="mono">Monoraria</option>
            <option value="bio">Bioraria</option>
          </select>
        </label>
        <label>
          Consumo F1 (%)
          <input
            name="f1Percent"
            type="number"
            min="0"
            max="100"
            step="0.1"
            required
            defaultValue={profile?.f1Percent ?? 33}
          />
        </label>
        <div className="comparison-actions">
          <button className="button primary" disabled={!!unavailable}>
            Confronta costi annui
          </button>
          {profile && (
            <button type="button" className="button secondary" onClick={() => onChange(null)}>
              Torna a tutte le offerte
            </button>
          )}
        </div>
      </form>
      <small>
        F1 usata solo per la bioraria; il 33% è la ripartizione convenzionale del Portale Offerte.
        Consumo uniforme durante l’anno; tariffe regolate attuali mantenute costanti per 12 mesi.
        Bonus, canone TV, depositi e costi di attivazione esclusi.
      </small>
      {unavailable && (
        <p role="status" className="inline-error">
          {unavailable}
        </p>
      )}
      {validation && (
        <p role="alert" className="inline-error">
          {validation}
        </p>
      )}
      {profile && !unavailable && (
        <p role="status">
          {count} offerte calcolabili per {profile.consumption.toLocaleString('it-IT')} kWh/anno ·{' '}
          {profile.power.toLocaleString('it-IT')} kW ·{' '}
          {profile.resident ? 'residente' : 'non residente'} ·{' '}
          {profile.tariff === 'mono' ? 'monoraria' : `bioraria, F1 ${profile.f1Percent}%`}. Ordine
          dal costo stimato più basso. Escluse le offerte con vincoli territoriali o dati
          incompleti.
        </p>
      )}
    </details>
  );
}

export function EstimateDetails({
  estimate,
  parameters,
  open,
}: {
  estimate: ElectricityEstimate;
  parameters: ElectricityParameters;
  open: (url: string) => void;
}) {
  return (
    <section className="estimate-details">
      <h3>Spesa annua stimata · PLACET fisso</h3>
      <div className="component-table">
        {(
          [
            ['Materia energia e quota fissa', estimate.energy],
            ['Commercializzazione', estimate.commercial],
            ['Dispacciamento', estimate.dispatch],
            ['Rete', estimate.network],
            ['Oneri di sistema', estimate.levies],
            ['Accisa', estimate.excise],
            ['IVA', estimate.vat],
            ['Totale stimato', estimate.total],
          ] as [string, number][]
        ).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{money(value)} €</strong>
          </div>
        ))}
      </div>
      <p>
        Stima sui consumi inseriti, con parametri del{' '}
        {new Date(`${parameters.publishedOn}T12:00:00`).toLocaleDateString('it-IT')} costanti per 12
        mesi. Bonus, canone TV, depositi e costi di attivazione esclusi. Verifica requisiti e
        condizioni prima di aderire.
      </p>
      <div className="comparison-actions">
        <button className="text-button" onClick={() => open(parameters.sourceUrl)}>
          Parametri ufficiali
        </button>
        <button className="text-button" onClick={() => open(calculationMethod)}>
          Metodo di calcolo
        </button>
      </div>
    </section>
  );
}
