use onlybollette_lib::{
    ai::{self, Ai},
    sources,
};
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Workspace missing")?
        .join("test-results/ai-data");
    let root = if let Some(index) = args.iter().position(|a| a == "--runtime-root") {
        PathBuf::from(
            args.get(index + 1)
                .ok_or("--runtime-root requires a path")?,
        )
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime")
    };
    ai::download(&data, CancellationToken::new(), |p| {
        if p.stage != "Download modello" || p.downloaded / 10_000_000 % 10 == 0 {
            println!(
                "{} {:.0}%",
                p.stage,
                100.0 * p.downloaded as f64 / p.total as f64
            );
        }
    })
    .await?;
    let engine = Ai::default();
    let results = sources::fetch(
        sources::Source {
            name: "Iliad",
            url: "https://www.iliad.it/",
        },
        "internet",
        &root,
    )
    .await;
    if results.error.is_some() || results.partial {
        return Err(results
            .error
            .unwrap_or("Catalogo AI di verifica parziale".into()));
    }
    let offer = results
        .offers
        .first()
        .ok_or("Nessuna offerta per verificare AI")?;
    let start = std::time::Instant::now();
    let result = engine
        .highlights(&root, &data, offer.source_evidence()?)
        .await?;
    println!(
        "{}: {} verified quotes, backend={}, {:.1}s",
        offer.name,
        result.quotes.len(),
        result.backend,
        start.elapsed().as_secs_f32()
    );
    for q in result.quotes {
        println!("  {q}");
    }
    let risks_start = std::time::Instant::now();
    let risks = engine
        .contract_risks(&root, &data, offer.source_evidence()?, "scheda_offerta")
        .await?;
    println!(
        "{}: {} verified contract risks, backend={}, {:.1}s",
        offer.name,
        risks.risks.len(),
        risks.backend,
        risks_start.elapsed().as_secs_f32()
    );
    for r in risks.risks {
        println!("  [{}] {} -> \"{}\"", r.severity, r.category, r.quote);
    }
    engine.shutdown();
    Ok(())
}
