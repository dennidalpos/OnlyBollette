# Development & Build Guide

## Prerequisites

- **Node.js**: 24 LTS (or compatible)
- **PowerShell**: 7.x (`pwsh`)
- **Rust**: Stable MSVC toolchain (on this machine installed under `$env:USERPROFILE\.cargo\bin`)
- **C++ Build Tools**: Visual Studio C++ Build Tools with CMake and English language pack (required by vcpkg for static Tesseract compilation)
- **WebView2**: Evergreen WebView2 runtime (pre-installed on Windows 10/11)

## Environment Setup

In a new PowerShell session, ensure Cargo is in `PATH`:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm ci
npm run prepare:runtime
```

### Runtime Preparation (`prepare:runtime`)

`npm run prepare:runtime` performs two automated tasks:
1. **Local AI Engine**: Downloads pinned `llama.cpp` b10982 binaries, verifies their SHA-256 hashes, and extracts them into `src-tauri/resources/runtime/cpu/` and `vulkan/`.
2. **Bundled OCR**: Executes `scripts/prepare-ocr.ps1`, which compiles static Tesseract 5.5.3 using dependencies from pinned vcpkg (`dc1232a6...`), downloads the Italian `tessdata_best` model (`e12c65a9...`), copies license notices, and generates a checksum `manifest.json` under `src-tauri/resources/runtime/ocr/`. The manifest is not digitally signed; upstream archives and the model have pinned SHA-256 hashes. Packaging validates all generated resources before building.

## Running the Application

- **Full Desktop App (Tauri)**:
  ```powershell
  npm run desktop
  ```
- **Web Preview (Frontend Only)**:
  ```powershell
  npm run dev
  ```
  *Note*: The web preview deliberately does not fake native Tauri IPC, offers, or AI. It is intended for pure CSS and layout preview.

## Building & Packaging

- **Frontend Build**:
  ```powershell
  npm run build
  ```
- **Rust Backend**:
  ```powershell
  cargo build --manifest-path src-tauri/Cargo.toml
  ```
- **Installer Generation**:
  ```powershell
  pwsh -NoProfile -File scripts/build-installer.ps1
  # Alternatively: npm run package
  ```
  Generates `src-tauri/target/release/bundle/nsis/OnlyBollette_0.1.0_x64-setup.exe`. The build script automatically verifies runtime manifests and dependencies before creating the NSIS installer.

## Environment Variables

| Variable | Description |
| --- | --- |
| `ONLYBOLLETTE_DATA_DIR` | Absolute path overriding the data directory (`offers.sqlite` and `models/`). Used by tests to ensure zero pollution of user profiles. |
| `ONLYBOLLETTE_TEST_MODEL` | Absolute path to an existing `Qwen_Qwen3.5-2B-Q4_K_M.gguf` file to test AI inference without triggering a 1.4 GB download. |
| `ONLYBOLLETTE_SOURCE_DIAGNOSTICS` | Set to `1` to output public source host/path, elapsed time, success and byte count to stderr. No query parameters or response bodies are logged. |
