use onlybollette_lib::providers;

#[tokio::main]
async fn main() {
    let categories: Vec<String> = std::env::args().skip(1).collect();
    let categories = if categories.is_empty() {
        vec!["luce", "gas", "internet", "assicurazioni"]
            .into_iter()
            .map(String::from)
            .collect()
    } else {
        categories
    };
    let mut failed = false;
    for category in categories {
        let started = std::time::Instant::now();
        match providers::fetch(&category).await {
            Ok(directory) => println!(
                "{}: {} providers, {:.1}s, {}",
                category,
                directory.providers.len(),
                started.elapsed().as_secs_f32(),
                directory.source_url
            ),
            Err(error) => {
                eprintln!("{category}: {error}");
                failed = true;
            }
        }
    }
    if failed {
        std::process::exit(1);
    }
}
