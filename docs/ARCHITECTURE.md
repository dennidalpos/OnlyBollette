# Architecture & System Design

OnlyBollette is a Windows x64 desktop application built with Tauri 2, Rust, React 19, and TypeScript. It provides offline-first offer browsing and bill comparison for Italian household utilities without accounts, external cloud services, or paid APIs.

## Component Architecture

```
┌────────────────────────────────────────────────────────┐
│               Frontend (WebView2 / React 19)           │
│  - Offer cards, filters & sorting (App.tsx)            │
│  - PLACET electricity estimator (electricity.ts)       │
│  - Document parser & comparison (comparisonDocuments)  │
└───────────────────────────▲────────────────────────────┘
                            │ Tauri IPC (Commands & Events)
┌───────────────────────────▼────────────────────────────┐
│                  Backend (Rust / Tauri 2)              │
│  - lib.rs: App state, IPC handlers & background tasks  │
│  - sources.rs: Public web & open-data fetchers         │
│  - energy.rs: Portale Offerte XML/CSV parser           │
│  - providers.rs: ARERA, AGCOM & IVASS registries       │
│  - store.rs: SQLite cache (offers.sqlite)              │
│  - documents.rs: In-memory PDF render & Tesseract OCR  │
│  - ai.rs: Local llama.cpp process manager & validator  │
└────────────────────────────────────────────────────────┘
```

## Data Storage & Privacy Model

- **Local Database**: Cached offers, parameters, and AI highlight summaries are stored in `%LOCALAPPDATA%/it.onlybollette.desktop/offers.sqlite`.
- **Environment Override**: `ONLYBOLLETTE_DATA_DIR` overrides the database and model directory (must be an absolute path). Used by automated tests for complete scratch isolation.
- **Zero Document Persistence**: Uploaded PDFs, rendered page images, OCR geometry/TSV text, and user consumption profiles are held strictly in memory during the active session. They are never saved to SQLite, disk, AI caches, or logs.
- **Network Boundaries**: Outbound network requests are limited to official provider pages, open-data feeds, official registries, and the one-time AI model download.

## Bundled OCR Engine

- **Binary & Model**: Bundled static Tesseract 5.5.3 executable (`resources/runtime/ocr/tesseract.exe`) and Italian `tessdata_best` (`ita.traineddata`).
- **Integrity**: Validated against `resources/runtime/ocr/manifest.json` SHA-256 checksums before execution.
- **Execution Flow**:
  1. PDF pages are rendered in memory via Windows Imaging (`windows::Data::Pdf` / `windows::Graphics::Imaging`) at a 2,000 px target width.
  2. Images are piped to Tesseract stdin; TSV output is read from stdout (`--psm 11` for sparse text and tabular recovery). The process runs in the bundled OCR directory with relative `tessdata`, because Tesseract cannot load its model using the extended Windows resource-path prefix returned for installed apps.
  3. Bounded execution (120-second timeout per page, 8 MB output cap).
  4. Returns word bounding boxes (`DocumentWord`), line grouping (`DocumentLine`), and page text to the frontend.
  5. Each analysis has a request ID and cancellation token. Clearing the comparison, changing the proposal, starting another upload, or leaving the view cancels its native job. An active Tesseract child is killed and reaped; PDF rendering stops at the next page boundary. The UI also rejects late results.

## Local AI Runtime

- **Runtime**: Pinned `llama.cpp` b10982 binaries (`llama-server.exe`) bundled under `resources/runtime/cpu/` and `resources/runtime/vulkan/` supporting Vulkan with CPU fallback.
- **Model**: Qwen3.5-2B-Instruct quantized at Q4_K_M (SHA-256: `57a10858...`, size: 1.39 GB), downloaded on demand to `%LOCALAPPDATA%/.../models/`.
- **Security & Concurrency**:
  - The `llama-server.exe` process binds only to loopback (`127.0.0.1`) on a dynamic port with an ephemeral bearer token.
  - Automatically terminated on app exit or engine reset.
- **Strict Evidence Validation (`evidenceVersion=1`)**:
  - The model selects up to 3 key passages from acquired source text.
  - Application annotations and UI warnings are excluded from AI prompts.
  - The backend validates that returned quotes are exact, literal substrings of the normalized source text before displaying them. The model never calculates prices or invents terms.
