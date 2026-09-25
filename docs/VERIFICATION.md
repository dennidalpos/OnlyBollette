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
- The focused parser regression checks card-specific prices and rejects an ambiguous `da` price as a partial catalog. Other Vodafone terms and variants remain in `SOURCE-VODAFONE-TERMS`.

### 1Mobile scoped mobile adapter — 25 September 2026

- The official [Start XPlus Reward page](https://www.unomobile.it/offerte/start-xplus-reward) returned HTTP 200. `cargo run --quiet --manifest-path src-tauri/Cargo.toml --example verify-sources -- --source 1Mobile internet` acquired one offer in 0.2 seconds. The published initial 4.99 €/month, 4.49 € from the third consecutive renewal, porting-dependent 5 € activation (10 € for a new number), and 30 September subscription deadline remain distinct. The adapter does not calculate a first-year total or infer twelve-month price applicability.
- The source-specific regression covers the encoded note, price disagreement and missing porting condition. A separate cache URL regression covers 1Mobile and Vodafone. The first installed Internet check exposed that both offers were discarded when loading cached snapshots because their product URLs were absent from the cache allowlist. After the fix, a rebuilt and silently installed NSIS package passed `node scripts/verify-desktop.mjs <installed-exe> Internet`: 15 sources and 60 offers loaded and refreshed, including both Vodafone cards and the 1Mobile card, with no source warning or partial catalog. Other 1Mobile products are outside this adapter.
- Final checks after the cache fix: all 33 Rust library tests, strict Clippy, `cargo fmt --check`, `node --check` for both desktop verification scripts, the installer build and the focused installed Internet run passed.

### ho. home data adapter — 25 September 2026

- The official [ho. home Internet page](https://www.ho-mobile.it/offer-home) returned HTTP 200. `cargo run --quiet --manifest-path src-tauri/Cargo.toml --example verify-sources -- --source ho. internet` acquired two cards in 0.3 seconds: 14.95 €/month for new customers and 12.95 €/month for eligible ho. customers. The first live check exposed a selector that read 14.95 € for both cards; a DOM-shaped regression fixture and narrowed selector corrected it. Activation, first recharge, and separately purchased router are kept outside the monthly price; no annual total is inferred.
- The NSIS installer was rebuilt and silently installed. `node scripts/verify-desktop.mjs <installed-exe> Internet` passed with 16 complete sources and 62 offers, including both ho. cards, both Vodafone cards and the 1Mobile card after cache loading and refresh. There were no source warnings or page errors at this checkpoint. Other ho. products remain in `SOURCE-INTERNET-OTHER-VARIANTS`; spusu was added in the later check below.
- Final checks: 34 Rust library tests, strict Clippy, `cargo fmt --check`, syntax checks for both desktop verification scripts, frontend production build and `git diff --check` passed.

### spusu public mobile catalog — 25 September 2026

- The official [spusu homepage](https://www.spusu.it/) and its public `imoscmsapi/config/landingpageitems` endpoint returned HTTP 200. Three linked product pages also returned HTTP 200. The adapter reads only the three current homepage cards: spusu 1 at 3.98 €/month, spusu 150 XL at 5.98 €/month, and spusu 200 XL 5G at 7.89 €/month. It requires matching prepaid monthly euro fees and positive included data. The published `30/09` subscription note for two cards is kept separate from twelve-month price validity; activation and annual totals are not inferred.
- Baseline: 17 focused Rust source tests passed. After the change, 18 focused source tests, all 35 Rust library tests, strict Clippy, Cargo formatting, live source acquisition, installer build and silent installation passed. The first installed Internet check reached 17 sources but failed because its expected-source inventory still listed 16; after updating that assertion, `node scripts/verify-desktop.mjs <installed-exe> Internet` passed with 17 complete sources and 65 offers after cache loading and refresh, including all three spusu cards. No source warnings or page errors remained. The selected-source breadth task is closed; additional variants remain in `SOURCE-INTERNET-OTHER-VARIANTS`.
- A visible Vodafone Casa Ultra card was investigated but its structured product data marks it as hidden from the hub. Two trial additions caused a strict partial-catalog failure and were reverted. The HTTP HTML contains no visible Ultra text because the site renders it in the browser. Vodafone's [14 September contract summary](https://myvfapp-aem.vodafone.it/content/dam/myvf/mva10/cce-pdf/Casa_Ultra.pdf) confirms 36.95 €/month; its [current support page](https://www.vodafone.it/privati/area-supporto/contratti-aggiornamenti/condizioni-generali-reti-servizi/tariffe/contratti-attivabili/casa-ultra.html) links a tariff prospectus scoped to FTTH/FTTC. Live parsing and technology-specific activation remain in `SOURCE-VODAFONE-TERMS`.

The native `verify-document` executable also rejected a missing file, an artificial corrupt PNG and an artificial corrupt PDF with exit code 1 and the expected localized errors. The temporary invalid fixtures were removed after this check.

Run these commands to verify the codebase against baseline:

```powershell
# Frontend unit tests
npm test

# Production build type-check and bundling
npm run build

# UI and workflow tests via Playwright (16 tests)
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
