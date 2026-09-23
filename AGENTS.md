# OnlyBollette

Windows x64 app for Italian household offers. UI is Italian; code/docs are English. Never replace live retrieval with demo offers.

- Runtime truth is `src-tauri/src`; React uses Tauri IPC. Web preview reports unavailable native capabilities.
- Discover energy XML/CSV from the current Portale Offerte page, never date-derived URLs. Retain source, retrieval time, validity and price components.
- The separate directory reads ARERA sellers, AGCOM registrations and IVASS supervised-company sites on demand. Registration is not an offer; failures retain the official link.
- Index spreads are not energy prices; missing prices are not zero. `src/electricity.ts` estimates only supported fixed domestic PLACET electricity with current official parameters. Never call it whole-market ranking; use the portal for other energy estimates. Insurance needs a personal quote.
- AI uses only source text with `evidenceVersion=1`, excluding app annotations; legacy evidence needs refresh. Summary keys include provenance version. No AI-generated prices or external AI API. Runtime archives and GGUF revision/hash are pinned.
- `npm run prepare:runtime` generates ignored binaries. Do not commit weights, archives, caches or test evidence. User data stays app-local.
- On this machine Rust is installed under `$env:USERPROFILE\.cargo\bin` without persistent PATH modification.
- `ONLYBOLLETTE_DATA_DIR` must be absolute and redirects database/models. Native checks use isolated scratch data; `ONLYBOLLETTE_TEST_MODEL` supplies a read-only AI test original. Vite must ignore `.scratch` and `test-results`: locked WebView2 files crash its watcher.

Verified commands: `npm run build`, `npm test`, `npx playwright test`, `npm run package`, `pwsh -NoProfile -File scripts/build-installer.ps1`, `npm audit`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `pwsh -NoProfile -File scripts/verify-source-values.ps1`. Native checks may hit intermittent Allianz HTTP 403. Open work is in `PROJECT_STATUS.json`.

Live checks fail on any failed/partial source or missing calculation parameters; do not bypass access challenges. Failed-refresh warnings are session-only; partial web catalogs replace snapshots and retain their warning. AI checks may download 1.4 GB into dedicated test data.
