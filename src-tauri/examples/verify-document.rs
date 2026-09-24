fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("pass a PDF or image path");
    let required = args.next();
    let json = args.next().as_deref() == Some("--json");
    match onlybollette_lib::documents::analyze(&path) {
        Ok(document) => {
            if !json {
                println!(
                    "pages={} readable={}",
                    document.pages.len(),
                    document.readable
                );
            }
            if !document.readable {
                std::process::exit(1);
            }
            if let Some(required) = required {
                if !document
                    .pages
                    .iter()
                    .any(|page| page.text.contains(&required))
                {
                    eprintln!("Required text was not recognized");
                    std::process::exit(1);
                }
            }
            if json {
                println!(
                    "{}",
                    serde_json::to_string(&document).expect("serialize fixture")
                );
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
