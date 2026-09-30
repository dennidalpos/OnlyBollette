# Verification & Quality Assurance

This document details the test suites, verification scripts, native diagnostic tools, and operational boundaries for OnlyBollette.

## Acceptance evidence — 24–25 September 2026

- Baseline before OCR integration: 51 frontend tests, 24 Rust tests and frontend build passed. After integration: 51 frontend tests, 30 Rust tests, all 16 browser cases, build and Clippy passed. On 25 September, the corrected OCR path passed native synthetic layout, all 30 Rust tests and Clippy again. Existing unrelated changes were preserved.
- `prepare-ocr.ps1` built official Tesseract 5.5.3 with statically linked dependencies from pinned vcpkg; the vcpkg Tesseract port itself was older and was not used. The approximately 14 MB bundle includes the Italian best model and licenses. `dumpbin /dependents` showed only KERNEL32.dll. Resource integrity/version/language checks passed, and an isolated corrupted-model copy was correctly rejected by packaging preflight.
- Native synthetic OCR passed columns, compact first-row units, eight-decimal prices beginning with zero, missing-unit rejection, provenance and comparison gating. The original eleven-page PDF was read without writing text/images: both energy unit periods and annual usage were recovered. `DOCUMENT-COMPONENT-OCR-GAPS` was removed. The printed-expiry issue was resolved in the follow-up verification below; true native-job cancellation remains open.
- Installed retrieval on 24 September passed 2,375 electricity, 2,053 gas and 57 Internet offers. All thirteen Internet sources completed and refreshed, including three Kiara and six Enel offers that survived cache loading. Kiara starting prices remain textual; Enel promotional prices and conditions are card-specific. Internet first result took 1.39 seconds; the complete refresh took about ten seconds. The earlier 90-second stalls did not recur; their root cause remains unconfirmed. Request timings and source completion events are retained under ignored `test-results`.
- The all-category installed check failed at insurance because Allianz returned HTTP 403; Bene returned seven offers. This is not a passing full acceptance run. No access challenge was bypassed and no unchanged full-run retry was used.
- On 25 September, `node scripts/verify-native-recovery.mjs <installed-exe>` passed complete live seed, process-only connection failure, unchanged cached snapshots, session-only failed-refresh warnings, cancellation during unavailable transport, real partial Kena acquisition (one offer), persisted partial warning after reopening, and complete recovery. It relayed original TLS traffic and interrupted actual transfers without changing the machine network or synthesizing offer bodies. This closes `INSTALLER-FAILURE-RECOVERY` and the process-isolated network-disconnection verification. Evidence: `test-results/native-recovery.json`.
- Installed OCR initially failed although the bundled executable worked directly. The failure was reproduced by passing a Windows extended `\\?\` path as Tesseract's model directory. The fix sets the child working directory to the bundled OCR folder and uses relative `tessdata`. The CLI verifier now canonicalizes the runtime and runs a worker thread, covering that path in native regression checks.
- Automatic approval review rejected scoped cleanup of `.scratch/ocr-build` and `.scratch/source-review` with `blocked by policy`. They remain tracked alongside the three previously blocked directories. On 25 September, deletion of the single artificial `.scratch/installed-ocr-synthetic.png` was also rejected with `blocked by policy`; it remains tracked. No rejected deletion was retried through another mechanism.

- Final 25 September acceptance: `pwsh -NoProfile -File scripts/build-installer.ps1` rebuilt the NSIS installer successfully; silent installation exited zero. `node scripts/verify-ocr-runtime.mjs <installed-ocr-directory>` passed integrity, version and Italian-language checks. `node scripts/verify-document-desktop.mjs <file> Corrispettivo <installed-exe>` passed separately for the artificial image (one page) and original PDF (eleven pages), without an offer database or downloaded model. OCR text and images remained in memory; original files were not modified. `OCR-BUNDLE-INSTALLER-ACCEPTANCE` is closed. Final frontend tests (51), Rust tests (30), browser regressions (16), Clippy and native layout checks all passed. The actual native picker and all-category live acceptance remain open for their separately tracked prerequisites.

## Automated Verification Suite

### Printed economic expiry follow-up — 25 September 2026

- Root cause: OCR already recognized `Validità condizioni economiche: dal ... al ...` in the original page 2, but the document parser accepted only the older printed-expiry wording. The change reads the range's end as `validCurrent` with page/document provenance and `confirmed: false`; it does not set future `applicableFromCurrent` or `applicableUntilCurrent`.
- Baseline: 12 focused energy tests and native layout OCR passed. After the change, 16 focused document-comparison tests, the native OCR layout check with a new artificial validity-range image, all 52 frontend tests, eight focused browser regressions and `npm run build` passed. The read-only original eleven-page PDF yielded the printed economic end date from page 2; the assertion compared it to the OCR row without logging document text or the date. No future applicable period was inferred.
- `pwsh -NoProfile -File scripts/build-installer.ps1` produced a new NSIS installer; silent installation exited zero and the installed OCR resource integrity check passed. `DOCUMENT-PRINTED-EXPIRY-OCR` is closed. Current terms and candidate economic conditions remain necessary for a real comparison; native OCR cancellation remains separate.

### Native OCR cancellation — 25 September 2026

- `DOCUMENT-OCR-CANCELLATION` is closed. Document analysis now has a scoped request ID and cancellation token. Clearing, replacing or leaving the comparison cancels the native job; the active Tesseract child is killed and reaped, and PDF analysis stops before the next page. The existing UI epoch check still rejects late results.
- Baseline: four focused Rust document tests passed. After the change, 52 frontend tests, 30 Rust tests, production frontend build, strict Clippy and the focused browser regression passed. The browser regression checks that clearing an active read sends `cancel_document` and discards its late result.
- A read-only local eleven-page PDF was used with `verify-document-cancellation`. Active analysis returned `Operazione annullata`, and a Windows process inventory found no Tesseract child remaining under the verifier PID. Neither OCR text nor the document path was printed. This verifies the native worker and process cleanup; the actual native picker remains separately unverified.

### Vodafone public catalog adapter — 25 September 2026

- The official [Vodafone home Internet catalog](https://privati.vodafone.it/casa/fibra) returned HTTP 200 to the native machine. `cargo run --quiet --manifest-path src-tauri/Cargo.toml --example verify-sources -- --source Vodafone internet` acquired two complete public cards in 1.2 seconds: Casa Start at 27.95 €/month and Casa Pro at 29.95 €/month. The catalog card JSON states monthly recurrence. Activation indications differ within the public page, so the app asks users to verify the applicable amount. The adapter does not calculate annual totals or infer activation, coverage, technology or eligibility.
- The focused parser regression checks card-specific prices and rejects an ambiguous `da` price as a partial catalog. Casa Ultra was added in the later prospectus check below.

### 1Mobile scoped mobile adapter — 25 September 2026

- The official [Start XPlus Reward page](https://www.unomobile.it/offerte/start-xplus-reward) returned HTTP 200. `cargo run --quiet --manifest-path src-tauri/Cargo.toml --example verify-sources -- --source 1Mobile internet` acquired one offer in 0.2 seconds. The published initial 4.99 €/month, 4.49 € from the third consecutive renewal, porting-dependent 5 € activation (10 € for a new number), and 30 September subscription deadline remain distinct. The adapter does not calculate a first-year total or infer twelve-month price applicability.
- The source-specific regression covers the encoded note, price disagreement and missing porting condition. A separate cache URL regression covers 1Mobile and Vodafone. The first installed Internet check exposed that both offers were discarded when loading cached snapshots because their product URLs were absent from the cache allowlist. After the fix, a rebuilt and silently installed NSIS package passed `node scripts/verify-desktop.mjs <installed-exe> Internet`: 15 sources and 60 offers loaded and refreshed, including both Vodafone cards and the 1Mobile card, with no source warning or partial catalog. Other 1Mobile products are outside this adapter.
- Final checks after the cache fix: all 33 Rust library tests, strict Clippy, `cargo fmt --check`, `node --check` for both desktop verification scripts, the installer build and the focused installed Internet run passed.

### ho. home data adapter — 25 September 2026

- The official [ho. home Internet page](https://www.ho-mobile.it/offer-home) returned HTTP 200. `cargo run --quiet --manifest-path src-tauri/Cargo.toml --example verify-sources -- --source ho. internet` acquired two cards in 0.3 seconds: 14.95 €/month for new customers and 12.95 €/month for eligible ho. customers. The first live check exposed a selector that read 14.95 € for both cards; a DOM-shaped regression fixture and narrowed selector corrected it. Activation, first recharge, and separately purchased router are kept outside the monthly price; no annual total is inferred.
- The NSIS installer was rebuilt and silently installed. `node scripts/verify-desktop.mjs <installed-exe> Internet` passed with 16 complete sources and 62 offers, including both ho. cards, both Vodafone cards and the 1Mobile card after cache loading and refresh. There were no source warnings or page errors at this checkpoint. Further variants were added in the later check below.
- Final checks: 34 Rust library tests, strict Clippy, `cargo fmt --check`, syntax checks for both desktop verification scripts, frontend production build and `git diff --check` passed.

### spusu public mobile catalog — 25 September 2026

- The official [spusu homepage](https://www.spusu.it/) and its public `imoscmsapi/config/landingpageitems` endpoint returned HTTP 200. Three linked product pages also returned HTTP 200. The adapter reads only the three current homepage cards: spusu 1 at 3.98 €/month, spusu 150 XL at 5.98 €/month, and spusu 200 XL 5G at 7.89 €/month. It requires matching prepaid monthly euro fees and positive included data. The published `30/09` subscription note for two cards is kept separate from twelve-month price validity; activation and annual totals are not inferred.
- Baseline: 17 focused Rust source tests passed. After the change, 18 focused source tests, all 35 Rust library tests, strict Clippy, Cargo formatting, live source acquisition, installer build and silent installation passed. The first installed Internet check reached 17 sources but failed because its expected-source inventory still listed 16; after updating that assertion, `node scripts/verify-desktop.mjs <installed-exe> Internet` passed with 17 complete sources and 65 offers after cache loading and refresh, including all three spusu cards. No source warnings or page errors remained. The selected-source breadth task is closed; further variants were reviewed in the check below.
- A visible Vodafone Casa Ultra card was investigated but its structured product data marks it as hidden from the hub. Two trial additions caused a strict partial-catalog failure and were reverted. The HTTP HTML contains no visible Ultra text because the site renders it in the browser. Vodafone's [14 September contract summary](https://myvfapp-aem.vodafone.it/content/dam/myvf/mva10/cce-pdf/Casa_Ultra.pdf) confirms 36.95 €/month; its [current support page](https://www.vodafone.it/privati/area-supporto/contratti-aggiornamenti/condizioni-generali-reti-servizi/tariffe/contratti-attivabili/casa-ultra.html) links a tariff prospectus scoped to FTTH/FTTC. The live prospectus path and activation check were added below.

### ho. and 1Mobile mobile variants — 25 September 2026

- The official [ho. catalog](https://www.ho-mobile.it/tutte-le-offerte) exposes four distinct 5G cards: 150 GB at 6.95 and 9.95 €/month, and 250 GB at 8.95 and 11.95 €/month. Their 2.99 € starting activation applies only to some porting operators. These cards are added to the two existing [home data variants](https://www.ho-mobile.it/offer-home), with separate catalog provenance and no annual estimate.
- The official 1Mobile [Speed 5G 180](https://www.unomobile.it/offerte/speed-5g-180) and [Speed 5G 250](https://www.unomobile.it/offerte/speed-5g-250) pages each show 5 € for the first month, then 6.99 € and 7.99 € respectively from the second month. Free activation requires porting; a new SIM costs 5 €. The 30 September subscription deadline is retained separately from twelve-month price applicability. Start XPlus Reward remains in the source.
- Before editing, 18 focused Rust source tests passed; afterward, 20 focused source tests and all 37 Rust library tests passed. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, Cargo formatting and `npm run build` passed. Live `verify-sources` runs returned six ho. and three 1Mobile offers. If an additional page fails, acquired offers remain visible with an explicit partial-catalog warning. `pwsh -NoProfile -File scripts/build-installer.ps1` built the NSIS installer; silent installation exited zero. `node scripts/verify-desktop.mjs <installed-exe> Internet` passed cache loading and live refresh with 17 complete sources and 71 offers, no source warnings or partial catalogs; first result took 0.90 seconds. Other 1Mobile products and Casa Ultra were reviewed in later checks below; challenged catalogs remain tracked.

### Further 1Mobile homepage cards — 26 September 2026

- The official [1Mobile homepage](https://www.unomobile.it/) showed six selected cards. The individual [Flash 120](https://www.unomobile.it/offerte/flash-120), [World Plus 5G](https://www.unomobile.it/offerte/world-plus-5g) and [Flash 5G 320 Limited Edition](https://www.unomobile.it/offerte/flash-5g-320-lim-edition) pages returned HTTP 200 with published, readable product bundles. Flash 120 states 5.99 €/month and 4 € activation for a new SIM. World Plus states 9.99 €/month, 5 € new-SIM activation and 20 GB extra from the third consecutive renewal; its overview and note differ on new-number eligibility, so the offer asks for verification. Flash 320 states 4.99 € for the first month, 8.99 € from the second, a credit for one month after the first renewal, and 10 € new-SIM activation. The credit is conditional, not subtracted from an annual estimate. All three pages listed 30 September for subscription conditions, not twelve-month price validity. At this checkpoint, the [all-offers page](https://www.unomobile.it/offerte/per-tutti) showed client-rendered placeholders; its server-rendered inventory was reviewed in the later check below.
- Baseline: 20 focused Rust source tests passed. After the addition, the focused parser regression and all 38 Rust library tests passed, as did strict Clippy, Cargo formatting, frontend production build and desktop script syntax. `cargo run --quiet --manifest-path src-tauri/Cargo.toml --example verify-sources -- --source 1Mobile internet` returned six complete offers. `pwsh -NoProfile -File scripts/build-installer.ps1` built a new NSIS installer. `node scripts/verify-desktop.mjs src-tauri/target/release/onlybollette.exe Internet` passed cache loading and live refresh with 17 complete sources and 74 offers, including all six 1Mobile cards, with no source warning or partial catalog; first result took 0.894 seconds. The packaged release executable was tested; this run did not silently install the bundle. The verifier removed its own scratch directory.
- A direct native request to WINDTRE's public homepage returned a Radware Block Page; no challenge was bypassed. Very's public homepage returned product links and prices. Its [5.99 € product page](https://www.verymobile.it/offerte/very-599-all) exposed visible pricing but had a stale JSON-LD `priceValidUntil` of 1 July 2026; variants and visible conditions still need review. The official [Vodafone Casa Ultra contract summary](https://myvfapp-aem.vodafone.it/content/dam/myvf/mva10/cce-pdf/Casa_Ultra.pdf) lists 36.95 €/month and a conditional mobile-line discount; the [support page](https://www.vodafone.it/privati/area-supporto/contratti-aggiornamenti/condizioni-generali-reti-servizi/tariffe/contratti-attivabili/casa-ultra.html) links an FTTH/FTTC tariff prospectus, which returned HTTP 200 to a native HEAD request. The live PDF adapter is verified below.

### Vodafone Casa Ultra prospectus — 26 September 2026

- The adapter discovers the current Casa Ultra PDF from Vodafone's official support page, downloads it with the bounded source client, and uses bundled OCR entirely in memory. It requires the support page's FTTH/FTTC scope and the prospectus name, technology, monthly price and zero-activation table for existing, new and porting customers. A changed or unreadable prospectus produces an explicit partial-catalog warning while retaining the two verified HTML cards. FWA and address eligibility are not inferred.
- Baseline: 21 focused Rust source tests passed. After the change, 39 Rust library tests, strict Clippy, Cargo formatting, frontend build and NSIS installer build passed. Live `verify-sources --source Vodafone internet` returned three complete offers, including Casa Ultra at 36.95 €/month. The first desktop check caught an outdated two-card verifier assertion; after updating it, `node scripts/verify-desktop.mjs src-tauri/target/release/onlybollette.exe Internet` passed cache loading and live refresh with 17 complete sources and 75 offers, no source warnings or page errors. First result took 1.399 seconds. This tested the packaged release executable, not a silent installation.

### 1Mobile full catalog and XConnect — 26 September 2026

- The official [all-offers page](https://www.unomobile.it/offerte/per-tutti) includes a server-rendered bundle inventory even though the visible cards are client-rendered. It listed the six previously supported offers plus [XConnect](https://www.unomobile.it/offerte/xconnect). The separate [XConnect prospectus](https://unomobile.it/files/4/8/1/7/b/5/xconnect.pdf) and [contract summary](https://unomobile.it/files/c/1/e/f/8/9/xconnect.pdf) confirm its IoT/domotica purpose, 1 GB, 100 minutes, 50 SMS, 2.50 €/month and 10 € service activation. The summary also lists a possible separate 10 € SIM charge. The product page gave a 30 September 2026 subscription deadline, which is not treated as twelve-month price validity.
- The adapter now checks the published all-offers inventory and reads XConnect's own page. New or unreadable variants produce a partial-catalog warning instead of being silently omitted. XConnect has an explicit IoT description and no annual cost estimate. Baseline: 22 focused Rust source tests passed. After the addition, all 40 Rust library tests, strict Clippy, Cargo formatting, frontend build and NSIS installer build passed. Live `verify-sources --source 1Mobile internet` returned seven complete offers in 0.9 seconds. The packaged release executable passed `node scripts/verify-desktop.mjs src-tauri/target/release/onlybollette.exe Internet`: 17 complete sources and 76 offers after cache loading and live refresh, no source warnings or page errors; first result took 0.394 seconds. This was not a silent installation.
- The app's native source client was redirected by Very to Radware validation; its same-host redirect policy rejected the transfer. The earlier WINDTRE native request received a Radware Block Page. Neither catalog was added through an access challenge; both remain tracked as access-dependent work. The `verify-sources --inspect` diagnostic now exits 1 with the source error instead of panicking on a blocked request.

The native `verify-document` executable also rejected a missing file, an artificial corrupt PNG and an artificial corrupt PDF with exit code 1 and the expected localized errors. The temporary invalid fixtures were removed after this check.

### Scratch cleanup and verification check — 29 September 2026

- With explicit user authorization, all five leftover directories (`.scratch/desktop-check-j13DSt`, `.scratch/bill-review-5dd5ea744af84a08ac2c1c2b932600bc` containing rendered bill pages, `.scratch/bill-native-CNZg5S`, `.scratch/ocr-build`, `.scratch/source-review`) and `.scratch/installed-ocr-synthetic.png` were permanently deleted. `.scratch` is now empty, resolving `SCRATCH-FAILED-RUN`.
- Baseline verification re-run: 40 Rust library tests, 52 frontend tests, 16 Playwright browser tests, frontend production build, strict Clippy and Cargo formatting passed with zero regressions.
- Live acquisition check via `cargo run --manifest-path src-tauri/Cargo.toml --example verify-sources -- internet` acquired all 76 offers across all 17 supported Internet sources without timeouts or errors.

### AI contract risk and clause analysis — 29 September 2026

- Added local AI-powered contract risk synthesis (`src-tauri/src/ai.rs`, `offer_contract_risks` IPC command). The engine extracts potential traps, penalties, lock-in terms, and hidden renewal costs with classified severity levels (*Alto*, *Medio*, *Basso*).
- Remote document ingestion: supports downloading connected contractual prospectuses (PDF) or web terms up to 15 MB in memory using `sources::fetch_bytes` and `documents::analyze_bytes`, without writing any document bytes, text, or OCR extracts to disk or logs. HTML parsing strips script, style, noscript, and svg tags to deliver clean contractual text.
- Full document scanning: `risk_passages` scans all sentences across multi-page documents to prioritize risk keywords without dropping clauses located beyond initial pages.
- Zero-hallucination guarantee: model outputs passage IDs mapped strictly to verbatim quotations verified against the original text (`evidence.contains(&quote)`). Any fabricated or hallucinated quote is immediately rejected by the validator. Markdown-fenced JSON responses are safely normalized.
- Non-conflicting caching: results are cached in the SQLite `summaries` table under scoped row IDs (`{offer_id}:risks`) and SHA-256 hashed evidence keys (`contract-risks-v1:{source_type}:{hash}`), preventing collisions with key-point highlights.
- Diagnostic CLI: `src-tauri/examples/verify-ai.rs` updated to execute and verify both key highlights and contract risks against live acquired offers.
- Verification results:
  - 45 Rust library tests passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib`), including unit tests for risk passage prioritization, deep document sentence scanning, schema resolution, markdown fences, and rejection of hallucinated quotes.
  - Strict Clippy passed with 0 warnings (`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`).
  - Cargo formatting check passed (`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`).
  - All 52 Vitest frontend tests passed (`npm test`).
  - Production TypeScript build passed (`npm run build`).
  - All 17 Playwright browser tests passed (`npx playwright test`), including the new automated test exercising the AI contract risk workflow, severity badges, and modal reset.

