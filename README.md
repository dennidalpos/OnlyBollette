# OnlyBollette

A Windows desktop application for Italian household energy, internet, and insurance offers. Built with Tauri 2, Rust, React, and TypeScript. Offline-first, privacy-respecting, with no account, cloud backend, or paid AI APIs.

## Key Features

- **Multi-Category Offer Browsing**: View active domestic electricity, gas, internet (16 official sources), and insurance offers. Filter by price type, duration, tariff, and payment methods.
- **Accurate Provenance Badges**: Every offer card displays acquisition status (*Acquisito in sessione*, *Salvato localmente*, *Non aggiornato*, or *Catalogo parziale*) and timestamps.
- **Deterministic Electricity Estimator (PLACET Fisso)**: In the **Luce** section, calculate transparent 12-month annual expenditure following official Portale Offerte rules (v4.0) with post-April-2026 domestic dispatch and quarterly regulated parameters.
- **Bill & Contract Comparison (*Confronta con il tuo contratto*)**: Upload a bill, policy, or invoice as PDF or image. Bundled Tesseract 5.5.3 with the Italian `tessdata_best` model performs local OCR in memory. Review extracted unit prices, fixed fees, and validity dates with zero cloud transmission or local disk persistence.
- **Local AI Highlights (*Punti chiave*)**: Extract verified, literal key passages from offer conditions using bundled `llama.cpp` and a local Qwen3.5-2B GGUF model. The model runs locally on loopback; quotes are verified against source text to prevent AI hallucinations.
- **Official Regulatory Directories**: Query official lists of authorized operators on demand from ARERA, AGCOM (ROC), and IVASS.

## Installation

1. Build or install the NSIS package: `src-tauri/target/release/bundle/nsis/OnlyBollette_0.1.0_x64-setup.exe`.
2. Launch **OnlyBollette**. The application includes dark and light theme options and stores offer snapshots in local app data.
3. Requires Windows x64 with WebView2. Windows 10 and 8 GB RAM configurations remain unverified; see the project tracker.

The 25 September installer passed native OCR on an artificial image and the original eleven-page PDF, with no OCR download. The document parser recovers the printed end date of the bill's economic validity range for manual review; it does not establish future applicability. Active OCR cancellation and process cleanup passed a separate native check. Kiara and Enel add nine Internet offers; Vodafone adds two scoped Casa cards; 1Mobile adds one Start XPlus Reward offer; ho. adds two customer-specific home data cards; spusu adds three mobile cards. The updated installed app passed Internet cache loading and refresh with 17 sources and 65 offers. Isolated network failure, partial acquisition and recovery checks passed. Remaining verification limits are recorded in [Verification](docs/VERIFICATION.md).

## Documentation by Domain

Detailed technical and operational documentation is organized in `docs/`:

- [**Architecture & System Design**](docs/ARCHITECTURE.md): Component layout, data isolation, in-memory OCR pipeline, and local AI runtime.
- [**Sources, Catalogs & Comparison Rules**](docs/SOURCES-AND-COMPARISON.md): Data sources for all 4 categories, calculation rules, document extraction guidelines, and limitations.
- [**Development & Build Guide**](docs/DEVELOPMENT.md): Toolchain prerequisites, environment variables, build commands, and installer generation.
- [**Verification & Quality Assurance**](docs/VERIFICATION.md): Test commands, native desktop verification scripts, diagnostic examples, and test boundaries.
- [**Third-Party Notices**](docs/THIRD-PARTY-NOTICES.md): Open-source licenses, component versions, and model attributions.
- [**Project Status & Roadmap**](PROJECT_STATUS.json): Active tasks, known issues, and priorities.

## Quick Start for Developers

```powershell
# Set Cargo path and install dependencies
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm ci

# Prepare local AI binaries and bundled OCR runtime
npm run prepare:runtime

# Run desktop app in development
npm run desktop

# Run full test suite
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```
