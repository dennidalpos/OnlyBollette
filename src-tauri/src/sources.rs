use crate::domain::{now, web_url, Offer, SourceResult};
use regex::Regex;
use scraper::{Html, Selector};
use std::{collections::HashSet, time::Duration};

pub const PORTAL: &str = "https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page";

#[derive(Clone, Copy)]
pub struct Source {
    pub name: &'static str,
    pub url: &'static str,
}

pub fn sources(category: &str) -> Result<Vec<Source>, String> {
    Ok(match category {
        "luce" | "gas" => vec![Source {
            name: "Portale Offerte",
            url: PORTAL,
        }],
        "internet" => vec![
            Source {
                name: "Iliad",
                url: "https://www.iliad.it/",
            },
            Source {
                name: "Fastweb",
                url: "https://www.fastweb.it/",
            },
        ],
        "assicurazioni" => vec![
            Source {
                name: "Bene",
                url: "https://www.bene.it/",
            },
            Source {
                name: "Allianz",
                url: "https://www.allianz.it/le-soluzioni-per-te.html",
            },
        ],
        _ => return Err("Categoria non riconosciuta".into()),
    })
}

pub fn client() -> Result<reqwest::Client, String> {
    let redirect_limit = reqwest::redirect::Policy::limited(5);
    reqwest::Client::builder()
        .user_agent("OnlyBollette/0.1 (public-offer-reader)")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            let source_host = attempt.previous().first().and_then(|url| url.host_str());
            if attempt.url().scheme() != "https" || attempt.url().host_str() != source_host {
                attempt.error("Redirect fuori dalla fonte HTTPS ufficiale")
            } else if let Err(error) = web_url(attempt.url().as_str()) {
                attempt.error(error)
            } else {
                redirect_limit.redirect(attempt)
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

pub async fn fetch_text(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
) -> Result<String, String> {
    web_url(url)?;
    let mut request = client.get(url);
    if limit > 8_000_000 {
        request = request.timeout(Duration::from_secs(300));
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("Connessione non riuscita: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Fonte non disponibile (HTTP {}). Aprire il sito ufficiale.",
            response.status().as_u16()
        ));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Documento oltre il limite previsto".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Trasferimento interrotto dopo {} byte: {e}", bytes.len()))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err("Documento oltre il limite previsto".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Codifica del documento non supportata".into())
}

fn selector(value: &str) -> Selector {
    Selector::parse(value).expect("static CSS selector")
}
fn clean(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn page_text(html: &str) -> String {
    let doc = Html::parse_document(html);
    let root = doc
        .select(&selector("main"))
        .next()
        .or_else(|| doc.select(&selector("body")).next());
    let Some(root) = root else {
        return String::new();
    };
    clean(
        &root
            .descendants()
            .filter_map(|node| {
                let text = node.value().as_text()?;
                let excluded = node.ancestors().any(|p| {
                    p.value().as_element().is_some_and(|e| {
                        matches!(
                            e.name(),
                            "script" | "style" | "nav" | "header" | "footer" | "noscript" | "svg"
                        )
                    })
                });
                (!excluded).then_some(text.to_string())
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

pub fn links(html: &str, base: &str) -> Vec<(String, String)> {
    let Ok(base) = url::Url::parse(base) else {
        return Vec::new();
    };
    let doc = Html::parse_document(html);
    let mut seen = HashSet::new();
    doc.select(&selector("a[href]"))
        .filter_map(|a| {
            let mut target = base.join(a.value().attr("href")?).ok()?;
            if target.host_str() != base.host_str() || !matches!(target.scheme(), "http" | "https")
            {
                return None;
            }
            target.set_fragment(None);
            target.set_query(None);
            let url = target.to_string();
            if !seen.insert(url.clone()) {
                return None;
            }
            Some((url, clean(&a.text().collect::<Vec<_>>().join(" "))))
        })
        .collect()
}

pub async fn fetch(source: Source, category: &str) -> SourceResult {
    let result = fetch_inner(source, category).await;
    let (electricity_parameters, calculation_error) = if category == "luce" && result.is_ok() {
        match fetch_electricity_parameters().await {
            Ok(parameters) => (Some(parameters), None),
            Err(error) => (None, Some(format!("Stima annua non disponibile: {error}"))),
        }
    } else {
        (None, None)
    };
    match result {
        Ok((offers, partial)) => SourceResult {
            source: source.name.into(),
            url: source.url.into(),
            offers,
            fetched_at: now(),
            error: None,
            cached: false,
            electricity_parameters,
            calculation_error,
            partial,
        },
        Err(error) => SourceResult {
            source: source.name.into(),
            url: source.url.into(),
            offers: Vec::new(),
            fetched_at: now(),
            error: Some(error),
            cached: false,
            electricity_parameters: None,
            calculation_error: None,
            partial: false,
        },
    }
}

async fn fetch_electricity_parameters() -> Result<crate::domain::ElectricityParameters, String> {
    let client = client()?;
    let html = fetch_text(&client, PORTAL, 8_000_000).await?;
    let url = links(&html, PORTAL)
        .into_iter()
        .find(|(u, _)| u.contains("/PO_Parametri_E_") && u.ends_with(".csv"))
        .map(|v| v.0)
        .ok_or("Parametri PLACET elettrici non trovati nella fonte ufficiale")?;
    let csv = fetch_text(&client, &url, 2_000_000).await?;
    crate::energy::parse_parameters(&csv, &url)
}

async fn fetch_inner(source: Source, category: &str) -> Result<(Vec<Offer>, bool), String> {
    let client = client()?;
    let html = fetch_text(&client, source.url, 8_000_000).await?;
    if matches!(category, "luce" | "gas") {
        let key = if category == "luce" {
            "PO_Offerte_E_MLIBERO_"
        } else {
            "PO_Offerte_G_MLIBERO_"
        };
        let url = links(&html, source.url)
            .into_iter()
            .find(|(u, _)| u.contains(key) && u.ends_with(".xml"))
            .map(|v| v.0)
            .ok_or("Collegamento Open Data non trovato nella pagina ufficiale")?;
        let xml = fetch_text(&client, &url, 100_000_000).await?;
        let mut offers = crate::energy::parse(&xml, category, &url)?;
        let placet_key = if category == "luce" {
            "PO_Offerte_E_PLACET_"
        } else {
            "PO_Offerte_G_PLACET_"
        };
        let placet_url = links(&html, source.url)
            .into_iter()
            .find(|(u, _)| u.contains(placet_key) && u.ends_with(".csv"))
            .map(|v| v.0)
            .ok_or("Collegamento PLACET non trovato nella pagina ufficiale")?;
        let csv = fetch_text(&client, &placet_url, 20_000_000).await?;
        offers.extend(crate::energy::parse_placet(&csv, category, &placet_url)?);
        let mut seen = HashSet::new();
        offers.retain(|offer| seen.insert(offer.id.clone()));
        offers.sort_by(|a, b| a.provider.cmp(&b.provider).then(a.name.cmp(&b.name)));
        return Ok((offers, false));
    }
    let candidates: Vec<_> = if source.name == "Bene" {
        // The published navigation is hydrated by the site; product URLs are curated source entrypoints.
        [
            "autofit",
            "casa",
            "pet",
            "viaggi",
            "motor",
            "infortuni",
            "salute",
        ]
        .iter()
        .map(|path| (format!("https://www.bene.it/{path}/"), String::new()))
        .collect()
    } else {
        links(&html, source.url)
            .into_iter()
            .filter(|(u, _)| is_product_url(source.name, u, category))
            .take(24)
            .collect()
    };
    if candidates.is_empty() {
        return Err("Catalogo non riconosciuto. Consultare il sito ufficiale.".into());
    }
    let mut offers = Vec::new();
    let mut failures = 0;
    for (url, label) in candidates {
        match fetch_text(&client, &url, 8_000_000).await {
            Ok(page) => match parse_product(source, category, &url, &label, &page) {
                Some(offer) if offer.active() => offers.push(offer),
                _ => failures += 1,
            },
            Err(_) => failures += 1,
        }
    }
    if offers.is_empty() {
        return Err(format!(
            "Nessun prodotto attuale verificabile; {failures} pagine non leggibili."
        ));
    }
    if failures > 0 {
        for offer in &mut offers {
            offer.conditions.push(format!(
                "Catalogo parziale: {failures} pagine della fonte non sono state acquisite."
            ));
        }
    }
    Ok((offers, failures > 0))
}

pub(crate) fn is_product_url(source: &str, url: &str, category: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else {
        return false;
    };
    let p = u.path();
    if category == "internet" {
        return match source {
            "Iliad" => {
                p.starts_with("/offerta-iliad-")
                    || p == "/offerte-iliad-fibra.html"
                    || p == "/offerta-5g-box-casa.html"
            }
            "Fastweb" => [
                "fastweb-casa-start",
                "fastweb-casa-pro",
                "fastweb-casa-ultra",
                "fastweb-casa-fwa",
                "fastweb-mobile-start",
                "fastweb-mobile-pro",
                "fastweb-mobile-ultra",
            ]
            .iter()
            .any(|name| p == format!("/adsl-fibra-ottica/{name}/")),
            _ => false,
        };
    }
    match source {
        "Bene" => [
            "/autofit/",
            "/casa/",
            "/pet/",
            "/viaggi/",
            "/motor/",
            "/infortuni/",
            "/salute/",
        ]
        .contains(&p),
        "Allianz" => {
            p.ends_with(".html")
                && (p.starts_with("/le-soluzioni-per-te/salute/")
                    || [
                        "/le-soluzioni-per-te/mobilita/auto.html",
                        "/le-soluzioni-per-te/mobilita/motocicli-ciclomotori.html",
                        "/le-soluzioni-per-te/casa-patrimonio/allianz-ultra-casa-e-patrimonio.html",
                        "/le-soluzioni-per-te/casa-patrimonio/allianz-salvacasa.html",
                        "/le-soluzioni-per-te/casa-patrimonio/allianz-condominio-protetto.html",
                    ]
                    .contains(&p))
        }
        _ => false,
    }
}

fn json_product(value: &serde_json::Value) -> Option<&serde_json::Value> {
    if value
        .get("@type")
        .and_then(|v| v.as_str())
        .is_some_and(|t| t == "Product" || t == "Service")
        && value.get("offers").is_some()
    {
        return Some(value);
    }
    if let Some(a) = value.as_array() {
        return a.iter().find_map(json_product);
    }
    value.get("@graph").and_then(json_product)
}

pub fn parse_product(
    source: Source,
    category: &str,
    url: &str,
    label: &str,
    html: &str,
) -> Option<Offer> {
    let doc = Html::parse_document(html);
    let text = page_text(html);
    if text.len() < 100 || text.contains("Enable JavaScript and cookies to continue") {
        return None;
    }
    let title = doc
        .select(&selector("title"))
        .next()
        .map(|e| clean(&e.text().collect::<Vec<_>>().join(" ")))
        .or_else(|| {
            doc.select(&selector("main h1"))
                .next()
                .map(|e| clean(&e.text().collect::<Vec<_>>().join(" ")))
        })?;
    let description = doc
        .select(&selector("meta[name='description' i]"))
        .next()
        .and_then(|e| e.value().attr("content"))
        .unwrap_or("")
        .to_string();
    let mut name = title;
    let mut monthly_price = None;
    let mut first_year_cost = None;
    let mut valid_until = None;
    if category == "internet" && source.name == "Iliad" {
        for script in doc.select(&selector("script[type='application/ld+json']")) {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&script.inner_html()) else {
                continue;
            };
            let Some(product) = json_product(&value) else {
                continue;
            };
            let Some(offer) = product.get("offers") else {
                continue;
            };
            if offer.get("priceCurrency").and_then(|v| v.as_str()) != Some("EUR") {
                continue;
            }
            if offer.get("billingPeriod").and_then(|v| v.as_str()) != Some("P1M") {
                continue;
            }
            if let Some(n) = product.get("name").and_then(|v| v.as_str()) {
                name = n.to_string();
            }
            monthly_price = offer
                .get("price")
                .and_then(|v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                })
                .filter(|v| v.is_finite() && *v > 0.0);
            valid_until = offer
                .get("priceValidUntil")
                .and_then(|v| v.as_str())
                .map(String::from);
            let permanent = doc
                .select(&selector("i-packshot-price[period='PER SEMPRE']"))
                .any(|e| {
                    e.value()
                        .attr("price")
                        .and_then(|s| s.parse::<f64>().ok())
                        .zip(monthly_price)
                        .is_some_and(|(cents, monthly)| (cents - monthly * 100.0).abs() < 0.01)
                });
            if name.to_lowercase().contains("mobile") && permanent {
                if let Some(properties) = offer.get("additionalProperty").and_then(|v| v.as_array())
                {
                    if properties.len() == 1
                        && properties[0].get("name").and_then(|v| v.as_str())
                            == Some("Costo attivazione SIM")
                        && properties[0].get("unitText").and_then(|v| v.as_str())
                            == Some("ONE-TIME")
                    {
                        let activation = properties[0].get("value").and_then(|v| {
                            v.as_f64()
                                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
                        });
                        if let (Some(monthly), Some(activation)) = (
                            monthly_price,
                            activation.filter(|v| v.is_finite() && *v >= 0.0),
                        ) {
                            first_year_cost =
                                Some(((monthly * 12.0 + activation) * 100.0).round() / 100.0);
                        }
                    }
                }
            }
            break;
        }
    }
    if category == "internet" && source.name == "Fastweb" {
        // Only the current product hero; navigation contains prices of unrelated plans.
        if let Some(hero) = doc
            .select(&selector(".spot .box_detail .blockprice"))
            .next()
        {
            let p = clean(&hero.text().collect::<Vec<_>>().join(" "));
            let re = Regex::new(r"(\d{1,3})\s*[,.]\s*(\d{2})").expect("price pattern");
            if let Some(c) = re.captures(&p) {
                monthly_price = format!("{}.{}", &c[1], &c[2]).parse::<f64>().ok();
            }
        }
        if let Some(heading) = doc.select(&selector(".spot h1")).next() {
            let heading = clean(&heading.text().collect::<Vec<_>>().join(" "));
            if !heading.is_empty() {
                name = heading;
            }
        } else if label.starts_with("Fastweb ") {
            name = label
                .split("Fibra ultraveloce")
                .next()
                .unwrap_or(label)
                .trim()
                .to_string();
        }
    }
    let low = format!("{url} {name}").to_lowercase();
    let subcategory = if category == "internet" {
        if low.contains("fwa") || low.contains("5g-box") {
            "fwa"
        } else if low.contains("mobile") || low.contains("domotica") {
            "mobile"
        } else {
            "casa"
        }
    } else if low.contains("autofit") || low.contains("auto.") {
        "auto"
    } else if low.contains("motor") || low.contains("moto") {
        "moto"
    } else if low.contains("pet") || low.contains("animal") {
        "animali"
    } else if low.contains("viagg") {
        "viaggi"
    } else if low.contains("salute") || low.contains("infortuni") {
        "salute"
    } else {
        "casa"
    };
    let mut conditions = vec![if category == "internet" {
        "Verificare copertura, requisiti, attivazione, modem e variazioni del canone sul sito dell'operatore.".into()
    } else {
        "Premio su preventivo personale. Massimali, franchigie ed esclusioni sono indicati nei documenti della compagnia.".into()
    }];
    if monthly_price.is_some() {
        conditions.push("Canone pubblicizzato, non costo totale. Eventuali promozioni e condizioni di accesso devono essere verificate.".into());
    }
    if first_year_cost.is_some() {
        conditions.push("Importo dei primi 12 mesi: 12 canoni pubblicizzati più attivazione SIM. Traffico extra, servizi opzionali e consumi a pagamento esclusi.".into());
    }
    let evidence = format!(
        "{name}\n{description}\n{}",
        text.chars().take(24000).collect::<String>()
    );
    Some(Offer {
        id: url.into(),
        category: category.into(),
        subcategory: subcategory.into(),
        provider: source.name.into(),
        name,
        description,
        url: url.into(),
        source: source.name.into(),
        source_url: url.into(),
        fetched_at: now(),
        valid_until,
        price_type: if category == "internet" {
            "advertised"
        } else {
            "quote"
        }
        .into(),
        monthly_price,
        first_year_cost,
        components: vec![],
        conditions,
        evidence,
        evidence_version: 1,
        restricted: false,
        electricity_rates: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[tokio::test]
    async fn rejects_redirect_to_local_address() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            assert!(stream.read(&mut request).unwrap() > 0);
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nLocation: http://{address}/private\r\nContent-Length: 0\r\n\r\n"
            )
            .unwrap();
        });
        let error = client()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap_err();
        server.join().unwrap();
        assert!(error.is_redirect(), "{error}");
    }
    #[test]
    fn excludes_script_and_navigation() {
        assert_eq!(page_text("<body><header>Wrong price</header><main><h1>Offer</h1><script>attack()</script><p>10 euro</p></main></body>"),"Offer 10 euro");
    }
    #[test]
    fn discovery_stays_on_official_host() {
        let l = links(
            r#"<a href="/offer">ok</a><a href="https://evil.test/a">bad</a><a href="javascript:alert(1)">bad</a>"#,
            "https://example.org",
        );
        assert_eq!(l.len(), 1);
    }
    #[test]
    fn archived_catalog_not_a_product() {
        assert!(!is_product_url(
            "Fastweb",
            "https://www.fastweb.it/adsl-fibra-ottica/trasparenza-tariffaria/",
            "internet"
        ));
        assert!(!is_product_url(
            "Fastweb",
            "https://www.fastweb.it/adsl-fibra-ottica/fastweb-informa/",
            "internet"
        ));
    }
    #[test]
    fn excludes_investments_and_business_insurance() {
        for path in [
            "/le-soluzioni-per-te/previdenza/fondi-pensione.html",
            "/le-soluzioni-per-te/impresa/alberghi.html",
            "/le-soluzioni-per-te/mobilita/nautica.html",
        ] {
            assert!(!is_product_url(
                "Allianz",
                &format!("https://www.allianz.it{path}"),
                "assicurazioni"
            ));
        }
        assert!(is_product_url(
            "Allianz",
            "https://www.allianz.it/le-soluzioni-per-te/salute/allianz-ultra-salute.html",
            "assicurazioni"
        ));
    }
    #[test]
    fn unknown_price_not_zero() {
        let h="<html><head><title>Casa</title></head><body><main><h1>Casa</h1><p>Una copertura della casa con condizioni specifiche. Richiedi un preventivo per conoscere premio, franchigie e massimali applicabili.</p></main></body></html>";
        let o = parse_product(
            Source {
                name: "Bene",
                url: "https://www.bene.it/",
            },
            "assicurazioni",
            "https://www.bene.it/casa/",
            "",
            h,
        )
        .unwrap();
        assert!(o.monthly_price.is_none());
        assert!(o.first_year_cost.is_none());
        assert!(o
            .source_evidence()
            .unwrap()
            .contains("Una copertura della casa"));
        assert!(!o.evidence.contains("Premio su preventivo personale."));
    }
    #[test]
    fn mobile_is_not_classified_by_fibra_in_parent_path() {
        let html = r#"<html><head><title>Fastweb Mobile Start</title><meta name="Description" content="Offerta mobile"></head><body><main><p>Offerta mobile con canone mensile, minuti e giga inclusi. Consultare le condizioni di attivazione e gli eventuali costi aggiuntivi.</p><div class="spot"><h1>Fastweb Mobile Start</h1><div class="box_detail"><div class="blockprice">9,95 euro al mese</div></div></div></main></body></html>"#;
        let offer = parse_product(
            Source {
                name: "Fastweb",
                url: "https://www.fastweb.it/",
            },
            "internet",
            "https://www.fastweb.it/adsl-fibra-ottica/fastweb-mobile-start/",
            "",
            html,
        )
        .unwrap();
        assert_eq!(offer.subcategory, "mobile");
        assert_eq!(offer.monthly_price, Some(9.95));
        assert_eq!(offer.description, "Offerta mobile");
    }
    #[test]
    fn annual_mobile_cost_requires_explicit_terms() {
        let html = r#"<html><head><title>Mobile</title><script type="application/ld+json">{"@type":"Product","name":"iliad Mobile TEST","offers":{"price":"9.99","priceCurrency":"EUR","billingPeriod":"P1M","additionalProperty":[{"name":"Costo attivazione SIM","value":"9.99","unitText":"ONE-TIME"}]}}</script></head><body><main><i-packshot-price price="999" period="PER SEMPRE"></i-packshot-price><p>Offerta mobile con canone mensile, minuti e giga inclusi. Consultare le condizioni di attivazione e gli eventuali costi aggiuntivi.</p></main></body></html>"#;
        let source = Source {
            name: "Iliad",
            url: "https://www.iliad.it/",
        };
        let offer =
            parse_product(source, "internet", "https://www.iliad.it/test", "", html).unwrap();
        assert_eq!(offer.first_year_cost, Some(129.87));
        let uncertain = parse_product(
            source,
            "internet",
            "https://www.iliad.it/test",
            "",
            &html.replace("PER SEMPRE", "PROMO"),
        )
        .unwrap();
        assert!(uncertain.first_year_cost.is_none());
    }
}