### NSIS setup package generation & OCR fixture DPI resolution — 29 September 2026

- `pwsh -NoProfile -File scripts/build-installer.ps1` built the official NSIS installer `src-tauri/target/release/bundle/nsis/OnlyBollette_0.1.0_x64-setup.exe` incorporating the new AI contract risk & clause analysis features.
- Silent installation (`OnlyBollette_0.1.0_x64-setup.exe /S`) verified clean deployment to `C:\Users\Utente\AppData\Local\OnlyBollette\onlybollette.exe`.
- Synthetic document generator (`scripts/create-document-fixture.ps1`) updated to explicitly set 96 DPI resolution (`$bitmap.SetResolution(96, 96)`), preventing column and text collisions on displays configured with custom scaling (e.g. 150% / 144 DPI).
- `node scripts/verify-document-layout.mjs` passed end-to-end: verified native OCR and frontend comparison, layout parsing, profile fields, multi-period component rows, repeated blocks, printed validity, and session-only memory isolation.


Run these commands to verify the codebase against baseline:

```powershell
# Frontend unit tests
npm test

# Production build type-check and bundling
npm run build

# UI and workflow tests via Playwright (17 tests)
npx playwright test

# Rust backend tests
cargo test --manifest-path src-tauri/Cargo.toml --lib


# Strict Rust linter
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# Package dependency audit
npm audit
```

