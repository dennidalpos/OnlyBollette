fn main() {
    let path = std::env::args().nth(1).expect("pass a PDF path");
    let runtime = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources/runtime")
        .canonicalize()
        .expect("bundled runtime directory");
    let cancel = tokio_util::sync::CancellationToken::new();
    let worker_cancel = cancel.clone();
    let worker = std::thread::spawn(move || {
        onlybollette_lib::documents::analyze(&path, &runtime, &worker_cancel)
    });
    std::thread::sleep(std::time::Duration::from_millis(300));
    cancel.cancel();
    let result = worker.join().expect("native OCR worker");
    assert_eq!(result.err().as_deref(), Some("Operazione annullata"));
    println!("PASS: active native document analysis cancelled");
}
