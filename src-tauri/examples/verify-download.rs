use onlybollette_lib::ai::{self, MODEL_SIZE};
use std::{
    io::{Read, Write},
    path::PathBuf,
};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<(), String> {
    let installed = PathBuf::from(std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?)
        .join("it.onlybollette.desktop");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Workspace missing")?
        .join(".scratch")
        .join(format!("download-check-{}", uuid::Uuid::new_v4()));
    let model = ai::model_path(&root);
    let folder = model.parent().ok_or("Model folder missing")?;
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let part = model.with_extension("part");
    let result = async {
        let source = std::fs::File::open(ai::model_path(&installed)).map_err(|e| e.to_string())?;
        let mut target = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let initial_size = MODEL_SIZE - 64 * 1_048_576;
        std::io::copy(&mut source.take(initial_size), &mut target).map_err(|e| e.to_string())?;
        target.flush().map_err(|e| e.to_string())?;
        drop(target);
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        let error = ai::download(&root, cancelled, |_| {})
            .await
            .expect_err("Pre-cancelled download must fail");
        if !error.contains("sospeso") {
            return Err(error);
        }
        if std::fs::metadata(&part).map_err(|e| e.to_string())?.len() != initial_size {
            return Err("Cancelled download changed the partial file".into());
        }
        println!("PASS: cancelled download preserves partial file");

        let active_cancel = CancellationToken::new();
        let cancel_on_progress = active_cancel.clone();
        let error = ai::download(&root, active_cancel, move |progress| {
            if progress.stage == "Download modello" && progress.downloaded > initial_size {
                cancel_on_progress.cancel();
            }
        })
        .await
        .expect_err("Active transfer must be cancelled");
        if !error.contains("sospeso") {
            return Err(error);
        }
        let interrupted_size = std::fs::metadata(&part).map_err(|e| e.to_string())?.len();
        if interrupted_size <= initial_size || interrupted_size >= MODEL_SIZE {
            return Err("Active cancellation did not preserve a partial transfer".into());
        }
        println!("PASS: active download cancellation preserves new bytes");

        ai::download(&root, CancellationToken::new(), |_| {}).await?;
        ai::verify_hash(&model, ai::MODEL_HASH)?;
        if part.exists() {
            return Err("Partial file remains after verified completion".into());
        }
        println!("PASS: real HTTP Range resume completed with expected SHA-256");
        Ok(())
    }
    .await;
    if model.exists() {
        std::fs::remove_file(&model).map_err(|e| e.to_string())?;
    }
    if part.exists() {
        std::fs::remove_file(&part).map_err(|e| e.to_string())?;
    }
    std::fs::remove_dir(folder).map_err(|e| e.to_string())?;
    std::fs::remove_dir(root).map_err(|e| e.to_string())?;
    result
}