## Native Verification Scripts

| Script | Purpose | Execution |
| --- | --- | --- |
| `verify-desktop.mjs` | Spawns a native app process with isolated scratch data (`ONLYBOLLETTE_DATA_DIR`). Exercises live offer acquisition, PLACET estimation, category isolation, search cancellation, and UI responsiveness. An optional category runs a focused live check. | `node scripts/verify-desktop.mjs [exe_path] [category]` |
| `verify-document-layout.mjs` | Verifies Tesseract OCR, word bounding box grouping, multi-column separation, and component table extraction using synthetic fixtures. Leaves no trace on disk. | `node scripts/verify-document-layout.mjs` |
| `verify-document-desktop.mjs` | Tests native document IPC and extraction within an isolated desktop app instance; rejects offer-database creation or model downloads. | `node scripts/verify-document-desktop.mjs <file> <expected_text> [exe_path]` |
| `verify-ocr-runtime.mjs` | Verifies resource inventory/checksums, executable version and Italian language availability. DLL imports were checked separately with `dumpbin /dependents`. | `node scripts/verify-ocr-runtime.mjs [ocr_directory]` |
| `verify-native-recovery.mjs` | Tests real TLS transfer interruption through a process-local CONNECT relay, persisted partial snapshots, failed-refresh warnings, cancellation and recovery. Does not change the machine network or synthesize offer responses. | `node scripts/verify-native-recovery.mjs [exe_path]` |
| `verify-source-values.ps1` | Independently validates 40 stored SQLite offer records against original official Portale Offerte XML feeds. | `pwsh -NoProfile -File scripts/verify-source-values.ps1` |
| `create-document-fixture.ps1` | Generates synthetic multi-column bill images for OCR layout and table testing. | `pwsh -NoProfile -File scripts/create-document-fixture.ps1` |

