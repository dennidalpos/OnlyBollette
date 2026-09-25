# Sources, Catalogs & Comparison Rules

OnlyBollette retrieves official public data directly from operator websites and regulatory open-data portals. It applies deterministic comparison logic and enforces clear boundaries where automated comparison is not possible.

## Data Sources by Category

| Category | Sources | Acquisition Method | Limitations |
| --- | --- | --- | --- |
| **Luce** (Electricity) | [Portale Offerte](https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page) | XML feed for free-market offers; CSV for domestic PLACET offers; CSV for quarterly regulated parameters. | Domestic active offers only. Ranks supported fixed PLACET offers. Indexed offers require personal calculation on Portale Offerte. |
| **Gas** | Portale Offerte | XML feed for free-market offers; CSV for domestic PLACET offers. | Domestic active offers only. Full annual estimate requires individual profile on Portale Offerte. |
| **Internet** (17 sources) | Iliad, Fastweb, TIM, Sky Wifi, PosteCasa, EOLO, Tiscali, CoopVoce, Kena, Dimensione, BBBell (Family FWA), BBBell Kiara (Fibre), Enel Fibra, Vodafone, 1Mobile, ho., spusu | Direct HTTP reading of official public product pages and catalogs; spusu cards come from its public homepage catalog endpoint. | Advertised monthly price displayed where recognized by source-specific adapter. Vodafone Casa Start/Pro prices come from distinct public catalog cards; the page gives conflicting activation indications. The 1Mobile adapter covers Start XPlus Reward only: initial and later renewal prices, porting-dependent activation, and the subscription deadline remain separate. The ho. home data adapter separates new and existing customers, activation and SIM costs, and separately purchased routers. The spusu adapter covers three homepage mobile cards and keeps the published subscription note separate from price validity. None infers an annual total. Coverage, other variants and eligibility need separate verification. Kiara starting prices remain textual. First-year SIM cost is calculated only when monthly price and SIM activation are explicit and stable. |
| **Assicurazioni** (Insurance) | Bene Assicurazioni, Allianz | Public product pages and catalog. | Product descriptions and standard information only. Real quotes require insurer underwriting. Allianz may return HTTP 403, displayed as a source notice. |
| **Registri Ufficiali** (Registries) | ARERA (electricity/gas), AGCOM ROC (telecom), IVASS (supervised insurers) | Official regulatory registers queried on demand. | Informational operator directory only. Registration does not constitute an active consumer offer. |

## Electricity Estimate Methodology

The deterministic electricity calculator in `src/electricity.ts` implements the official [Portale Offerte calculation rules v4.0, sections 3.1.1–3.1.6](https://www.ilportaleofferte.it/portaleOfferte/resources/cms/documents/7d0a872b48e8796c84366afedd2ce7ec.pdf):

- **Supported Scope**: Active domestic fixed-price PLACET offers with recognized simulation codes and complete pricing components.
- **Components Included**:
  1. Seller energy price (€/kWh) and fixed commercialization fee (€/year).
  2. Dispatching costs (using post-April 2026 domestic formula: fixed fee + €/kWh rate).
  3. Regulated network transport, metering, and system charges (ASOS, ARIM, UC3, UC6).
  4. Excise duties (with resident exemption up to 1,800 kWh tapering off at 2,640 kWh) and 10% VAT.
- **Parameters**: Downloaded quarterly from Portale Offerte parameter feeds and held constant over the 12-month projection. If parameters are stale (>24 hours) or missing, estimates are blocked until refresh.
- **Tariff Selection**: In accordance with ARERA 135/2022 art. 1, monoraria and bioraria tariffs are evaluated strictly against their corresponding rates. Bioraria estimates default to 33% F1 consumption (user-editable).

## Document & Bill Comparison Rules

The **Confronta con il tuo contratto** tool (`src/comparisonDocuments.ts`, `src/documentEnergy.ts`) extracts contract parameters from uploaded bills or policies:

1. **Profile Extraction**:
   - Power (kW), resident status, tariff structure (monoraria/bioraria), and annual consumption (kWh) are scoped to supply summary sections.
   - Ambiguous or conflicting values across pages are left unconfirmed and flagged for user review.
2. **Economic Components**:
   - Parses component tables for energy unit price (€/kWh), annual/monthly commercialization (€/mese converted to €/anno), variable dispatch, and DISPbt.
   - Requires explicit confirmation of loss inclusion rules (and loss percentage if excluded).
   - Incomplete rows, missing units, or OCR noise require manual transcription.
3. **Applicability & Temporal Validity**:
   - Document comparison requires confirmed start and end dates covering the next 12 months for both contracts.
   - Printed expiry dates, including the end of a `Validità condizioni economiche: dal ... al ...` range, and contractual continuation clauses are extracted with page provenance for manual review. They **never** automatically populate future applicable economic dates.
4. **Comparison Boundaries**:
   - Unit-price electricity comparison is supported only when both current contract and candidate offer have confirmed fixed monoraria tariffs.
   - Indexed offers, bioraria/multioraria contracts, gas, and insurance require complete annual quotes or personal estimates.
   - Historical billed totals are never treated as forward 12-month projections.

## Cache Freshness & Failure Lifecycle

- Offers and parameters are stored in SQLite and considered stale after 24 hours.
- Entering a category triggers a background refresh if cache is expired or missing.
- **Full Source Failure**: The previous snapshot is retained; a session-only warning banner is displayed.
- **Partial Catalog**: If a web source returns only part of its catalog, the old snapshot is replaced with acquired products and a persistent partial-catalog badge is saved.
- **Source Inventory Check**: The frontend verifies cached sources against `source_names(category)` IPC; obsolete or incomplete cache manifests trigger a refresh.
