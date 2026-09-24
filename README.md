# OnlyBollette

Windows desktop app for Italian household energy, internet and insurance offers. Tauri 2, Rust, React and TypeScript. No account, hosted backend or paid AI API.

## Use

Install `src-tauri/target/release/bundle/nsis/OnlyBollette_0.1.0_x64-setup.exe`, then open OnlyBollette. Select Luce, Gas, Internet or Assicurazioni. Energy results support multiple selections for price type, PLACET/other free-market offers, economic-condition duration, access restrictions, activation and payment methods, and recognized PLACET electricity tariffs. A missing field remains “Non indicata”; it does not imply a missing contract condition. Results can be ordered by provider, offer name, acquisition time, and relevant energy attributes. Internet offers can also be ordered by advertised monthly charge. The inclusive price range filters Internet by advertised monthly charge and, when the electricity comparison is active, the supported fixed PLACET subset by annual estimate. Offers without that comparable amount do not match an active price range. The price filter is unavailable for gas and insurance. The app starts in dark mode; the header button switches between dark and light themes and saves the choice locally.

Offer cards distinguish price types by color and show source acquisition time and status: acquired in this session, saved locally, stale/failed refresh, or partial catalog. These statuses describe data provenance and completeness, not an independent guarantee of price or eligibility. The in-app “Come leggere offerte e stato dei dati” guide explains the terms; offer details link to the acquired source and official offer. Energy components and indexed spreads are not comparable full bills. A complete personalized comparison remains available through Portale Offerte.

In Luce, open **Stima annua luce · PLACET fisso**, enter annual kWh, meter power, residence and tariff. The calculated subset is sorted by estimated annual cost, with a breakdown in offer details. Return to all offers to leave this comparison. Profiles are held only in memory.

Each category also has **Confronta con il tuo contratto**. Add a current bill, invoice or policy as a PDF/image, optionally add contract terms, and choose an offer or add its personal quote. Windows OCR reads the selected files locally using an installed recognition language; review every extracted value and its document/page before comparing. If OCR is unavailable or a file is unreadable, enter the data manually. The comparison and extracted text are session-only and are not saved in offer snapshots. The numeric difference requires confirmed comparable costs and conditions: a single bill total is never annualized, and insurance requires a personal renewal premium and comparable coverage. Internet shows 12-month and, when all terms are available, 24-month costs. Document-based electricity estimates can use confirmed fixed monorate prices and current official parameters; gas and indexed offers require complete annual estimates for the same profile. Otherwise the result identifies missing data without a savings figure. Contract snippets are displayed with document/page references, not interpreted as legal advice. Extraction and native IPC were verified on synthetic digital/scanned PDFs and images using isolated app data; arbitrary issuer layouts and personalized portal parity have not been verified.

Electricity estimates from unit prices require an explicitly confirmed monorate tariff on both sides; bioraria, multioraria and unknown tariffs need complete annual estimates instead. Unit prices accept a decimal dot or comma; catalog numbers are displayed with a decimal comma. For a manually transcribed proposal, confirm that its values come from a quote or offer sheet in your possession before comparison. Changing the selected catalog offer clears the previous proposal's fields, documents, clauses and confirmations while preserving the current contract. Clearing a comparison discards pending OCR results even if the native reader finishes later.

Open an offer for acquired source text, available published conditions, source links and **Punti chiave**. The first AI use offers a resumable 1.4 GB model download. The application manages llama.cpp automatically; neither Ollama nor Python is required. The runtime tries Vulkan, then CPU. Downloading the model does not block browsing offers.

The interface is Italian. The app targets Windows 10/11 x64 with WebView2. Eight GB RAM is a target, not a verified minimum; performance was tested on an i7-10700 / 32 GB / RTX 2070.

## Sources and comparison limits

Document OCR preserves word rectangles and line breaks. Extraction separates adjacent columns, scopes profile values to supply/consumption sections and reports conflicting values for review. Supported component tables retain their billing period and use the unit-price column, not the billed total. Monthly seller charges are converted to annual amounts. Confirm loss inclusion (and percentage if excluded), dispatch and DISPbt treatment before using unit prices; separate documented charges replace the corresponding official parameters. Unrecognized OCR characters and incomplete tables require manual input. Repeated component-block layouts remain under verification in the tracker.

Energy document comparisons require applicable economic start/end dates covering the next twelve months for both contracts. The printed expiry is shown separately: a general continuation clause does not establish a new price period. Add the updated terms or transcribe their documented period and review the applicable prices before confirming. Offer subscription deadlines are not automatically used as economic-condition validity.