## Cargo Example Diagnostics

Targeted command-line verification tools are located in `src-tauri/examples`:

```powershell
# Verify live acquisition across all or specific categories
cargo run --manifest-path src-tauri/Cargo.toml --example verify-sources -- luce gas

# Verify official regulatory registry endpoints (ARERA, AGCOM, IVASS)
cargo run --manifest-path src-tauri/Cargo.toml --example verify-providers -- internet

# Test local AI engine startup, prompt inference, and quote validation
cargo run --manifest-path src-tauri/Cargo.toml --example verify-ai

# Verify model download resume, cancellation, and SHA-256 integrity
cargo run --manifest-path src-tauri/Cargo.toml --example verify-download

# Test OCR on a specific document without GUI
cargo run --manifest-path src-tauri/Cargo.toml --example verify-document -- path/to/doc.pdf "Expected text"
```

## Invariants & Test Boundaries

1. **Zero Data Leakage**: Document OCR and user profile data are never persisted to disk, SQLite, logs, or AI caches. Test scripts must remove any temporary fixtures immediately.
2. **Strict Live Checks**: Live retrieval tests fail if any configured source returns an error, an unparsed partial catalog, or missing electricity parameters. Cached data cannot mask a live network failure.
3. **Intermittent Allianz Access**: Allianz product catalog may intermittently return HTTP 403 on automated requests. The application displays this error gracefully; strict live tests record it as a source failure.
4. **Isolated AI Inference**: `ONLYBOLLETTE_TEST_MODEL` should point to a pre-existing GGUF model to avoid repeated 1.4 GB downloads during automated CI/verification runs.
5. **Vite File Watcher**: Scratch test directories (`.scratch` and `test-results`) are excluded from Vite's file watcher to prevent WebView2 database locks from crashing the dev server.
