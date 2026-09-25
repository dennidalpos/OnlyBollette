use onlybollette_lib::sources;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|s| s == "--inspect") {
        let url = args.get(1).expect("URL");
        let html = sources::fetch_text(&sources::client().unwrap(), url, 8_000_000)
            .await
            .unwrap();
        println!(
            "{} bytes, text: {}",
            html.len(),
            sources::page_text(&html)
                .chars()
                .take(1200)
                .collect::<String>()
        );
        for (url, label) in sources::links(&html, url).iter().take(40) {
            println!("{url} | {label}");
        }
        return;
    }
    let source_filter = if args.first().is_some_and(|s| s == "--source") {
        Some(args.get(1).expect("source name after --source").clone())
    } else {
        None
    };
    let categories = if source_filter.is_some() {
        vec![args.get(2).expect("category after source name").clone()]
    } else if args.is_empty() {
        vec![
            "luce".into(),
            "gas".into(),
            "internet".into(),
            "assicurazioni".into(),
        ]
    } else {
        args
    };
    let mut failed = false;
    for category in categories {
        let configs: Vec<_> = sources::sources(&category)
            .expect("valid category")
            .into_iter()
            .filter(|source| {
                source_filter
                    .as_ref()
                    .is_none_or(|name| source.name == name)
            })
            .collect();
        assert!(!configs.is_empty(), "unknown source in category");
        let mut total = 0;
        for config in configs {
            let start = std::time::Instant::now();
            let result = sources::fetch(config, &category).await;
            println!(
                "{} / {}: {} offers, {:.1}s, {}",
                category,
                result.source,
                result.offers.len(),
                start.elapsed().as_secs_f32(),
                result
                    .error
                    .as_deref()
                    .or(result.calculation_error.as_deref())
                    .unwrap_or(if result.partial { "PARTIAL" } else { "OK" })
            );
            for o in result.offers.iter().take(3) {
                println!(
                    "  {} | {} | monthly={:?} | components={} | {}",
                    o.provider,
                    o.name,
                    o.monthly_price,
                    o.components.len(),
                    o.url
                );
            }
            total += result.offers.len();
            if result.error.is_some()
                || result.calculation_error.is_some()
                || result.partial
                || result.offers.is_empty()
                || (category == "luce" && result.electricity_parameters.is_none())
            {
                failed = true;
            }
            if result.offers.iter().any(|o| {
                o.id.is_empty() || o.url.is_empty() || o.evidence.is_empty() || !o.active()
            }) {
                failed = true;
            }
        }
        if total == 0 {
            failed = true;
        }
    }
    if failed {
        std::process::exit(1);
    }
}