| Category          | Retrieval                                                                            | Comparison                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electricity / gas | Domestic, active market-free XML and PLACET CSV from Portale Offerte                 | Published seller components and conditions. Annual estimates for supported fixed domestic electricity PLACET offers; other electricity and all gas offers use the external official comparison. |
| Internet          | Current Iliad, Fastweb, TIM, Sky Wifi, PosteCasa, EOLO, Tiscali, CoopVoce, Kena and Dimensione product pages, discovered from official catalogs or read directly from official product pages | Advertised monthly prices only where a source-specific parser recognizes the amount. First-year SIM costs only when a permanent monthly price and one-time activation are explicit. Other annual totals remain unavailable. |
| Insurance         | Bene product pages and Allianz catalog                                               | Product information; personalized quotes remain on insurer sites. Allianz may return HTTP 403, which is displayed rather than bypassed. Preventivass is an external link for base RC auto.      |

The separate **Operatori dai registri ufficiali** section retrieves current ARERA electricity/gas seller lists, AGCOM's active electronic-communications registration records, or IVASS's published list of supervised insurer websites when opened. These are operator directories, not offer catalogs. AGCOM includes businesses that do not sell household Internet access; IVASS's website list excludes some insurers operating in Italy under other authorizations, so its RIGA register is linked for the full authorization check. Failed directory retrieval shows an error and the official register link. The displayed offers still cover only the sources in the table; other national, local and virtual operators remain open work. AGCOM requires operators to publish their own tariff-transparency pages, while its central comparison prototype is restricted to operators and consumer associations. The app does not guarantee every provider's offers or the cheapest personalized contract, verify broadband availability at an address, submit insurance details, purchase contracts or access SPID. Missing prices are never treated as zero; index spreads are never presented as final energy prices. Territory, consumption requirements, discounts and access conditions must be checked in the official source.

Structured prices are parsed by code. AI selects up to three numbered passages from acquired source fields/text; the UI shows only exact, validated passages from that normalized text. Application-generated warnings are kept separately in the offer conditions and excluded from AI evidence. Legacy snapshots without this provenance marker remain browsable but require a refresh before AI analysis; their old highlights are not reused. The AI never calculates prices or generates quotation amounts. Page content cannot trigger model tool calls or arbitrary commands.

Acquisition does not include every contractual document: XML evidence includes published textual fields, PLACET evidence includes CSV values, and web evidence includes metadata and at most 24,000 characters of extracted page text. The model receives at most 45 distinct passages of 15–650 characters. Consult the original source for complete conditions and PDF attachments.

### Electricity estimate

