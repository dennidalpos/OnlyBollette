import { describe, expect, it } from 'vitest';
import { estimateElectricity, parametersError, profileError } from './electricity';
import type { ElectricityProfile } from './electricity';
import type { ElectricityParameters, Offer } from './types';

const now = new Date('2026-09-23T12:00:00Z');
const parameters: ElectricityParameters = {
  sourceUrl:
    'https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv/parametri/2026_9/PO_Parametri_E_20260923.csv',
  publishedOn: '2026-09-23',
  fetchedAt: now.toISOString(),
  values: {
    dispbt_d: 1.107,
    cdispd: 0.024,
    sigma1: 23.04,
    sigma2: 23.52,
    sigma3: 0.0119,
    uc3: 0.00276,
    uc6p_d: 0.00007,
    uc6s_d: 0.1988,
    asos_dr: 0.031515,
    arim_dr: 0.001638,
    asos_dnr_f: 95.0916,
    arim_dnr_f: 0,
    asos_dnr_v: 0.031515,
    arim_dnr_v: 0.001638,
    acc_c_r_l: 0.0227,
    acc_c_r_h: 0.0227,
    acc_c_nr: 0.0227,
    iva_c: 0.1,
  },
};
const offer: Offer = {
  id: 'fixture',
  category: 'luce',
  subcategory: 'luce',
  provider: 'Test',
  name: 'Test',
  description: '',
  url: 'https://example.org',
  source: 'Portale Offerte',
  sourceUrl: 'https://example.org/data.csv',
  fetchedAt: now.toISOString(),
  validUntil: '2026-12-31',
  priceType: 'fixed',
  monthlyPrice: null,
  firstYearCost: null,
  components: [],
  conditions: [],
  evidence: '',
  restricted: false,
  electricityRates: { annualFee: 120, mono: 0.1, f1: null, f23: null },
};
const profile: ElectricityProfile = {
  consumption: 2700,
  power: 3,
  resident: true,
  tariff: 'mono',
  f1Percent: 33,
};
const estimate = (patch: Partial<ElectricityProfile> = {}) =>
  estimateElectricity(offer, parameters, { ...profile, ...patch }, now)!;

describe('PLACET fixed electricity — official v4.0 method', () => {
  it('calculates each charge and VAT on excise, without adding losses twice', () => {
    const result = estimate();
    expect(result.energy).toBe(390);
    expect(result.commercial).toBe(1.107);
    expect(result.dispatch).toBeCloseTo(64.8, 6);
    expect(result.network).toBeCloseTo(133.9674, 6);
    expect(result.levies).toBeCloseTo(89.5131, 6);
    expect(result.excise).toBeCloseTo(21.792, 6);
    expect(result.vat).toBeCloseTo(70.11795, 6);
    expect(result.total).toBeCloseTo(771.29745, 6);
  });
  it.each([
    [1799, 0],
    [1800, 0],
    [1801, 0.0227],
    [2640, 19.068],
    [2641, 19.1134],
    [4439, 100.7426],
    [4440, 100.788],
    [4441, 100.8107],
  ])('handles excise threshold at %s kWh', (consumption, excise) => {
    expect(estimate({ consumption }).excise).toBeCloseTo(excise, 6);
  });
  it('removes exemption over 3 kW and charges non-resident levies', () => {
    expect(estimate({ power: 3.1 }).excise).toBeCloseTo(61.29, 6);
    const nonResident = estimate({ resident: false });
    expect(nonResident.excise).toBeCloseTo(61.29, 6);
    expect(nonResident.levies).toBeCloseTo(184.6047, 6);
  });
  it('weights F1/F23 without summing tariff alternatives', () => {
    const bio = { ...offer, electricityRates: { annualFee: 120, mono: null, f1: 0.2, f23: 0.1 } };
    expect(
      estimateElectricity(bio, parameters, { ...profile, tariff: 'bio' }, now)!.energy,
    ).toBeCloseTo(479.1, 6);
    expect(estimateElectricity(bio, parameters, profile, now)).toBeNull();
    expect(estimateElectricity(offer, parameters, { ...profile, tariff: 'bio' }, now)).toBeNull();
  });
  it('excludes unsupported, restricted, expired and incomplete offers', () => {
    for (const patch of [
      { category: 'gas' as const },
      { priceType: 'variable' },
      { restricted: true },
      { electricityRates: undefined },
      { validUntil: '2026-09-22' },
      { fetchedAt: '2026-09-21T12:00:00Z' },
      { electricityRates: { annualFee: null, mono: 0.1, f1: null, f23: null } },
    ])
      expect(estimateElectricity({ ...offer, ...patch }, parameters, profile, now)).toBeNull();
    expect(
      estimateElectricity(
        { ...offer, electricityRates: { annualFee: 0, mono: 0, f1: null, f23: null } },
        parameters,
        profile,
        now,
      )!.energy,
    ).toBe(0);
  });
  it('blocks stale, prior-quarter, future and incomplete parameters', () => {
    for (const patch of [
      { fetchedAt: '2026-09-21T12:00:00Z' },
      { publishedOn: '2026-06-30' },
      { publishedOn: '2026-09-24' },
      { publishedOn: 'invalid' },
      { values: { ...parameters.values, cdispd: NaN } },
    ]) {
      expect(parametersError({ ...parameters, ...patch }, now)).toBeTruthy();
      expect(estimateElectricity(offer, { ...parameters, ...patch }, profile, now)).toBeNull();
    }
    expect(parametersError(undefined, now)).toBeTruthy();
  });
  it('validates consumption, power and band inputs', () => {
    for (const patch of [
      { consumption: NaN },
      { consumption: 0 },
      { power: -1 },
      { power: 31 },
      { f1Percent: 101 },
    ])
      expect(profileError({ ...profile, ...patch })).toBeTruthy();
    expect(profileError(profile)).toBeNull();
  });
});
