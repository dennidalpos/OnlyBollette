import type { ElectricityParameters, Offer } from './types';

export const calculationMethod =
  'https://www.ilportaleofferte.it/portaleOfferte/resources/cms/documents/7d0a872b48e8796c84366afedd2ce7ec.pdf';

export interface ElectricityProfile {
  consumption: number;
  power: number;
  resident: boolean;
  tariff: 'mono' | 'bio';
  f1Percent: number;
}

export interface ElectricityEstimate {
  energy: number;
  commercial: number;
  dispatch: number;
  network: number;
  levies: number;
  excise: number;
  vat: number;
  total: number;
}

export const parameterKeys = [
  'dispbt_d',
  'cdispd',
  'sigma1',
  'sigma2',
  'sigma3',
  'uc3',
  'uc6p_d',
  'uc6s_d',
  'asos_dr',
  'arim_dr',
  'asos_dnr_f',
  'arim_dnr_f',
  'asos_dnr_v',
  'arim_dnr_v',
  'acc_c_r_l',
  'acc_c_r_h',
  'acc_c_nr',
  'iva_c',
] as const;

export function profileError(profile: ElectricityProfile): string | null {
  if (
    !Number.isFinite(profile.consumption) ||
    profile.consumption <= 0 ||
    profile.consumption > 100000
  )
    return 'Inserisci un consumo annuo tra 1 e 100.000 kWh.';
  if (!Number.isFinite(profile.power) || profile.power < 0.5 || profile.power > 30)
    return 'Inserisci una potenza tra 0,5 e 30 kW.';
  if (!['mono', 'bio'].includes(profile.tariff) || typeof profile.resident !== 'boolean')
    return 'Seleziona tariffa e residenza.';
  if (!Number.isFinite(profile.f1Percent) || profile.f1Percent < 0 || profile.f1Percent > 100)
    return 'Il consumo in fascia F1 deve essere tra 0 e 100%.';
  return null;
}

function fresh(timestamp: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -60000 && age <= 86400000;
}

export function parametersError(
  parameters: ElectricityParameters | null | undefined,
  now = new Date(),
): string | null {
  if (!parameters) return 'Aggiorna le offerte per acquisire i parametri della stima.';
  const published = new Date(`${parameters.publishedOn}T00:00:00`);
  if (
    !fresh(parameters.fetchedAt, now) ||
    !Number.isFinite(published.getTime()) ||
    published > now ||
    published.getFullYear() !== now.getFullYear() ||
    Math.floor(published.getMonth() / 3) !== Math.floor(now.getMonth() / 3) ||
    parameters.publishedOn < '2026-04-01'
  )
    return 'Parametri tariffari da aggiornare. Premi Aggiorna offerte.';
  if (parameterKeys.some((key) => !Number.isFinite(parameters.values[key])))
    return 'Parametri tariffari incompleti: stima non disponibile.';
  return null;
}

// Portale Offerte, calculation rules v4.0, sections 3.1.1–3.1.6 (from April 2026).
export function estimateElectricity(
  offer: Offer,
  parameters: ElectricityParameters,
  profile: ElectricityProfile,
  now = new Date(),
): ElectricityEstimate | null {
  const rates = offer.electricityRates;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (
    offer.category !== 'luce' ||
    offer.priceType !== 'fixed' ||
    offer.restricted ||
    !rates ||
    !fresh(offer.fetchedAt, now) ||
    !offer.validUntil ||
    offer.validUntil < today ||
    profileError(profile) ||
    parametersError(parameters, now)
  )
    return null;
  const { consumption: kwh, power, resident, f1Percent } = profile;
  if (rates.annualFee === null || !Number.isFinite(rates.annualFee)) return null;
  const unit =
    profile.tariff === 'mono'
      ? rates.mono
      : rates.f1 !== null &&
          rates.f23 !== null &&
          Number.isFinite(rates.f1) &&
          Number.isFinite(rates.f23)
        ? (rates.f1 * f1Percent) / 100 + (rates.f23 * (100 - f1Percent)) / 100
        : null;
  if (unit === null || !Number.isFinite(unit)) return null;
  const p = parameters.values;
  const energy = rates.annualFee + unit * kwh;
  const commercial = p.dispbt_d;
  const dispatch = p.cdispd * kwh;
  const network = p.sigma1 + (p.sigma2 + p.uc6s_d) * power + (p.sigma3 + p.uc3 + p.uc6p_d) * kwh;
  const levies = resident
    ? (p.asos_dr + p.arim_dr) * kwh
    : p.asos_dnr_f + p.arim_dnr_f + (p.asos_dnr_v + p.arim_dnr_v) * kwh;
  // Annual consumption is uniform; the 1,800 kWh exemption tapers above 2,640 kWh.
  const exempt =
    resident && power <= 3 ? Math.min(kwh, Math.max(0, 1800 - Math.max(0, kwh - 2640))) : 0;
  const excise =
    (kwh - exempt) * (resident ? (power <= 3 ? p.acc_c_r_l : p.acc_c_r_h) : p.acc_c_nr);
  const subtotal = energy + commercial + dispatch + network + levies + excise;
  const vat = subtotal * p.iva_c;
  const total = subtotal + vat;
  if (!Number.isFinite(total) || total < 0) return null;
  return { energy, commercial, dispatch, network, levies, excise, vat, total };
}