The deterministic calculator follows [Portale Offerte calculation rules v4.0, sections 3.1.1–3.1.6](https://www.ilportaleofferte.it/portaleOfferte/resources/cms/documents/7d0a872b48e8796c84366afedd2ce7ec.pdf), using the post-April-2026 domestic dispatch formula. It includes seller energy and fixed fee, commercialization, dispatch, network, system levies, excise and VAT. Regulated values are discovered from the current PLACET parameter CSV, retained with publication/retrieval dates, and held constant across the 12-month estimate. Uniform annual consumption is assumed. The default F1 share of 33% applies only to bioraria and is editable.

Only active domestic fixed PLACET offers with recognized simulated offer codes and complete prices qualify. Contract tariff selection follows [ARERA 135/2022, article 1](https://www.arera.it/fileadmin/allegati/docs/22/135-22ti.pdf); mono/bio columns are never summed or used interchangeably. Territorial restrictions, unsupported codes, missing prices and stale data exclude an offer. Parameters must be complete, retrieved within 24 hours and published in the current quarter. A failed parameter fetch preserves the offer catalog with an explicit calculation warning; old cache payloads remain readable and trigger refresh.

This is a subset ranking, not a claim about the cheapest offer across the market. Bonus, TV licence fee, deposits and activation costs are excluded. Estimates are not guaranteed bills; confirm eligibility and conditions with the official source. Variable energy estimates are not provided: official open data explicitly exclude the forward quotations used by the portal. Gas estimation remains unimplemented.

Snapshots are stored locally in `%LOCALAPPDATA%/it.onlybollette.desktop/offers.sqlite`. Opening a category refreshes missing sources, snapshots older than 24 hours, legacy AI evidence or missing electricity parameters; manual refresh is always available. While a refresh is active, a modal blocks the offer UI until all sources finish or cancellation is confirmed. It shows the number of completed sources without implying a byte percentage. Saved offers and any source warnings become usable when the refresh ends. There is no periodic refresh of a category left open.

The frontend retrieves configured source names from the native `source_names(category)` command. Cache completeness is checked by source identity, and the refresh total uses that same inventory; an older two-source Internet cache cannot satisfy the current ten-source catalog.

A fully failed source refresh keeps the previous snapshot and shows a warning in the current category session. This failure is not persisted; reopening the category reloads the previous successful snapshot. While a category stays open, stale labels are reevaluated every minute and when the window regains focus; refreshing offers remains manual. A partially readable web catalog replaces the old snapshot with the acquired products and displays a partial-catalog warning, which is stored with that snapshot. Missing pages are not silently merged with older offers.

Offers are hidden when a recognized expiry date has passed. Electricity/gas dates are parsed from their feeds; web expiry is recognized only from supported Iliad metadata. Other products with unknown expiry remain visible and require confirmation on the official site. Model weights live in the adjacent `models` directory; the ready indicator and engine startup require a matching pinned SHA-256 digest. A repair action is available in AI settings.

The app downloads public pages and model weights. It sends no offer text or personal profile to an AI cloud service. The model server binds only to loopback, uses a per-process credential and is stopped when the app exits. Model files and cache are user data, separate from the installer.

## Development

Prerequisites: Node.js 24 LTS, PowerShell 7, Rust stable MSVC, Visual Studio C++ Build Tools and WebView2. The Rust toolchain installed during initial setup did not modify PATH; in a new shell use:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm ci
npm run prepare:runtime
npm run desktop
```

`npm run dev` is a web-only UI preview. It deliberately does not fake offers or AI when Tauri IPC is unavailable.

`ONLYBOLLETTE_DATA_DIR` optionally overrides the native application's data directory; it must be an absolute path. It redirects both SQLite and model storage. Leave it unset for normal use. The native verification script sets it to a unique workspace scratch directory and removes that directory after closing its own process. No SQLite migration is required for the added JSON provenance/partial-catalog fields; older payloads remain readable.

```powershell
npm run build
npm test
npx playwright test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm audit
npm run package
```

`prepare:runtime` retrieves pinned llama.cpp b10982 CPU/Vulkan archives, checks their SHA-256 hashes and extracts them into the ignored resource directory. It requires internet. Tauri packages the runtimes and third-party license notices; weights remain a separate first-use download.

To build the Windows installer from PowerShell 7, run `pwsh -NoProfile -File scripts/build-installer.ps1` from the project root. The script installs npm dependencies and prepares the pinned runtime when missing, then prints the generated NSIS `.exe` path.

## Live verification

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example verify-sources
cargo run --manifest-path src-tauri/Cargo.toml --example verify-providers -- internet
cargo run --manifest-path src-tauri/Cargo.toml --example verify-ai
cargo run --manifest-path src-tauri/Cargo.toml --example verify-download
cargo run --manifest-path src-tauri/Cargo.toml --example verify-document -- PATH_TO_PDF_OR_IMAGE EXPECTED_TEXT
node scripts/verify-document-desktop.mjs PATH_TO_PDF EXPECTED_TEXT
node scripts/verify-document-layout.mjs
cargo build --manifest-path src-tauri/Cargo.toml --bin onlybollette
node scripts/verify-desktop.mjs
pwsh -NoProfile -File scripts/verify-source-values.ps1
```

`verify-desktop` launches and owns a native process with an isolated data directory and WebView2 profile. Before searching it checks the directory reported by `model_status`; older binaries without isolation support are rejected. It uses real Tauri IPC, requires a fresh successful snapshot from every configured source, rejects partial catalogs and calculation errors, and saves evidence under ignored `test-results`. A source outage fails the live test; existing cache cannot make it pass. Its optional first argument is the executable path; by default it tests the debug build.

To include real AI inference, set `ONLYBOLLETTE_TEST_MODEL` to the absolute path of an existing GGUF. The script copies it into the isolated directory, verifies it through the application's normal checksum path and deletes the copy after closing the app. The original model and normal user database are not modified. Without this variable, the report explicitly marks inference as not run. Browser tests use `test-results/browser` and preserve native evidence.

`verify-sources` fails if any configured source fails, yields no offers, returns a partial catalog or lacks electricity parameters. It accepts category names (for example `--example verify-sources -- luce gas`) and `--inspect URL` for a read-only page inspection. `verify-source-values` requires the snapshots produced by `verify-desktop` and compares 40 market-free records against their original XML.

`verify-providers` exercises the native directory path for all categories, or only the named categories after `--`. It exits non-zero if a register cannot be read. A register result never establishes an available offer.

`verify-ai` downloads/verifies its model under `test-results/ai-data`, never the normal user data directory. This test may download 1.4 GB and retains that dedicated model for later runs. `--runtime-root PATH` selects a runtime directory; a directory containing only the CPU runtime exercises fallback. `verify-download` reads the normal installed model into an isolated partial copy, verifies cancellation before and during a real HTTP transfer, then Range resume and SHA-256 integrity. It cleans its own copy.

Source availability and offer counts change. Details of the local acceptance run and remaining limitations are in [docs/VERIFICATION.md](docs/VERIFICATION.md). Open verification work is tracked in [PROJECT_STATUS.json](PROJECT_STATUS.json). Third-party licensing is recorded in [docs/THIRD-PARTY-NOTICES.md](docs/THIRD-PARTY-NOTICES.md).
