# Verification evidence

Windows checks on 23 September 2026; Intel i7-10700, 32 GB RAM, NVIDIA RTX 2070. These are local observations, not minimum-hardware benchmarks.

## Blocking offer refresh

- `npm run build`, `npm test` (22/22) and `npx playwright test` (6/6) passed. The browser lifecycle test uses a test-only native IPC simulation: source progress keeps the offer UI inert, and it unlocks only after the final event, confirmed cancellation or a command error. The 420 px modal layout was inspected visually.
- `pwsh -NoProfile -File scripts/build-installer.ps1` produced a fresh NSIS package. The release linker emitted only the existing `linker_messages` warning about the import library path.
- Native refresh timing and cancellation were not exercised in an installed app with live sources for this change.

## Offer filters and provenance UI

- `npm run build`, `npm test` (22/22) and `npx playwright test` (5/5) passed after the multi-select energy filters, sorting, colored type badges and source-status explanations. The browser checks include multi-selection, reset and a 420 px layout; browser preview cannot load native offers.
- `pwsh -NoProfile -File scripts/build-installer.ps1` produced the updated NSIS installer. This package has not been installed or exercised with live offers. Source status in the UI describes acquisition freshness and catalog completeness, not independent verification of price or eligibility.

## Follow-up on 23 September 2026

- The price-range and compact-layout change passed `npm run build`, 23 frontend unit tests and seven Playwright tests. The UI checks cover the 720×600 and 420×600 home layout, horizontal overflow at 320–1024 px, price input validation, and filter menu bounds at 320–1024 px. The new native provider code passed 21 Rust unit tests; the current package has not been installed for this change.
- A live native directory read returned 734 ARERA electricity sellers and 634 gas sellers. The AGCOM native request then failed after its 45-second timeout, so the combined live check failed. The AGCOM public endpoint had earlier returned 7,220 registration records, including 3,144 without a cessation date, through PowerShell. The official IVASS CSV archive contained 82 supervised companies, 80 with a website; its parser passed a focused unit test. None of these registries is an offer catalog.

- A later `cargo run --manifest-path src-tauri/Cargo.toml --example verify-sources -- assicurazioni` check exited 1: Bene returned 7 complete offers; Allianz returned 2 offers with `PARTIAL`. A subsequent read of the official Allianz catalog through the same native fetch path returned HTTP 403. The Allianz source remains open work; neither a partial catalog nor the earlier successful refresh proves current availability.
- The remaining installer and real-disconnection checks need an isolated Windows test environment, and Portale Offerte parity needs a consenting test profile and matching portal result. None was available in this follow-up. The exact leftover `.scratch/desktop-check-j13DSt` directory was confirmed to be an ordinary directory without reparse points, but automatic approval review blocked the targeted recursive cleanup before execution; it still exists.
- The native verifier now force-stops only the app process it started and preserves the primary assertion when cleanup also fails. A release-binary run passed all four categories with fresh snapshots, including Allianz, and removed its scratch directory. A later run with a read-only copy of the installed model selected three validated AI passages in 58.6 seconds, then failed because Allianz returned HTTP 403. Its scratch directory was removed and the terminal reported the original source assertion. Allianz access is intermittent; the full AI run is not a passing all-source check.
- `verify-source-values.ps1` independently matched 40 current energy offers to the official XML. The download example passed pre-cancel, active-transfer cancel with new bytes retained, HTTP Range resume, and final SHA-256 validation using an isolated copy of the installed model.
- The updated dark/light interface passed four browser tests; the current NSIS package builds but remains uninstalled in this follow-up. The earlier failed verifier left `.scratch/desktop-check-j13DSt`; automatic approval review rejected recursive removal. Open residues are in `PROJECT_STATUS.json`.

## Audit corrections

