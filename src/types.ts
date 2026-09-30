export type Category = 'luce' | 'gas' | 'internet' | 'assicurazioni';
export interface PriceComponent {
  name: string;
  amount: number;
  unit: string;
  band: string | null;
}
export interface Offer {
  id: string;
  category: Category;
  subcategory: string;
  provider: string;
  name: string;
  description: string;
  url: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  validUntil: string | null;
  priceType: string;
  monthlyPrice: number | null;
  firstYearCost: number | null;
  components: PriceComponent[];
  conditions: string[];
  evidence: string;
  evidenceVersion?: number;
  restricted: boolean;
  electricityRates?: {
    annualFee: number | null;
    mono: number | null;
    f1: number | null;
    f23: number | null;
  } | null;
}
export interface ElectricityParameters {
  values: Record<string, number>;
  sourceUrl: string;
  publishedOn: string;
  fetchedAt: string;
}
export interface SourceResult {
  source: string;
  url: string;
  offers: Offer[];
  fetchedAt: string;
  error: string | null;
  cached: boolean;
  electricityParameters?: ElectricityParameters | null;
  calculationError?: string | null;
  partial?: boolean;
}
export interface ProviderDirectory {
  providers: { id: string; name: string; website: string | null }[];
  sourceUrl: string;
  fetchedAt: string;
  note: string;
}
export interface SearchEvent {
  requestId: string;
  result: SourceResult | null;
  done: boolean;
  cancelled: boolean;
}
export interface ModelStatus {
  installed: boolean;
  downloading: boolean;
  size: number;
  dataDirectory?: string;
}
export interface ModelProgress {
  stage: string;
  downloaded: number;
  total: number;
}
export interface Highlights {
  quotes: string[];
  backend: string;
}
export interface ClauseRisk {
  quote: string;
  category: string;
  severity: 'alto' | 'medio' | 'basso';
}
export interface ContractAnalysis {
  risks: ClauseRisk[];
  backend: string;
  sourceType: string;
}
