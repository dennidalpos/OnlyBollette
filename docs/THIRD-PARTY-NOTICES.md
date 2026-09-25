# Third-party components

The OCR bundle contains Tesseract 5.5.3 (Apache-2.0), Italian `tessdata_best` at revision `e12c65a915945e4c28e237a9b52bc4a8f39a0cec` (Apache-2.0), and statically linked Leptonica and image-codec dependencies from vcpkg revision `dc1232a6e05dcc49703091e83743e3b4df9b9b7c`. Preparation copies each dependency's copyright/license file to `resources/runtime/ocr/licenses`; these files and their checksums are included in the installer. Source archives and the Italian model are pinned by SHA-256 in `scripts/prepare-ocr.ps1`. The generated manifest records the executable and resource hashes. OCR requires no separately installed runtime: the verified executable imports only Windows KERNEL32.dll.

OnlyBollette uses these independently licensed projects. Exact dependency versions are recorded in package-lock.json and src-tauri/Cargo.lock.

| Component                           | License                                           | Upstream                                              |
| ----------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Tauri                               | MIT / Apache-2.0                                  | https://github.com/tauri-apps/tauri                   |
| React, Vite, Radix UI, Tailwind CSS | MIT                                               | Respective package metadata                           |
| Lucide                              | ISC                                               | https://github.com/lucide-icons/lucide                |
| llama.cpp b10982                    | MIT                                               | https://github.com/ggml-org/llama.cpp/tree/b10982     |
| Qwen3.5-2B                          | Apache-2.0                                        | https://huggingface.co/Qwen/Qwen3.5-2B                |
| Qwen3.5-2B GGUF Q4_K_M              | Apache-2.0, third-party quantization by bartowski | https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF |

The bundled CPU and Vulkan runtimes include upstream library notices. Full llama.cpp and model license texts are in docs/licenses and included in the installer. Model weights are downloaded separately, from a pinned revision with a pinned SHA-256 digest; the quantization is not published by the Qwen organization.

Offer data and documents remain the property of their respective publishers. The application links to original sources, stores a local cache and does not claim endorsement, completeness of market coverage or insurance quotation authority.