- Baseline: 18 Rust tests and 19 frontend tests passed before edits.
- After corrections: 20 Rust tests, 19 frontend tests and 3 browser tests passed. Rust coverage verifies that AI evidence excludes application annotations, legacy snapshots cannot supply AI evidence, PLACET evidence is deterministic, and source redirects remain on the original HTTPS host. Product parsing checks that generated warnings are absent from AI evidence.
- TypeScript/Vite build and Clippy with `-D warnings` passed during implementation. Browser output is isolated under `test-results/browser`, preserving native evidence.
- Native verification now creates a unique scratch data directory, checks that the executable actually uses it before searching, and copies an explicitly supplied model. It rejects failed/partial sources, missing electricity parameters and snapshot timestamps preceding the refresh. These assertions replace the former cache-presence check.
- The earlier desktop timeout was caused by Vite watching the `.scratch` WebView2 profile: its file watcher failed with `EBUSY` on the locked `Cookies` database. Vite now excludes `.scratch` and `test-results`; an isolated native startup diagnostic displayed the home screen and retained its Vite connection.
- A subsequent isolated desktop run passed the data-directory handshake, electricity, gas, internet, electricity estimate, and local AI inference. It loaded 2,384 electricity offers, 2,054 gas offers, 13 internet offers, and 18 insurance products; AI selected three validated passages in 9.6 seconds. Independent verification matched 40 electricity/gas records to the current official XML. The **full run still failed** when a manual Allianz insurance refresh returned HTTP 403. The app retained the earlier snapshot and displayed the source warning, but the strict live test correctly rejected that refresh. Cleanup then timed out and masked the source error; the follow-up above records its correction and rerun.
- The TypeScript/Vite build, Clippy with `-D warnings`, and a new NSIS package completed after these changes. The new installer has not been installed or exercised end to end.
- A current `npm audit --audit-level=low` reported zero known npm vulnerabilities.

Failure details are saved in ignored `test-results/desktop-verification.json`. Do not treat the successful earlier categories or a cached Allianz snapshot as a passing full live run.

## Historical evidence before audit corrections

The installed-app run at **2026-09-23T13:34:43.129Z**, before the provenance and test-isolation changes, displayed 2,384 electricity offers, 2,054 gas offers, 13 internet offers and 18 insurance products. Cached lists appeared in 58–300 ms and cached AI highlights in 145 ms. The script then checked cached offers after refresh; this evidence does **not** independently establish success of every online refresh. It is not acceptance evidence for the corrected implementation.

That electricity-estimator run independently compared 236 fixed PLACET records and 100 parameter values with original CSVs. For 2,700 kWh/year, 3 kW, resident, it displayed 38 monoraria offers and 176 bioraria offers at 33% F1. The first monoraria total was 1,067.97 EUR; a separate arithmetic reconstruction yielded 1,067.96745 EUR. The existing snapshot was recalculated during the read-only audit with the same result. Exact parity with a personalized Portale Offerte web result remains unverified.

Other earlier checks:

- 40 market-free records matched original XML names, domestic classification and numeric component amounts.
- Qwen inference returned three validated passages on Vulkan in 8.9 seconds and on CPU in 27.1 seconds. This predates the source-only evidence correction.
- Download verification checked a pre-cancelled request preserving an existing partial copy, followed by an actual HTTP Range resume and expected SHA-256. It did not interrupt an in-progress transfer.
- npm audit reported zero vulnerabilities after the Vitest 4.1.11 update. This is historical npm output, not a current full security review.
- The 18,816,539-byte NSIS installer installed with exit code 0. That installer predates the audit corrections; it has not been regenerated or reinstalled as part of these checks.

## Boundaries

- Annual electricity estimates cover only supported domestic fixed PLACET offers without geographic restrictions, holding current official regulated parameters constant for 12 months. General-market/indexed electricity, gas, bonuses, activation costs and profile-specific eligibility remain outside the estimator. There is no full-market personalized ranking.
- Annual internet costs cover recognized permanent Iliad mobile plans with explicit SIM activation. Insurance quotations and broadband address coverage remain external.
- Unknown expiry dates remain visible. Automatic refresh is evaluated when entering a category, not periodically while it stays open. Failed-refresh warnings last only for the current category session; partial catalogs replace the old snapshot and persist a partial warning.
- Windows 10, 8 GB hardware and full native network-disconnection behavior remain unverified. The installer is unsigned.
- Literal AI validation checks normalized acquired text, not completeness or importance of the selected passages. Refer to README.md for extraction limits and model/test data locations.
