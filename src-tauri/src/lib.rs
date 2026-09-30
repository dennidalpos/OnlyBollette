pub mod ai;
pub mod documents;
pub mod domain;
pub mod energy;
pub mod providers;
pub mod sources;
mod store;

use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    data: PathBuf,
    runtime: PathBuf,
    searches: Arc<Mutex<HashMap<String, CancellationToken>>>,
    document_jobs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    ai: ai::Ai,
}

#[tauri::command]
async fn analyze_document(
    path: String,
    request_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<documents::DocumentAnalysis, String> {
    let runtime = state.runtime.clone();
    let cancel = CancellationToken::new();
    let jobs = state.document_jobs.clone();
    {
        let mut active = jobs.lock().await;
        if active.contains_key(&request_id) {
            return Err("Lettura documento già in corso".into());
        }
        active.insert(request_id.clone(), cancel.clone());
    }
    let result =
        tauri::async_runtime::spawn_blocking(move || documents::analyze(&path, &runtime, &cancel))
            .await;
    jobs.lock().await.remove(&request_id);
    result.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn cancel_document(
    request_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(token) = state.document_jobs.lock().await.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchEvent {
    request_id: String,
    result: Option<domain::SourceResult>,
    done: bool,
    cancelled: bool,
}

#[tauri::command]
fn source_names(category: String) -> Result<Vec<String>, String> {
    Ok(sources::sources(&category)?
        .into_iter()
        .map(|source| source.name.to_string())
        .collect())
}

#[tauri::command]
async fn cached_offers(
    state: tauri::State<'_, AppState>,
    category: String,
) -> Result<Vec<domain::SourceResult>, String> {
    sources::sources(&category)?;
    let db = state.data.join("offers.sqlite");
    tauri::async_runtime::spawn_blocking(move || store::load(&db, &category))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn provider_directory(category: String) -> Result<providers::ProviderDirectory, String> {
    providers::fetch(&category).await
}

#[tauri::command]
async fn search_offers(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    category: String,
    request_id: String,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err("Identificativo ricerca non valido".into());
    }
    let sources = sources::sources(&category)?;
    let cancel = CancellationToken::new();
    let mut searches = state.searches.lock().await;
    for token in searches.values() {
        token.cancel();
    }
    searches.insert(request_id.clone(), cancel.clone());
    drop(searches);
    let registry = state.searches.clone();
    let db = state.data.join("offers.sqlite");
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn(async move {
        let mut queue = tokio::task::JoinSet::new();
        for source in sources {
            let category = category.clone();
            let runtime = runtime.clone();
            queue.spawn(async move { sources::fetch(source, &category, &runtime).await });
        }
        loop {
            let next = tokio::select! {_=cancel.cancelled()=>{queue.abort_all();break},item=queue.join_next()=>item};
            let Some(joined) = next else { break };
            let mut result = match joined {
                Ok(r) => r,
                Err(e) => domain::SourceResult {
                    source: "Ricerca".into(),
                    url: String::new(),
                    offers: vec![],
                    fetched_at: domain::now(),
                    error: Some(format!("Ricerca interrotta: {e}")),
                    cached: false,
                    electricity_parameters: None,
                    calculation_error: None,
                    partial: false,
                },
            };
            if cancel.is_cancelled() {
                break;
            }
            if result.error.is_none() {
                if let Err(e) = store::save(&db, &category, &result) {
                    result.error = Some(format!(
                        "Offerte recuperate, salvataggio locale non riuscito: {e}"
                    ));
                }
            }
            let _ = app.emit(
                "search-update",
                SearchEvent {
                    request_id: request_id.clone(),
                    result: Some(result),
                    done: false,
                    cancelled: false,
                },
            );
        }
        registry.lock().await.remove(&request_id);
        let _ = app.emit(
            "search-update",
            SearchEvent {
                request_id,
                result: None,
                done: true,
                cancelled: cancel.is_cancelled(),
            },
        );
    });
    Ok(())
}

#[tauri::command]
async fn cancel_search(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    if let Some(token) = state.searches.lock().await.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelStatus {
    installed: bool,
    downloading: bool,
    size: u64,
    data_directory: PathBuf,
}
#[tauri::command]
async fn model_status(state: tauri::State<'_, AppState>) -> Result<ModelStatus, String> {
    let path = ai::model_path(&state.data);
    let installed = tauri::async_runtime::spawn_blocking(move || {
        path.is_file() && ai::verify_hash(&path, ai::MODEL_HASH).is_ok()
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(ModelStatus {
        installed,
        downloading: state.ai.is_downloading(),
        size: ai::MODEL_SIZE,
        data_directory: state.data.clone(),
    })
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut engine =
        state.ai.engine.try_lock().map_err(|_| {
            "Attendi il completamento dell'analisi AI prima di verificare il modello"
        })?;
    *engine = None;
    if state.ai.downloading.swap(true, Ordering::SeqCst) {
        return Err("Download già in corso".into());
    }
    let cancel = CancellationToken::new();
    *state.ai.download_cancel.lock().await = cancel.clone();
    let result = ai::download(&state.data, cancel, |progress| {
        let _ = app.emit("model-progress", progress);
    })
    .await;
    state.ai.downloading.store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
async fn cancel_download(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.ai.download_cancel.lock().await.cancel();
    Ok(())
}
#[tauri::command]
async fn cancel_ai(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.ai.inference_cancel.lock().await.cancel();
    Ok(())
}

#[tauri::command]
async fn offer_highlights(
    state: tauri::State<'_, AppState>,
    offer_id: String,
) -> Result<ai::Highlights, String> {
    let db = state.data.join("offers.sqlite");
    let offer = store::find(&db, &offer_id)?;
    let evidence = offer.source_evidence()?;
    let cache_key = format!("source-v1\n{evidence}");
    if let Some(summary) = store::cached_summary(&db, &offer.id, &cache_key)? {
        let saved: ai::Highlights = serde_json::from_str(&summary).map_err(|e| e.to_string())?;
        return ai::validate_quotes(&summary, evidence, &saved.backend);
    }
    let result = state
        .ai
        .highlights(&state.runtime, &state.data, evidence)
        .await?;
    store::save_summary(
        &db,
        &offer.id,
        &cache_key,
        &serde_json::to_string(&result).map_err(|e| e.to_string())?,
    )?;
    Ok(result)
}

#[tauri::command]
async fn offer_contract_risks(
    state: tauri::State<'_, AppState>,
    offer_id: String,
    fetch_document: bool,
) -> Result<domain::ContractAnalysis, String> {
    let db = state.data.join("offers.sqlite");
    let offer = store::find(&db, &offer_id)?;
    let (evidence, source_type) = if fetch_document {
        let target_url = if domain::web_url(&offer.url).is_ok() {
            Some(offer.url.as_str())
        } else if domain::web_url(&offer.source_url).is_ok() {
            Some(offer.source_url.as_str())
        } else {
            None
        };
        if let Some(url) = target_url {
            let client = sources::client()?;
            match sources::fetch_bytes(&client, url, 15 * 1024 * 1024).await {
                Ok(bytes) => {
                    let lower_url = url.to_lowercase();
                    let is_pdf = lower_url.ends_with(".pdf")
                        || lower_url.contains(".pdf?")
                        || bytes.starts_with(b"%PDF");
                    let ext = if is_pdf { "pdf" } else { "html" };
                    if is_pdf {
                        let cancel = CancellationToken::new();
                        match documents::analyze_bytes(
                            &bytes,
                            ext,
                            offer.name.clone(),
                            &state.runtime,
                            &cancel,
                        ) {
                            Ok(analysis) if analysis.readable && !analysis.pages.is_empty() => {
                                let text = analysis
                                    .pages
                                    .into_iter()
                                    .map(|p| p.text)
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                if !text.trim().is_empty() {
                                    (text, "documento_pdf".to_string())
                                } else {
                                    (
                                        offer.source_evidence()?.to_string(),
                                        "scheda_offerta".to_string(),
                                    )
                                }
                            }
                            _ => (
                                offer.source_evidence()?.to_string(),
                                "scheda_offerta".to_string(),
                            ),
                        }
                    } else {
                        let html = String::from_utf8_lossy(&bytes);
                        let doc = scraper::Html::parse_document(&html);
                        let mut text_parts = Vec::new();
                        for node in doc.tree.nodes() {
                            if let Some(text) = node.value().as_text() {
                                let in_script_or_style = node
                                    .parent()
                                    .and_then(|p| p.value().as_element())
                                    .is_some_and(|el| {
                                        matches!(el.name(), "script" | "style" | "noscript" | "svg")
                                    });
                                if !in_script_or_style {
                                    let trimmed = text.trim();
                                    if !trimmed.is_empty() {
                                        text_parts.push(trimmed);
                                    }
                                }
                            }
                        }
                        let text = text_parts.join(" ");
                        if !text.trim().is_empty() {
                            (text, "pagina_web".to_string())
                        } else {
                            (
                                offer.source_evidence()?.to_string(),
                                "scheda_offerta".to_string(),
                            )
                        }
                    }
                }
                Err(_) => (
                    offer.source_evidence()?.to_string(),
                    "scheda_offerta".to_string(),
                ),
            }
        } else {
            (
                offer.source_evidence()?.to_string(),
                "scheda_offerta".to_string(),
            )
        }
    } else {
        (
            offer.source_evidence()?.to_string(),
            "scheda_offerta".to_string(),
        )
    };

    let summary_id = format!("{}:risks", offer.id);
    let evidence_hash = format!("{:x}", Sha256::digest(evidence.as_bytes()));
    let cache_key = format!("contract-risks-v1:{source_type}:{evidence_hash}");
    if let Some(cached) = store::cached_summary(&db, &summary_id, &cache_key)? {
        if let Ok(saved) = serde_json::from_str::<domain::ContractAnalysis>(&cached) {
            if let Ok(valid) = ai::validate_risks(&cached, &evidence, &saved.backend, &source_type)
            {
                return Ok(valid);
            }
        }
    }

    let result = state
        .ai
        .contract_risks(&state.runtime, &state.data, &evidence, &source_type)
        .await?;

    let _ = store::save_summary(
        &db,
        &summary_id,
        &cache_key,
        &serde_json::to_string(&result).map_err(|e| e.to_string())?,
    );
    Ok(result)
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    domain::web_url(&url)?;
    open::that_detached(url).map_err(|e| e.to_string())
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data = match std::env::var_os("ONLYBOLLETTE_DATA_DIR") {
                Some(value) => {
                    let path = PathBuf::from(value);
                    if !path.is_absolute() {
                        return Err("ONLYBOLLETTE_DATA_DIR must be an absolute path".into());
                    }
                    path
                }
                None => app.path().app_local_data_dir()?,
            };
            std::fs::create_dir_all(&data)?;
            let runtime = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime")
            } else {
                app.path().resource_dir()?.join("resources/runtime")
            };
            app.manage(AppState {
                data,
                runtime,
                searches: Arc::new(Mutex::new(HashMap::new())),
                document_jobs: Arc::new(Mutex::new(HashMap::new())),
                ai: ai::Ai::default(),
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            analyze_document,
            cancel_document,
            source_names,
            cached_offers,
            provider_directory,
            search_offers,
            cancel_search,
            model_status,
            download_model,
            cancel_download,
            cancel_ai,
            offer_highlights,
            offer_contract_risks,
            open_link
        ])
        .build(tauri::generate_context!())
        .expect("Impossibile avviare OnlyBollette");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            tauri::async_runtime::block_on(async {
                let state = handle.state::<AppState>();
                state.ai.download_cancel.lock().await.cancel();
                for token in state.document_jobs.lock().await.values() {
                    token.cancel();
                }
                state.ai.inference_cancel.lock().await.cancel();
                *state.ai.engine.lock().await = None;
            });
        }
    });
}
