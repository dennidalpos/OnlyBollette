use crate::domain::{now, web_url, Offer, SourceResult};
use regex::Regex;
use scraper::{Html, Selector};
use std::{collections::HashSet, path::Path, time::Duration};

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
            Source {
                name: "TIM",
                url: "https://www.tim.it/fisso-e-mobile/fibra-e-adsl",
            },
            Source {
                name: "Sky Wifi",
                url: "https://www.sky.it/offerte/wifi/solo-internet",
            },
            Source {
                name: "PosteCasa",
                url: "https://www.poste.it/fibra/postecasa-ultraveloce",
            },
            Source {
                name: "EOLO",
                url: "https://www.eolo.it/offerte",
            },
            Source {
                name: "Tiscali",
                url: "https://abbonati.tiscali.it/fibra/casa-fibra-power/",
            },
            Source {
                name: "CoopVoce",
                url: "https://www.coopvoce.it/portale/offerte.html",
            },
            Source {
                name: "Kena",
                url: "https://www.kenamobile.it/offerte/",
            },
            Source {
                name: "Dimensione",
                url: "https://www.dimensione.com/portale/index.php",
            },
            Source {
                name: "BBBell",
                url: "https://www.bbbell.it/privati/internet-family/",
            },
            Source {
                name: "BBBell Kiara",
                url: "https://www.bbbell.it/privati/internet-kiara-family/",
            },
            Source {
                name: "Enel Fibra",
                url: "https://www.enel.it/it-it/offerte-fibra",
            },
            Source {
                name: "Vodafone",
                url: "https://privati.vodafone.it/casa/fibra",
            },
            Source {
                name: "1Mobile",
                url: "https://www.unomobile.it/offerte/start-xplus-reward",
            },
            Source {
                name: "ho.",
                url: "https://www.ho-mobile.it/offer-home",
            },
            Source {
                name: "spusu",
                url: "https://www.spusu.it/",
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
    String::from_utf8(fetch_bytes(client, url, limit).await?)
        .map_err(|_| "Codifica del documento non supportata".into())
}

pub async fn fetch_bytes(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    web_url(url)?;
    let started = std::time::Instant::now();
    let diagnostic = std::env::var_os("ONLYBOLLETTE_SOURCE_DIAGNOSTICS").is_some();
    let endpoint = url::Url::parse(url)
        .map(|u| format!("{}{}", u.host_str().unwrap_or(""), u.path()))
        .unwrap_or_default();
    if diagnostic {
        eprintln!("source-request start {endpoint}");
    }
    let result = fetch_bytes_inner(client, url, limit).await;
    if diagnostic {
        eprintln!(
            "source-request end {endpoint} elapsed_ms={} success={} bytes={}",
            started.elapsed().as_millis(),
            result.is_ok(),
            result.as_ref().map_or(0, Vec::len)
        );
    }
    result
}

async fn fetch_bytes_inner(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
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
    Ok(bytes)
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

pub async fn fetch(source: Source, category: &str, runtime: &Path) -> SourceResult {
    let result = fetch_inner(source, category, runtime).await;
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

async fn fetch_inner(
    source: Source,
    category: &str,
    runtime: &Path,
) -> Result<(Vec<Offer>, bool), String> {
    let client = client()?;
    let html = fetch_text(&client, source.url, 8_000_000).await?;
    if category == "internet" && source.name == "spusu" {
        let catalog = fetch_text(
            &client,
            "https://www.spusu.it/imoscmsapi/config/landingpageitems",
            1_000_000,
        )
        .await?;
        return parse_spusu(source, &catalog);
    }
    if category == "internet" && source.name == "BBBell" {
        return parse_bbbell_family(source, &html);
    }
    if category == "internet" && source.name == "BBBell Kiara" {
        return parse_kiara(source, &html);
    }
    if category == "internet" && source.name == "Enel Fibra" {
        return parse_enel_fibra(source, &html);
    }
    if category == "internet" && source.name == "Vodafone" {
        let (mut offers, mut partial) = parse_vodafone(source, &html)?;
        match fetch_vodafone_ultra(&client, source, runtime).await {
            Ok(offer) => offers.push(offer),
            Err(error) => {
                if std::env::var_os("ONLYBOLLETTE_SOURCE_DIAGNOSTICS").is_some() {
                    eprintln!("source-document Vodafone Casa Ultra: {error}");
                }
                partial = true;
                for offer in &mut offers {
                    offer.conditions.push("Catalogo Vodafone parziale: Casa Ultra non verificabile nel prospetto ufficiale.".into());
                }
            }
        }
        return Ok((offers, partial));
    }
    if category == "internet" && source.name == "1Mobile" {
        let (mut offers, _) = parse_unomobile(source, &html)?;
        let mut partial = false;
        let catalog_url = "https://www.unomobile.it/offerte/per-tutti";
        let catalog = match fetch_text(&client, catalog_url, 8_000_000).await {
            Ok(page) => parse_unomobile_catalog(&page),
            Err(error) => Err(error),
        };
        let listed = match catalog {
            Ok(listed) => listed,
            Err(_) => {
                partial = true;
                HashSet::new()
            }
        };
        let expected: HashSet<_> = [
            "start-xplus-reward",
            "speed-5g-180",
            "speed-5g-250",
            "flash-120",
            "world-plus-5g",
            "flash-5g-320-lim-edition",
            "xconnect",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();
        if listed != expected {
            partial = true;
        }
        for (slug, gigabytes) in [("speed-5g-180", 180), ("speed-5g-250", 250)] {
            let url = format!("https://www.unomobile.it/offerte/{slug}");
            match fetch_text(&client, &url, 8_000_000).await {
                Ok(page) => match parse_unomobile_speed(source, &url, gigabytes, &page) {
                    Ok(offer) => offers.push(offer),
                    Err(_) => partial = true,
                },
                Err(_) => partial = true,
            }
        }
        for slug in ["flash-120", "world-plus-5g", "flash-5g-320-lim-edition"] {
            let url = format!("https://www.unomobile.it/offerte/{slug}");
            match fetch_text(&client, &url, 8_000_000).await {
                Ok(page) => match parse_unomobile_extra(source, &url, slug, &page) {
                    Ok(offer) => offers.push(offer),
                    Err(_) => partial = true,
                },
                Err(_) => partial = true,
            }
        }
        if listed.contains("xconnect") {
            let url = "https://www.unomobile.it/offerte/xconnect";
            match fetch_text(&client, url, 8_000_000).await {
                Ok(page) => match parse_unomobile_xconnect(source, url, &page) {
                    Ok(offer) => offers.push(offer),
                    Err(_) => partial = true,
                },
                Err(_) => partial = true,
            }
        }
        if partial {
            for offer in &mut offers {
                offer
                    .conditions
                    .push("Catalogo 1Mobile parziale: alcune schede non sono leggibili.".into());
            }
        }
        return Ok((offers, partial));
    }
    if category == "internet" && source.name == "ho." {
        let (mut offers, _) = parse_ho_home(source, &html)?;
        let catalog_url = "https://www.ho-mobile.it/tutte-le-offerte";
        let partial = match fetch_text(&client, catalog_url, 8_000_000).await {
            Ok(catalog) => match parse_ho_mobile_catalog(source, catalog_url, &catalog) {
                Ok((mobile, partial)) => {
                    offers.extend(mobile);
                    partial
                }
                Err(_) => true,
            },
            Err(_) => true,
        };
        if partial {
            for offer in &mut offers {
                offer
                    .conditions
                    .push("Catalogo ho. parziale: alcune schede non sono leggibili.".into());
            }
        }
        return Ok((offers, partial));
    }
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
        // Site-hydrated navigation: product URLs are curated entrypoints.
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
    } else if category == "internet" && matches!(source.name, "Sky Wifi" | "PosteCasa" | "Tiscali")
    {
        vec![(source.url.into(), String::new())]
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
            "TIM" => [
                "/fisso-e-mobile/fibra-e-adsl/fibra-wifi-casa",
                "/fisso-e-mobile/fibra-e-adsl/fibra-solo-online",
            ]
            .contains(&p),
            "EOLO" => [
                "/offerte/eolo-casa",
                "/offerte/eolo-casa-plus",
                "/offerte/eolo-casa-max",
                "/offerte/eolo-casa-fibra",
                "/offerte/eolo-casa-fibra-max",
                "/offerte/internet-seconda-casa",
            ]
            .contains(&p),
            "CoopVoce" => [
                "/content/coopvoce/portale/offerte/turbo-400.html",
                "/content/coopvoce/portale/offerte/turbo-200.html",
                "/content/coopvoce/portale/offerte/evo-simple.html",
                "/content/coopvoce/portale/offerte/evo-30.html",
            ]
            .contains(&p),
            "Kena" => p.starts_with("/prodotto/") && !p.contains("kena-pack"),
            "Sky Wifi" => p == "/offerte/wifi/solo-internet",
            "PosteCasa" => p == "/fibra/postecasa-ultraveloce",
            "Tiscali" => p == "/fibra/casa-fibra-power/",
            "BBBell" => {
                u.scheme() == "https"
                    && u.host_str() == Some("www.bbbell.it")
                    && p == "/privati/internet-family/"
            }
            "BBBell Kiara" => {
                u.scheme() == "https"
                    && u.host_str() == Some("www.bbbell.it")
                    && p == "/privati/internet-kiara-family/"
            }
            "Enel Fibra" => {
                u.scheme() == "https"
                    && u.host_str() == Some("www.enel.it")
                    && p.starts_with("/it-it/offerte-fibra/")
            }
            "Vodafone" => {
                u.scheme() == "https"
                    && ((u.host_str() == Some("privati.vodafone.it") && p == "/casa/fibra")
                        || (u.host_str() == Some("www.vodafone.it")
                            && p == "/privati/area-supporto/contratti-aggiornamenti/condizioni-generali-reti-servizi/tariffe/contratti-attivabili/casa-ultra.html"))
            }
            "1Mobile" => {
                u.scheme() == "https"
                    && u.host_str() == Some("www.unomobile.it")
                    && matches!(
                        p,
                        "/offerte/start-xplus-reward"
                            | "/offerte/speed-5g-180"
                            | "/offerte/speed-5g-250"
                            | "/offerte/flash-120"
                            | "/offerte/world-plus-5g"
                            | "/offerte/flash-5g-320-lim-edition"
                            | "/offerte/xconnect"
                    )
            }
            "ho." => {
                u.scheme() == "https"
                    && u.host_str() == Some("www.ho-mobile.it")
                    && matches!(p, "/offer-home" | "/tutte-le-offerte")
            }
            "spusu" => {
                u.scheme() == "https"
                    && u.host_str() == Some("www.spusu.it")
                    && matches!(p, "/spusu1" | "/spusu150xl" | "/spusu200xl5g")
            }
            "Dimensione" => [
                "/portale/fibra-internet-casa-ftth-2.5-giga.php",
                "/portale/fibra-internet-10-giga-con-fritzbox-4690.php",
                "/portale/fibra-internet-casa-ftth-molise-10-giga.php",
                "/portale/internet-fwa.php",
                "/portale/internet-ultraveloce-fwa-300.php",
            ]
            .contains(&p),
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

fn parse_bbbell_family(source: Source, html: &str) -> Result<(Vec<Offer>, bool), String> {
    let doc = Html::parse_document(html);
    let shared: Vec<_> = doc
        .select(&selector(".et_pb_text_inner p"))
        .map(|p| clean(&p.text().collect::<Vec<_>>().join(" ")))
        .filter(|text| {
            let lower = text.to_lowercase();
            lower.contains("scelgo 24") || lower.contains("codice promozionale")
        })
        .collect();
    if !shared
        .iter()
        .any(|text| text.to_lowercase().contains("scelgo 24"))
    {
        return Err(
            "Condizioni della promozione BBBell non leggibili. Consultare la fonte ufficiale."
                .into(),
        );
    }
    let name_pattern = Regex::new(r"^Family \d+(?: Super)?$").expect("BBBell family name");
    let price_pattern = Regex::new(r"^(\d+,\d{2}) € (\d+,\d{2})$").expect("BBBell price pair");
    let mut offers = Vec::new();
    let mut seen = HashSet::new();
    let mut partial = false;
    for card in doc.select(&selector(".dica-item-content")) {
        let name = card
            .select(&selector("h4.item-title"))
            .next()
            .map(|h| clean(&h.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
        let price = card
            .select(&selector(".carousel-price"))
            .next()
            .map(|p| clean(&p.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
        let period = card
            .select(&selector(".carousel-price-period"))
            .next()
            .map(|p| clean(&p.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
        let has_campaign = period.contains("MKT+VV");
        let captures = price_pattern.captures(&price);
        if !name_pattern.is_match(&name)
            || captures.is_none()
            || !period.contains("al mese")
            || !period.contains("promo")
            || (has_campaign && !shared.iter().any(|text| text.contains("MKT+VV")))
        {
            partial = true;
            continue;
        }
        if !seen.insert(name.clone()) {
            return Err("Varianti BBBell duplicate: catalogo non verificabile.".into());
        }
        let captures = captures.expect("validated price pair");
        let monthly = captures[2]
            .replace(',', ".")
            .parse::<f64>()
            .map_err(|_| "Canone BBBell non leggibile")?;
        let card_text = clean(&card.text().collect::<Vec<_>>().join(" "));
        let terms = shared
            .iter()
            .filter(|text| has_campaign || !text.contains("MKT+VV"))
            .cloned()
            .collect::<Vec<_>>();
        let evidence = format!("{card_text}\n{}", terms.join("\n"));
        let mut conditions = vec![
            format!("Canone promozionale: {} €/mese; prezzo barrato pubblicato: {} €/mese. Non è il costo totale.", &captures[2], &captures[1]),
            "Verificare copertura, attivazione, vincoli e costi aggiuntivi nel preventivo e nella trasparenza tariffaria BBBell.".into(),
        ];
        conditions.extend(terms);
        offers.push(Offer {
            id: format!("{}#{}", source.url, name.to_lowercase().replace(' ', "-")),
            category: "internet".into(),
            subcategory: "fwa".into(),
            provider: source.name.into(),
            name,
            description: card_text,
            url: source.url.into(),
            source: source.name.into(),
            source_url: source.url.into(),
            fetched_at: now(),
            valid_until: None,
            price_type: "advertised".into(),
            monthly_price: Some(monthly),
            first_year_cost: None,
            components: vec![],
            conditions,
            evidence,
            evidence_version: 1,
            restricted: true,
            electricity_rates: None,
        });
    }
    if offers.is_empty() {
        return Err("Nessuna variante BBBell Family leggibile.".into());
    }
    if partial {
        for offer in &mut offers {
            offer.conditions.push(
                "Catalogo BBBell Family parziale: alcune varianti non sono leggibili.".into(),
            );
        }
    }
    Ok((offers, partial))
}

fn scoped_fibre_offer(
    source: Source,
    name: String,
    url: String,
    text: String,
    monthly: Option<f64>,
) -> Offer {
    Offer {
        id: format!("{}#{}", source.url, name.to_lowercase().replace(' ', "-")),
        category: "internet".into(), subcategory: "fibra".into(),
        provider: if source.name == "BBBell Kiara" { "BBBell" } else { "Enel Energia" }.into(),
        name, description: text.clone(), url, source: source.name.into(), source_url: source.url.into(),
        fetched_at: now(), valid_until: None, price_type: "advertised".into(), monthly_price: monthly,
        first_year_cost: None, components: vec![], conditions: vec![
            "Verificare copertura, requisiti, durata della promozione, attivazione, apparati e recesso nelle condizioni dell'offerta. Il canone pubblicizzato non è un costo totale.".into(),
            text.clone(),
        ], evidence: text, evidence_version: 1, restricted: true, electricity_rates: None,
    }
}

fn parse_kiara(source: Source, html: &str) -> Result<(Vec<Offer>, bool), String> {
    let doc = Html::parse_document(html);
    let cards: Vec<_> = doc.select(&selector(".dica-item-content")).collect();
    let title = |card: scraper::ElementRef<'_>| {
        card.select(&selector("h4.item-title"))
            .next()
            .map(|h| clean(&h.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default()
    };
    let promotion = cards
        .iter()
        .find(|c| title(**c) == "Promo Kiara Super")
        .map(|c| clean(&c.text().collect::<Vec<_>>().join(" ")))
        .unwrap_or_default();
    let campaign = doc
        .select(&selector(".et_pb_text_inner p"))
        .map(|p| clean(&p.text().collect::<Vec<_>>().join(" ")))
        .filter(|t| t.contains("MKT+VV"))
        .collect::<Vec<_>>()
        .join("\n");
    let price = Regex::new(r"€\s*\d+,\d{2}").expect("Kiara displayed price");
    let mut offers = Vec::new();
    let mut seen = HashSet::new();
    let mut partial = false;
    for card in cards {
        let name = title(card);
        if name == "Promo Kiara Super" {
            continue;
        }
        let text = clean(&card.text().collect::<Vec<_>>().join(" "));
        let super_fibre = name == "Kiara Super Family";
        let recognized = super_fibre
            || matches!(
                name.as_str(),
                "Kiara Family Fast 100" | "Kiara Family Fast 200"
            );
        if !recognized
            || !text.contains("a partire da")
            || !text.contains("al mese")
            || !price.is_match(&text)
            || (super_fibre
                && (!promotion.contains("Scelgo 24")
                    || !promotion.contains("PCN")
                    || !promotion.contains("noleggio")
                    || campaign.is_empty()))
            || (!super_fibre && !text.contains("noleggio"))
        {
            partial = true;
            continue;
        }
        if !seen.insert(name.clone()) {
            return Err("Varianti Kiara duplicate: catalogo non verificabile.".into());
        }
        let evidence = if super_fibre {
            format!("{text}\n{promotion}\n{campaign}")
        } else {
            text
        };
        let mut offer = scoped_fibre_offer(source, name, source.url.into(), evidence, None);
        offer.conditions.insert(0, "Prezzo a partire da: canone e noleggio effettivi richiedono la verifica della copertura e delle condizioni applicabili.".into());
        offers.push(offer);
    }
    if offers.is_empty() {
        return Err("Nessuna offerta Kiara verificabile. Consultare la fonte ufficiale.".into());
    }
    Ok((offers, partial))
}

fn parse_enel_fibra(source: Source, html: &str) -> Result<(Vec<Offer>, bool), String> {
    let doc = Html::parse_document(html);
    let mut offers = Vec::new();
    let mut seen = HashSet::new();
    let mut partial = false;
    let price_pattern = Regex::new(r"^\d+,\d{2}$").expect("Enel card price");
    for card in doc.select(&selector(".commodity-card-xs")) {
        let name = card
            .select(&selector(
                "h3.commodity-card-xs__content__body__information__product__title",
            ))
            .next()
            .map(|h| clean(&h.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
        if !name.to_lowercase().starts_with("enel fibra") {
            partial = true;
            continue;
        }
        let prices: HashSet<_> = card.select(&selector(".commodity-card-xs__content__body__information__price__detail__price__discounted .price"))
            .map(|p| clean(&p.text().collect::<Vec<_>>().join(" "))).collect();
        let notes = card
            .select(&selector(".bottom-sheet .content__text"))
            .next()
            .map(|p| clean(&p.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
        let text = clean(&card.text().collect::<Vec<_>>().join(" "));
        let href = card
            .select(&selector(
                "a[data-product-sku][data-commodity-type='fibra']",
            ))
            .next()
            .and_then(|a| a.value().attr("href"));
        let url = href
            .and_then(|href| url::Url::parse(source.url).ok()?.join(href).ok())
            .filter(|url| {
                url.scheme() == "https"
                    && url.host_str() == Some("www.enel.it")
                    && url.path().starts_with("/it-it/offerte-fibra/")
            });
        let valid_price = prices.len() == 1 && prices.iter().all(|p| price_pattern.is_match(p));
        if !valid_price
            || url.is_none()
            || !notes.contains(&name)
            || !notes.to_lowercase().contains("canone base")
            || !notes.to_lowercase().contains("recesso")
            || !text.to_lowercase().contains("modem")
        {
            partial = true;
            continue;
        }
        let price = prices.into_iter().next().expect("validated price");
        if !notes.contains(&price) {
            partial = true;
            continue;
        }
        let url = url.expect("validated URL").to_string();
        if !seen.insert(url.clone()) {
            return Err("Offerte Enel duplicate: catalogo non verificabile.".into());
        }
        let monthly = price
            .replace(',', ".")
            .parse::<f64>()
            .map_err(|_| "Canone Enel non leggibile")?;
        offers.push(scoped_fibre_offer(source, name, url, text, Some(monthly)));
    }
    if offers.is_empty() {
        return Err(
            "Nessuna offerta Enel Fibra verificabile. Consultare la fonte ufficiale.".into(),
        );
    }
    Ok((offers, partial))
}

fn find_vodafone_card<'a>(
    value: &'a serde_json::Value,
    slug: &str,
) -> Option<&'a serde_json::Value> {
    if value.get("slug").and_then(|v| v.as_str()) == Some(slug) {
        return Some(value);
    }
    match value {
        serde_json::Value::Array(items) => {
            items.iter().find_map(|item| find_vodafone_card(item, slug))
        }
        serde_json::Value::Object(items) => items
            .values()
            .find_map(|item| find_vodafone_card(item, slug)),
        _ => None,
    }
}

fn parse_ho_home(source: Source, html: &str) -> Result<(Vec<Offer>, bool), String> {
    let doc = Html::parse_document(html);
    let header = doc
        .select(&selector(".ho-product-header_bg_offer-container"))
        .next()
        .ok_or("Scheda ho. casa non leggibile. Consultare la fonte ufficiale.")?;
    let title = header
        .select(&selector("h1"))
        .next()
        .map(|h| clean(&h.text().collect::<Vec<_>>().join(" ")))
        .unwrap_or_default();
    let title = if title.is_empty() {
        doc.select(&selector(".ho-product-header_bg_clients h1"))
            .next()
            .map(|h| clean(&h.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default()
    } else {
        title
    };
    let details = clean(&header.text().collect::<Vec<_>>().join(" "));
    let cost_box = doc
        .select(&selector(
            ".ho-product-header__content.offer-6 .ho-product-header_right-box",
        ))
        .next()
        .ok_or("Costi ho. casa non leggibili. Consultare la fonte ufficiale.")?;
    let costs = clean(&cost_box.text().collect::<Vec<_>>().join(" "));
    let price_pattern = Regex::new(r"^(\d{1,3})\s*,\s*(\d{2})€$").expect("ho. card price");
    let prices = [
        (".offer-new-usersMobile .ho-product-header_bg_offer-box_detail_content_price", "nuovi", "nuovi clienti"),
        (".ho-product-header_bg_offer-box__container .ho-product-header_bg_offer-box .ho-product-header_bg_offer-box_detail_content_price", "clienti", "clienti ho."),
    ];
    if title != "ho. una SIM Dati per la casa"
        || !details.contains("500 Giga in 5G")
        || !costs.contains("Attivazione 5,99€")
        || !costs.contains("SIM Gratis")
        || !costs.contains("Per i nuovi clienti la ricarica è di 15,00 €")
        || !costs.contains("12,95€ per i già clienti")
        || !costs.contains("Per i nuovi clienti il costo totale è di 20,99€")
    {
        return Err(
            "Prezzi o condizioni ho. casa non verificabili. Consultare la fonte ufficiale.".into(),
        );
    }
    let mut offers = Vec::new();
    for (selector_text, slug, audience) in prices {
        let price = header
            .select(&selector(selector_text))
            .next()
            .map(|p| clean(&p.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();
        let captures = price_pattern
            .captures(&price)
            .ok_or("Canone ho. casa non leggibile")?;
        let monthly = format!("{}.{}", &captures[1], &captures[2])
            .parse::<f64>()
            .map_err(|_| "Canone ho. casa non leggibile")?;
        if !costs.contains(&price.replace(' ', "")) && !details.contains(&price.replace(' ', "")) {
            return Err("Canoni ho. casa discordanti. Consultare la fonte ufficiale.".into());
        }
        offers.push(Offer {
            id: format!("{}#{slug}", source.url),
            category: "internet".into(),
            subcategory: "fwa".into(),
            provider: source.name.into(),
            name: format!("ho. SIM Dati Casa ({audience})"),
            description: "SIM dati 500 GB in 5G per la casa".into(),
            url: source.url.into(),
            source: source.name.into(),
            source_url: source.url.into(),
            fetched_at: now(),
            valid_until: None,
            price_type: "advertised".into(),
            monthly_price: Some(monthly),
            first_year_cost: None,
            components: vec![],
            conditions: vec![
                format!("Canone pubblicizzato per {audience}: {monthly:.2} €/mese; verificare idoneità e copertura."),
                "Attivazione indicata: 5,99 €; SIM gratuita. La prima ricarica e l'importo iniziale cambiano secondo il tipo di cliente.".into(),
                "Il router è acquistabile separatamente; il canone della SIM non è un costo totale annuo.".into(),
            ],
            evidence: format!("{title}\n{details}\n{costs}"),
            evidence_version: 1,
            restricted: true,
            electricity_rates: None,
        });
    }
    Ok((offers, false))
}

fn parse_ho_mobile_catalog(
    source: Source,
    catalog_url: &str,
    html: &str,
) -> Result<(Vec<Offer>, bool), String> {
    let doc = Html::parse_document(html);
    let cards: Vec<_> = doc
        .select(&selector(
            ".offerCarousel__allOffers .offerCarousel__slider__card[data-offerlink]",
        ))
        .collect();
    if cards.is_empty() {
        return Err("Catalogo mobile ho. non leggibile. Consultare la fonte ufficiale.".into());
    }
    let mut offers = Vec::new();
    let mut partial = false;
    let price_pattern = Regex::new(r"^\d{1,3},\d{2}$").expect("ho. mobile price");
    for (slug, gigabytes) in [("132", 150), ("133", 250), ("134", 150), ("135", 250)] {
        let path = format!("/flussi-attivazione.{slug}.html");
        let Some(card) = cards
            .iter()
            .find(|card| card.value().attr("data-offerlink") == Some(path.as_str()))
        else {
            partial = true;
            continue;
        };
        let field = |css: &str| {
            card.select(&selector(css))
                .next()
                .map(|node| clean(&node.text().collect::<Vec<_>>().join(" ")))
                .unwrap_or_default()
        };
        let data = field(".offerCarousel__slider__card__stripe__firstLine");
        let inclusion = field(".offerCarousel__slider__card__stripe__secondLine");
        let euros = field(".offerCarousel__slider__card__price__value");
        let cents = field(".offerCarousel__slider__card__price__details__cent");
        let currency = field(".offerCarousel__slider__card__price__details__currency");
        let frequency = field(".offerCarousel__slider__card__price__details__frequency");
        let activation = field(".offerCarousel__slider__card__activationInfo");
        let label = field(".offerCarousel__slider__card__label");
        let price = format!("{euros}{cents}");
        if data != format!("{gigabytes} Giga")
            || inclusion != "Minuti illimitati e 200 SMS"
            || !price_pattern.is_match(&price)
            || currency != "€"
            || frequency != "al mese"
            || !activation.contains("Attivazione a partire da 2,99€")
            || !activation.contains("alcuni operatori")
            || !matches!(label.as_str(), "Offerta 5G!" | "5G incluso!")
        {
            partial = true;
            continue;
        }
        let monthly = price
            .replace(',', ".")
            .parse::<f64>()
            .map_err(|_| "Canone mobile ho. non leggibile")?;
        if monthly <= 0.0 {
            partial = true;
            continue;
        }
        offers.push(Offer {
            id: format!("{catalog_url}#{slug}"),
            category: "internet".into(),
            subcategory: "mobile".into(),
            provider: source.name.into(),
            name: format!("ho. {gigabytes} Giga 5G ({price} €/mese)"),
            description: format!("{gigabytes} GB, minuti illimitati e 200 SMS"),
            url: catalog_url.into(),
            source: source.name.into(),
            source_url: catalog_url.into(),
            fetched_at: now(),
            valid_until: None,
            price_type: "advertised".into(),
            monthly_price: Some(monthly),
            first_year_cost: None,
            components: vec![],
            conditions: vec![
                "Canone pubblicizzato, non costo totale annuo. Verificare copertura 5G e condizioni applicabili.".into(),
                "Attivazione a partire da 2,99 € solo per alcuni operatori; verificare l'importo applicabile alla propria provenienza.".into(),
            ],
            evidence: format!("{label} {data} {inclusion} {price} € {frequency} {activation}"),
            evidence_version: 1,
            restricted: true,
            electricity_rates: None,
        });
    }
    if offers.is_empty() {
        return Err(
            "Nessuna offerta mobile ho. verificabile. Consultare la fonte ufficiale.".into(),
        );
    }
    Ok((offers, partial))
}

fn source_fragment_text(fragment: &str) -> String {
    let text = clean(
        &Html::parse_fragment(fragment)
            .root_element()
            .text()
            .collect::<Vec<_>>()
            .join(" "),
    );
    if text.contains("<li>") || text.contains("<p>") {
        clean(
            &Html::parse_fragment(&text)
                .root_element()
                .text()
                .collect::<Vec<_>>()
                .join(" "),
        )
    } else {
        text
    }
}

fn unomobile_bundle(html: &str) -> Result<serde_json::Value, String> {
    let doc = Html::parse_document(html);
    doc.select(&selector("script"))
        .filter_map(|script| {
            let script = script.text().collect::<String>();
            let start = script.find("window.bundle = ")? + "window.bundle = ".len();
            serde_json::Deserializer::from_str(&script[start..])
                .into_iter::<serde_json::Value>()
                .next()?
                .ok()
        })
        .next()
        .ok_or("Scheda 1Mobile non leggibile. Consultare la fonte ufficiale.".into())
}

fn parse_unomobile_catalog(html: &str) -> Result<HashSet<String>, String> {
    let doc = Html::parse_document(html);
    let bundles = doc
        .select(&selector("script"))
        .find_map(|script| {
            let script = script.text().collect::<String>();
            let start = script.find("const bundles = ")? + "const bundles = ".len();
            serde_json::Deserializer::from_str(&script[start..])
                .into_iter::<Vec<serde_json::Value>>()
                .next()?
                .ok()
        })
        .ok_or("Catalogo completo 1Mobile non leggibile")?;
    let mut slugs = HashSet::new();
    for bundle in bundles {
        if bundle.get("publish").and_then(|v| v.as_i64()) != Some(1) {
            continue;
        }
        let slug = bundle
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or("Percorso offerta 1Mobile non leggibile")?;
        if slug.is_empty()
            || slug.len() > 80
            || !slug
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || !slugs.insert(slug.to_string())
        {
            return Err("Catalogo 1Mobile contiene percorsi non verificabili".into());
        }
    }
    if slugs.is_empty() {
        return Err("Catalogo completo 1Mobile vuoto".into());
    }
    Ok(slugs)
}

fn parse_unomobile_xconnect(source: Source, url: &str, html: &str) -> Result<Offer, String> {
    let bundle = unomobile_bundle(html)?;
    if bundle.get("name").and_then(|v| v.as_str()) != Some("XConnect")
        || bundle.get("url").and_then(|v| v.as_str()) != Some("xconnect")
        || bundle.get("publish").and_then(|v| v.as_i64()) != Some(1)
        || bundle.get("data").and_then(|v| v.as_str()) != Some("1")
        || bundle.get("sms").and_then(|v| v.as_str()) != Some("50")
        || bundle.get("min").and_then(|v| v.as_str()) != Some("100")
    {
        return Err("Dotazione XConnect non verificabile".into());
    }
    let overview = source_fragment_text(
        bundle
            .get("overview")
            .and_then(|v| v.as_str())
            .ok_or("Condizioni XConnect non leggibili")?,
    );
    let note = source_fragment_text(
        bundle
            .get("note")
            .and_then(|v| v.as_str())
            .ok_or("Note XConnect non leggibili")?,
    );
    let activation = source_fragment_text(
        bundle
            .get("activation_info")
            .and_then(|v| v.as_str())
            .ok_or("Attivazione XConnect non leggibile")?,
    );
    let price_pattern = Regex::new(r"prezzo (\d+),(\d{2})€/mese fino al (\d{2}/\d{2}/\d{4})")
        .expect("XConnect price and deadline");
    let captures = price_pattern
        .captures(&note)
        .ok_or("Canone XConnect non verificabile")?;
    let monthly = format!("{}.{}", &captures[1], &captures[2])
        .parse::<f64>()
        .map_err(|_| "Canone XConnect non leggibile")?;
    let deadline = &captures[3];
    let valid_until = chrono::NaiveDate::parse_from_str(deadline, "%d/%m/%Y")
        .map_err(|_| "Scadenza XConnect non valida")?
        .format("%Y-%m-%d")
        .to_string();
    if monthly <= 0.0
        || bundle.get("price").and_then(|v| v.as_f64()) != Some(monthly)
        || !overview.contains("Internet of things")
        || !overview.contains("10€")
        || !overview.contains(&format!("fino al {deadline}"))
        || !activation.contains("10€")
        || !note.contains("si rinnova in automatico ogni mese")
    {
        return Err("Prezzi o condizioni XConnect discordanti".into());
    }
    let offer = Offer {
        id: url.into(),
        category: "internet".into(),
        subcategory: "mobile".into(),
        provider: source.name.into(),
        name: "XConnect".into(),
        description: "SIM IoT/domotica: 1 GB, 100 minuti e 50 SMS".into(),
        url: url.into(),
        source: source.name.into(),
        source_url: url.into(),
        fetched_at: now(),
        valid_until: Some(valid_until),
        price_type: "advertised".into(),
        monthly_price: Some(monthly),
        first_year_cost: None,
        components: vec![],
        conditions: vec![
            "Offerta per dispositivi IoT e domotica; 1 GB, 100 minuti e 50 SMS al mese.".into(),
            format!("Canone {monthly:.2} €/mese e attivazione 10 €. Verificare l'eventuale costo SIM separato."),
            format!("Sottoscrivibile alle condizioni pubblicate fino al {deadline}; questa data non garantisce dodici mesi di prezzo."),
        ],
        evidence: format!("{overview}\n{activation}\n{note}"),
        evidence_version: 1,
        restricted: true,
        electricity_rates: None,
    };
    if !offer.active() {
        return Err("Offerta XConnect non più sottoscrivibile alle condizioni pubblicate.".into());
    }
    Ok(offer)
}

fn parse_unomobile(source: Source, html: &str) -> Result<(Vec<Offer>, bool), String> {
    let bundle = unomobile_bundle(html)?;
    if bundle.get("name").and_then(|v| v.as_str()) != Some("Start XPlus Reward")
        || bundle.get("publish").and_then(|v| v.as_i64()) != Some(1)
    {
        return Err("Scheda 1Mobile non verificabile. Consultare la fonte ufficiale.".into());
    }
    let overview = source_fragment_text(
        bundle
            .get("overview")
            .and_then(|v| v.as_str())
            .ok_or("Condizioni 1Mobile non leggibili")?,
    );
    let note = source_fragment_text(
        bundle
            .get("note")
            .and_then(|v| v.as_str())
            .ok_or("Note 1Mobile non leggibili")?,
    );
    let activation = clean(
        bundle
            .get("activation_info")
            .and_then(|v| v.as_str())
            .ok_or("Attivazione 1Mobile non leggibile")?,
    );
    let price = Regex::new(r"prezzo\s+(\d+,\d{2})€/mese").expect("1Mobile initial price");
    let later =
        Regex::new(r"dal 3°\s*rinnovo[^.]{0,100}?(\d+,\d{2})€").expect("1Mobile later price");
    let deadline =
        Regex::new(r"fino al (\d{2})/(\d{2})/(\d{4})").expect("1Mobile subscription deadline");
    let initial = price
        .captures(&note)
        .ok_or("Canone iniziale 1Mobile non verificabile")?[1]
        .replace(',', ".")
        .parse::<f64>()
        .map_err(|_| "Canone iniziale 1Mobile non leggibile")?;
    let later = later
        .captures(&note)
        .ok_or("Canone successivo 1Mobile non verificabile")?[1]
        .replace(',', ".")
        .parse::<f64>()
        .map_err(|_| "Canone successivo 1Mobile non leggibile")?;
    let date = deadline
        .captures(&overview)
        .ok_or("Scadenza 1Mobile non verificabile")?;
    let published_date = format!("{}/{}/{}", &date[1], &date[2], &date[3]);
    let valid_until = chrono::NaiveDate::parse_from_str(&published_date, "%d/%m/%Y")
        .map_err(|_| "Scadenza 1Mobile non valida")?
        .format("%Y-%m-%d")
        .to_string();
    let shown_price = bundle
        .get("price")
        .and_then(|v| v.as_f64())
        .ok_or("Canone pubblicato 1Mobile non leggibile")?;
    if !shown_price.is_finite()
        || shown_price <= 0.0
        || (shown_price - initial).abs() > 0.001
        || !note.contains(&format!("fino al {published_date}"))
        || !overview.contains("nuovi clienti in portabilità")
        || !overview.contains("nuove attivazioni")
        || !activation.contains("5€ Costo di attivazione per tutti i clienti in portabilità")
        || !activation.contains("10€ Costo di attivazione per nuove SIM")
        || !note.contains("entro il primo rinnovo")
        || !note.contains("verranno addebitati i 5€")
    {
        return Err(
            "Prezzi o condizioni 1Mobile discordanti. Consultare la fonte ufficiale.".into(),
        );
    }
    let offer = Offer {
        id: source.url.into(),
        category: "internet".into(),
        subcategory: "mobile".into(),
        provider: source.name.into(),
        name: "Start XPlus Reward".into(),
        description: "Offerta mobile Start XPlus Reward".into(),
        url: source.url.into(),
        source: source.name.into(),
        source_url: source.url.into(),
        fetched_at: now(),
        valid_until: Some(valid_until),
        price_type: "advertised".into(),
        monthly_price: Some(initial),
        first_year_cost: None,
        components: vec![],
        conditions: vec![
            format!("Canone iniziale: {initial:.2} €/mese; dal terzo rinnovo consecutivo: {later:.2} €/mese. Il canone mostrato non è un costo annuo."),
            format!("Sottoscrivibile alle condizioni pubblicate fino al {published_date}; questa data non garantisce dodici mesi di prezzo."),
            "Attivazione: 5 € in portabilità o 10 € per un nuovo numero. La portabilità deve completarsi entro il primo rinnovo, altrimenti sono addebitati altri 5 €.".into(),
        ],
        evidence: format!("{overview}\n{activation}\n{note}"),
        evidence_version: 1,
        restricted: true,
        electricity_rates: None,
    };
    if !offer.active() {
        return Err("Offerta 1Mobile non più sottoscrivibile alle condizioni pubblicate.".into());
    }
    Ok((vec![offer], false))
}

fn parse_unomobile_speed(
    source: Source,
    url: &str,
    gigabytes: u16,
    html: &str,
) -> Result<Offer, String> {
    let bundle = unomobile_bundle(html)?;
    let name = format!("Speed 5G {gigabytes}");
    if bundle.get("name").and_then(|v| v.as_str()).map(str::trim) != Some(name.as_str())
        || bundle.get("publish").and_then(|v| v.as_i64()) != Some(1)
    {
        return Err("Scheda Speed 5G non verificabile. Consultare la fonte ufficiale.".into());
    }
    let overview = source_fragment_text(
        bundle
            .get("overview")
            .and_then(|v| v.as_str())
            .ok_or("Condizioni Speed 5G non leggibili")?,
    );
    let note = source_fragment_text(
        bundle
            .get("note")
            .and_then(|v| v.as_str())
            .ok_or("Note Speed 5G non leggibili")?,
    );
    let activation = clean(
        bundle
            .get("activation_info")
            .and_then(|v| v.as_str())
            .ok_or("Attivazione Speed 5G non leggibile")?,
    );
    let price_pattern = Regex::new(
        r"prezzo (\d+(?:,\d{2})?)€/mese per il primo mese e (\d+,\d{2})€ dal (?:2°|secondo) mese fino al\s*(\d{2}/\d{2}/\d{4})",
    )
    .expect("Speed 5G renewal prices");
    let captures = price_pattern
        .captures(&note)
        .ok_or("Canoni Speed 5G non verificabili")?;
    let initial = captures[1]
        .replace(',', ".")
        .parse::<f64>()
        .map_err(|_| "Canone iniziale Speed 5G non leggibile")?;
    let later = captures[2]
        .replace(',', ".")
        .parse::<f64>()
        .map_err(|_| "Canone successivo Speed 5G non leggibile")?;
    let deadline = &captures[3];
    let subscription_end = chrono::NaiveDate::parse_from_str(deadline, "%d/%m/%Y")
        .map_err(|_| "Scadenza Speed 5G non valida")?
        .format("%Y-%m-%d")
        .to_string();
    if initial <= 0.0
        || later <= 0.0
        || bundle.get("price").and_then(|v| v.as_f64()) != Some(initial)
        || !overview.contains(&format!("fino al {deadline}"))
        || !overview.contains("nuovi clienti in portabilità da tutti gli operatori")
        || !overview.contains("nuovi numeri")
        || !activation.contains("GRATUITO in portabilità da TUTTI GLI OPERATORI")
        || !activation.contains("5€ per le nuove SIM")
        || bundle.get("data").and_then(|v| v.as_str()) != Some(gigabytes.to_string().as_str())
        || !source_fragment_text(
            bundle
                .get("additional_data")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        )
        .contains(&format!("{gigabytes} GB in 5G"))
    {
        return Err(
            "Prezzi o condizioni Speed 5G discordanti. Consultare la fonte ufficiale.".into(),
        );
    }
    let offer = Offer {
        id: url.into(),
        category: "internet".into(),
        subcategory: "mobile".into(),
        provider: source.name.into(),
        name,
        description: format!("Offerta mobile {gigabytes} GB 5G"),
        url: url.into(),
        source: source.name.into(),
        source_url: url.into(),
        fetched_at: now(),
        valid_until: Some(subscription_end),
        price_type: "advertised".into(),
        monthly_price: Some(initial),
        first_year_cost: None,
        components: vec![],
        conditions: vec![
            format!("Primo mese: {initial:.2} €; dal secondo mese: {later:.2} €/mese. Il canone mostrato non è un costo annuo."),
            format!("Sottoscrivibile alle condizioni pubblicate fino al {deadline}; questa data non garantisce dodici mesi di prezzo."),
            "Attivazione gratuita in portabilità da tutti gli operatori; 5 € per una nuova SIM. Verificare il completamento della portabilità entro il primo rinnovo.".into(),
        ],
        evidence: format!("{overview}\n{activation}\n{note}"),
        evidence_version: 1,
        restricted: true,
        electricity_rates: None,
    };
    if !offer.active() {
        return Err("Offerta Speed 5G non più sottoscrivibile alle condizioni pubblicate.".into());
    }
    Ok(offer)
}

fn parse_unomobile_extra(
    source: Source,
    url: &str,
    slug: &str,
    html: &str,
) -> Result<Offer, String> {
    let (name, gigabytes, activation_cost) = match slug {
        "flash-120" => ("Flash 120", "120", 4),
        "world-plus-5g" => ("World Plus 5G", "130", 5),
        "flash-5g-320-lim-edition" => ("Flash 5G 320 Limited Edition", "320", 10),
        _ => return Err("Scheda 1Mobile non prevista".into()),
    };
    let bundle = unomobile_bundle(html)?;
    if bundle.get("name").and_then(|v| v.as_str()).map(str::trim) != Some(name)
        || bundle.get("publish").and_then(|v| v.as_i64()) != Some(1)
        || bundle.get("data").and_then(|v| v.as_str()) != Some(gigabytes)
    {
        return Err("Scheda 1Mobile non verificabile. Consultare la fonte ufficiale.".into());
    }
    let overview = source_fragment_text(
        bundle
            .get("overview")
            .and_then(|v| v.as_str())
            .ok_or("Condizioni 1Mobile non leggibili")?,
    );
    let note = source_fragment_text(
        bundle
            .get("note")
            .and_then(|v| v.as_str())
            .ok_or("Note 1Mobile non leggibili")?,
    );
    let activation = source_fragment_text(
        bundle
            .get("activation_info")
            .and_then(|v| v.as_str())
            .ok_or("Attivazione 1Mobile non leggibile")?,
    );
    let (initial, later, deadline) = if slug == "flash-5g-320-lim-edition" {
        let pattern = Regex::new(r"prezzo (\d+,\d{2})€/mese per il primo mese, (\d+,\d{2})€ dal secondo mese e un ulteriore mese omaggio al completamento del primo rinnovo fino al\s*(\d{2}/\d{2}/\d{4})")
            .expect("Flash 320 price and bonus");
        let c = pattern
            .captures(&note)
            .ok_or("Canoni Flash 320 non verificabili")?;
        (c[1].to_string(), Some(c[2].to_string()), c[3].to_string())
    } else {
        let pattern = Regex::new(r"prezzo(?: di)? (\d+,\d{2})€/mese fino al\s*(\d{2}/\d{2}/\d{4})")
            .expect("1Mobile extra monthly price");
        let c = pattern
            .captures(&note)
            .ok_or("Canone 1Mobile non verificabile")?;
        (c[1].to_string(), None, c[2].to_string())
    };
    let monthly = initial
        .replace(',', ".")
        .parse::<f64>()
        .map_err(|_| "Canone 1Mobile non leggibile")?;
    let renewed = later
        .as_deref()
        .map(|value| value.replace(',', ".").parse::<f64>())
        .transpose()
        .map_err(|_| "Rinnovo 1Mobile non leggibile")?;
    let valid_until = chrono::NaiveDate::parse_from_str(&deadline, "%d/%m/%Y")
        .map_err(|_| "Scadenza 1Mobile non valida")?
        .format("%Y-%m-%d")
        .to_string();
    let activation_lower = activation.to_lowercase();
    if monthly <= 0.0
        || renewed.is_some_and(|value| value <= 0.0)
        || bundle.get("price").and_then(|v| v.as_f64()) != Some(monthly)
        || !overview.contains(&format!("fino al {deadline}"))
        || !overview.contains("nuovi numeri")
        || !activation.contains(&format!("{activation_cost}€"))
        || !activation_lower.contains("portabilità da tutti gli operatori")
        || !(activation_lower.contains("gratuito") || activation_lower.contains("gratis"))
        || !note.contains("entro il primo rinnovo")
        || (slug == "world-plus-5g"
            && !(note.contains("3° rinnovo consecutivo") && note.contains("20GB")))
        || (slug == "flash-5g-320-lim-edition"
            && !(note.contains("credito viene erogato immediatamente dopo il primo rinnovo")
                && note.contains("non da diritto ad alcun rimborso")))
    {
        return Err(
            "Prezzi o condizioni 1Mobile discordanti. Consultare la fonte ufficiale.".into(),
        );
    }
    let mut conditions = vec![
        format!("Sottoscrivibile alle condizioni pubblicate fino al {deadline}; questa data non garantisce dodici mesi di prezzo."),
        format!("Attivazione gratuita in portabilità da tutti gli operatori; {activation_cost} € per una nuova SIM. La portabilità deve completarsi entro il primo rinnovo."),
    ];
    if let Some(renewed) = renewed {
        conditions.push(format!("Primo mese: {monthly:.2} €; dal secondo mese: {renewed:.2} €/mese. Il canone mostrato non è un costo annuo."));
        conditions.push("Una mensilità omaggio viene accreditata dopo il primo rinnovo completato; il credito non è rimborsabile e può essere recuperato se la portabilità non si completa.".into());
    } else {
        conditions.push("Canone mensile pubblicizzato; non è un costo annuo.".into());
    }
    if slug == "world-plus-5g" {
        conditions.push("20 GB aggiuntivi dal terzo rinnovo consecutivo; verificare l'idoneità dei nuovi numeri nelle condizioni dell'offerta.".into());
    }
    let offer = Offer {
        id: url.into(),
        category: "internet".into(),
        subcategory: "mobile".into(),
        provider: source.name.into(),
        name: name.into(),
        description: format!("Offerta mobile {gigabytes} GB"),
        url: url.into(),
        source: source.name.into(),
        source_url: url.into(),
        fetched_at: now(),
        valid_until: Some(valid_until),
        price_type: "advertised".into(),
        monthly_price: Some(monthly),
        first_year_cost: None,
        components: vec![],
        conditions,
        evidence: format!("{overview}\n{activation}\n{note}"),
        evidence_version: 1,
        restricted: true,
        electricity_rates: None,
    };
    if !offer.active() {
        return Err("Offerta 1Mobile non più sottoscrivibile alle condizioni pubblicate.".into());
    }
    Ok(offer)
}

fn parse_spusu(source: Source, json: &str) -> Result<(Vec<Offer>, bool), String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|_| "Catalogo spusu non leggibile. Consultare la fonte ufficiale.")?;
    let cards = value
        .get("tariffs")
        .and_then(|v| v.as_array())
        .ok_or("Catalogo spusu non leggibile. Consultare la fonte ufficiale.")?;
    let mut offers = Vec::new();
    let mut partial = false;
    for card in cards {
        let slug = card
            .get("tariffDetailLink")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let Some(expected_name) = (match slug {
            "spusu1" => Some("spusu 1"),
            "spusu150xl" => Some("spusu 150 XL"),
            "spusu200xl5g" => Some("spusu 200 XL 5G"),
            _ => None,
        }) else {
            partial = true;
            continue;
        };
        let model = &card["tariffModel"];
        let fee = &model["fees"]["contractFee"];
        let monthly = fee["amount"].as_f64();
        let description = model["balanceAndCostDescription"].as_str().unwrap_or("");
        if model["tariffModelName"].as_str() != Some(expected_name)
            || model["paymentType"].as_str() != Some("PRE_PAID")
            || model["billPeriod"]["billPeriodType"].as_str() != Some("MONTHLY")
            || fee["currencyCode"].as_str() != Some("EUR")
            || model["fees"]["packageFee"] != *fee
            || !monthly.is_some_and(|price| price > 0.0 && price.is_finite())
            || !model["balances"]["nationalData"]["value"]
                .as_f64()
                .is_some_and(|data| data > 0.0)
            || description.is_empty()
        {
            partial = true;
            continue;
        }
        let url = format!("https://www.spusu.it/{slug}");
        let special = card["specialDeals"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|deal| deal["specialDealText"].as_str())
            .collect::<Vec<_>>();
        let mut conditions = vec![
            "Canone pubblicizzato, non costo totale. Verificare condizioni, traffico incluso e costi ulteriori nella scheda ufficiale.".into(),
        ];
        for note in &special {
            conditions.push(format!(
                "{note}. La data di sottoscrizione non garantisce dodici mesi di prezzo."
            ));
        }
        offers.push(Offer {
            id: url.clone(),
            category: "internet".into(),
            subcategory: "mobile".into(),
            provider: source.name.into(),
            name: expected_name.into(),
            description: description.into(),
            url,
            source: source.name.into(),
            source_url: source.url.into(),
            fetched_at: now(),
            valid_until: None,
            price_type: "advertised".into(),
            monthly_price: monthly,
            first_year_cost: None,
            components: vec![],
            conditions,
            evidence: format!("{expected_name} {description} {}", special.join(" "))
                .trim()
                .into(),
            evidence_version: 1,
            restricted: true,
            electricity_rates: None,
        });
    }
    if offers.is_empty() {
        return Err("Nessuna offerta spusu verificabile. Consultare la fonte ufficiale.".into());
    }
    if partial {
        for offer in &mut offers {
            offer
                .conditions
                .push("Catalogo spusu parziale: alcune schede non sono leggibili.".into());
        }
    }
    Ok((offers, partial))
}

fn parse_vodafone(source: Source, html: &str) -> Result<(Vec<Offer>, bool), String> {
    let doc = Html::parse_document(html);
    let payload = doc
        .select(&selector("script#__NEXT_DATA__[type='application/json']"))
        .next()
        .ok_or("Catalogo Vodafone non leggibile. Consultare la fonte ufficiale.")?;
    let value: serde_json::Value = serde_json::from_str(&payload.inner_html())
        .map_err(|_| "Catalogo Vodafone non leggibile. Consultare la fonte ufficiale.")?;
    let price_pattern = Regex::new(r"^(\d{1,3}),(\d{2})€$").expect("Vodafone card price");
    let mut offers = Vec::new();
    let mut partial = false;
    for (slug, category, name) in [
        ("casa-start", "CASA START", "Vodafone Casa Start"),
        ("casa-pro", "CASA PRO", "Vodafone Casa Pro"),
    ] {
        let Some(card) = find_vodafone_card(&value, slug) else {
            partial = true;
            continue;
        };
        let price = card
            .get("price")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let Some(captures) = price_pattern.captures(price) else {
            partial = true;
            continue;
        };
        if card.get("category").and_then(|v| v.as_str()) != Some(category)
            || card.get("hubPath").and_then(|v| v.as_str()) != Some("casa/fibra/all")
            || card.get("isShowedInHub").and_then(|v| v.as_bool()) != Some(true)
            || card.get("recurrence").and_then(|v| v.as_str()) != Some("mese")
        {
            partial = true;
            continue;
        }
        let monthly = format!("{}.{}", &captures[1], &captures[2])
            .parse::<f64>()
            .map_err(|_| "Canone Vodafone non leggibile")?;
        let title = card
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let description_html = card
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let description = clean(
            &Html::parse_fragment(description_html)
                .root_element()
                .text()
                .collect::<Vec<_>>()
                .join(" "),
        );
        if title.is_empty() || description.is_empty() {
            partial = true;
            continue;
        }
        let evidence = format!("{category} {title} {price} al mese {description}");
        offers.push(Offer {
            id: format!("{}#{slug}", source.url),
            category: "internet".into(),
            subcategory: "casa".into(),
            provider: source.name.into(),
            name: name.into(),
            description: title.into(),
            url: source.url.into(),
            source: source.name.into(),
            source_url: source.url.into(),
            fetched_at: now(),
            valid_until: None,
            price_type: "advertised".into(),
            monthly_price: Some(monthly),
            first_year_cost: None,
            components: vec![],
            conditions: vec![
                "Canone pubblicizzato, non costo totale. Verificare copertura, tecnologia, promozioni e condizioni applicabili con Vodafone.".into(),
                "La pagina riporta indicazioni diverse sul costo di attivazione; verificare l'importo applicabile prima del confronto.".into(),
            ],
            evidence,
            evidence_version: 1,
            restricted: true,
            electricity_rates: None,
        });
    }
    if offers.is_empty() {
        return Err("Nessuna offerta Vodafone verificabile. Consultare la fonte ufficiale.".into());
    }
    if partial {
        for offer in &mut offers {
            offer
                .conditions
                .push("Catalogo Vodafone parziale: alcune schede non sono leggibili.".into());
        }
    }
    Ok((offers, partial))
}

async fn fetch_vodafone_ultra(
    client: &reqwest::Client,
    source: Source,
    runtime: &Path,
) -> Result<Offer, String> {
    const SUPPORT: &str = "https://www.vodafone.it/privati/area-supporto/contratti-aggiornamenti/condizioni-generali-reti-servizi/tariffe/contratti-attivabili/casa-ultra.html";
    let page = fetch_text(client, SUPPORT, 2_000_000).await?;
    if !page.contains("FTTH") || !page.contains("FTTC") {
        return Err("Tecnologie Casa Ultra non verificabili nella pagina ufficiale".into());
    }
    let pattern = Regex::new(r#"https://www\.vodafone\.it/nw/[^"\s<>]+/Casa_Ultra\.pdf"#)
        .expect("Vodafone public prospectus URL");
    let pdf_url = pattern
        .find(&page)
        .map(|m| m.as_str().to_string())
        .ok_or("Prospetto Casa Ultra non collegato dalla pagina ufficiale")?;
    let bytes = fetch_bytes(client, &pdf_url, 2_000_000).await?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("Prospetto Casa Ultra non è un PDF leggibile".into());
    }
    let runtime = runtime.to_path_buf();
    let document = tokio::task::spawn_blocking(move || {
        crate::documents::analyze_bytes(
            &bytes,
            "pdf",
            "Casa_Ultra.pdf".into(),
            &runtime,
            &tokio_util::sync::CancellationToken::new(),
        )
    })
    .await
    .map_err(|_| "Lettura prospetto Casa Ultra interrotta")??;
    let text = document
        .pages
        .iter()
        .map(|page| page.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    parse_vodafone_ultra_text(source, SUPPORT, &pdf_url, &text)
}

fn parse_vodafone_ultra_text(
    source: Source,
    support_url: &str,
    pdf_url: &str,
    text: &str,
) -> Result<Offer, String> {
    let normalized = clean(text);
    let lower = normalized.to_lowercase();
    if !lower.contains("casa ultra") || !lower.contains("fibra") || !lower.contains("fttc") {
        return Err("Nome o tecnologie Casa Ultra non verificabili nel prospetto".into());
    }
    let price_pattern =
        Regex::new(r"(?i)(?:prezzo dell.offerta.{0,60}?|euro/mese\s+)(\d{1,3})[,.](\d{2})")
            .expect("Vodafone public monthly price");
    let captures = price_pattern
        .captures(&normalized)
        .ok_or("Canone Casa Ultra non verificabile nel prospetto")?;
    let monthly = format!("{}.{}", &captures[1], &captures[2])
        .parse::<f64>()
        .map_err(|_| "Canone Casa Ultra non leggibile")?;
    let activation_pattern = Regex::new(r"(?i)già clienti euro 0 0.{0,60}prezzo attiva.{0,60}nuovi clienti nativi euro 0 0.{0,60}nuovi clienti in portabilità euro 0 0")
        .expect("Vodafone activation table");
    if monthly <= 0.0 || !activation_pattern.is_match(&normalized) {
        return Err("Condizioni Casa Ultra incomplete nel prospetto".into());
    }
    Ok(Offer {
        id: format!("{}#casa-ultra", source.url),
        category: "internet".into(),
        subcategory: "casa".into(),
        provider: source.name.into(),
        name: "Vodafone Casa Ultra".into(),
        description: "Fibra FTTH o FTTC, secondo copertura".into(),
        url: support_url.into(),
        source: source.name.into(),
        source_url: pdf_url.into(),
        fetched_at: now(),
        valid_until: None,
        price_type: "advertised".into(),
        monthly_price: Some(monthly),
        first_year_cost: None,
        components: vec![],
        conditions: vec![
            "Canone del prospetto ufficiale per FTTH/FTTC; la tecnologia e la copertura dipendono dall'indirizzo. FWA non inclusa in questa scheda.".into(),
            "Il prospetto indica attivazione a 0 € per clienti esistenti, nuovi clienti e portabilità. Verificare eventuali sconti con linea mobile e condizioni applicabili; il canone non è un totale annuo.".into(),
        ],
        evidence: text.into(),
        evidence_version: 1,
        restricted: true,
        electricity_rates: None,
    })
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
    if category == "internet" && !matches!(source.name, "Iliad" | "Fastweb") {
        if let Some(heading) = doc.select(&selector("h1")).next() {
            let heading = clean(&heading.text().collect::<Vec<_>>().join(" "));
            if !heading.is_empty() {
                name = heading;
            }
        }
    }
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
        // Product hero only (navigation contains unrelated prices).
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
    if category == "internet" && source.name == "PosteCasa" {
        let re = Regex::new(r"(?i)il costo mensile dell'offerta è\s*(\d{1,3})\s*,\s*(\d{2})\s*€")
            .expect("PosteCasa monthly price pattern");
        if let Some(captures) = re.captures(&text) {
            monthly_price = format!("{}.{}", &captures[1], &captures[2])
                .parse::<f64>()
                .ok();
        }
    }
    if category == "internet" && source.name == "Sky Wifi" {
        let re = Regex::new(r"Sky Wifi\s+Cosa include\s*(\d{1,3})\s*,\s*(\d{2})\s*€\s*al mese")
            .expect("Sky Wifi monthly price pattern");
        if let Some(captures) = re.captures(&text) {
            monthly_price = format!("{}.{}", &captures[1], &captures[2])
                .parse::<f64>()
                .ok();
            name = "Sky Wifi".into();
        }
    }
    if category == "internet" && source.name == "Tiscali" {
        let re = Regex::new(r"Casa Fibra Power\s*(\d{1,3})\s*,\s*(\d{2})€\s*al mese per 12 mesi")
            .expect("Tiscali monthly price pattern");
        if let Some(captures) = re.captures(&text) {
            monthly_price = format!("{}.{}", &captures[1], &captures[2])
                .parse::<f64>()
                .ok();
        }
    }
    if category == "internet" && source.name == "Kena" {
        let re = Regex::new(
            r"(?i)Cosa stai acquistando.{0,250}?\ba\s*(\d{1,3})\s*,\s*(\d{2})\s*€\s*/\s*mese",
        )
        .expect("Kena monthly price pattern");
        if let Some(captures) = re.captures(&text) {
            monthly_price = format!("{}.{}", &captures[1], &captures[2])
                .parse::<f64>()
                .ok();
        }
    }
    if category == "internet" && source.name == "Dimensione" {
        let hero: String = text.chars().take(1_000).collect();
        let re =
            Regex::new(r"(?i)(?:€\s*)?(\d{1,3})\s*,\s*(\d{2})\s*(?:€\s*)?(?:/mese\s*)?per sempre")
                .expect("Dimensione monthly price pattern");
        if let Some(captures) = re.captures(&hero) {
            monthly_price = format!("{}.{}", &captures[1], &captures[2])
                .parse::<f64>()
                .ok();
        }
        name = match url::Url::parse(url).ok()?.path() {
            "/portale/fibra-internet-casa-ftth-2.5-giga.php" => "Fibra Vera 2.5 GIGA",
            "/portale/fibra-internet-10-giga-con-fritzbox-4690.php" => "Ultra Fibra 10 GIGA",
            "/portale/fibra-internet-casa-ftth-molise-10-giga.php" => "Fibra Vera 10 GIGA Molise",
            "/portale/internet-fwa.php" => "FWA Unlimited",
            "/portale/internet-ultraveloce-fwa-300.php" => "Ultra FWA 300 MEGA",
            _ => return None,
        }
        .into();
    }
    if category == "internet" && source.name == "TIM" && url.ends_with("/fibra-wifi-casa") {
        name = "TIM WiFi Casa con opzione 10 GIGA".into();
    }
    if category == "internet" && source.name == "EOLO" {
        name = match url::Url::parse(url).ok()?.path() {
            "/offerte/eolo-casa" => "EOLO Casa",
            "/offerte/eolo-casa-plus" => "EOLO Casa Plus",
            "/offerte/eolo-casa-max" => "EOLO Casa Max",
            "/offerte/eolo-casa-fibra" => "EOLO Casa Fibra",
            "/offerte/eolo-casa-fibra-max" => "EOLO Casa Fibra Max",
            "/offerte/internet-seconda-casa" => "EOLO QuandoVuoiTu",
            _ => return None,
        }
        .into();
    }
    let low = format!("{url} {name}").to_lowercase();
    let subcategory = if category == "internet" {
        if matches!(source.name, "CoopVoce" | "Kena") {
            "mobile"
        } else if low.contains("fwa")
            || low.contains("5g-box")
            || (source.name == "EOLO" && !low.contains("fibra"))
        {
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
    if monthly_price.is_some() && matches!(source.name, "Sky Wifi" | "Tiscali") {
        conditions.push("Canone promozionale dei primi 12 mesi; verificare il canone successivo e i requisiti nella fonte ufficiale.".into());
    }
    if source.name == "Dimensione" && url.contains("-molise-") {
        conditions.push("Offerta riservata agli indirizzi coperti in Molise.".into());
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

    #[test]
    fn ho_mobile_catalog_keeps_each_card_and_partial_warning_scoped() {
        let source = Source {
            name: "ho.",
            url: "https://www.ho-mobile.it/offer-home",
        };
        let catalog_url = "https://www.ho-mobile.it/tutte-le-offerte";
        let card = |slug: &str, data: &str, euros: &str| {
            format!(
                r#"<div class="offerCarousel__slider__card" data-offerlink="/flussi-attivazione.{slug}.html">
                <div class="offerCarousel__slider__card__label">Offerta 5G!</div>
                <div class="offerCarousel__slider__card__stripe__firstLine">{data} Giga</div>
                <div class="offerCarousel__slider__card__stripe__secondLine">Minuti illimitati e 200 SMS</div>
                <div class="offerCarousel__slider__card__price__value">{euros}</div>
                <div class="offerCarousel__slider__card__price__details__cent">,95</div>
                <div class="offerCarousel__slider__card__price__details__currency">€</div>
                <div class="offerCarousel__slider__card__price__details__frequency">al mese</div>
                <div class="offerCarousel__slider__card__activationInfo">Attivazione a partire da 2,99€ per alcuni operatori</div>
                </div>"#
            )
        };
        let html = format!(
            "<div class='offerCarousel__allOffers'>{}{}{}{}</div>",
            card("132", "150", "6"),
            card("133", "250", "8"),
            card("134", "150", "9"),
            card("135", "250", "11")
        );
        let (offers, partial) = parse_ho_mobile_catalog(source, catalog_url, &html).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 4);
        assert_eq!(
            offers
                .iter()
                .map(|offer| offer.monthly_price)
                .collect::<Vec<_>>(),
            [Some(6.95), Some(8.95), Some(9.95), Some(11.95)]
        );
        assert!(offers.iter().all(|offer| {
            offer.first_year_cost.is_none()
                && offer.valid_until.is_none()
                && offer.restricted
                && offer.source_url == catalog_url
                && offer
                    .conditions
                    .iter()
                    .any(|c| c.contains("alcuni operatori"))
        }));
        assert!(is_product_url(source.name, &offers[0].url, "internet"));
        let incomplete = html.replace("200 SMS", "100 SMS");
        assert!(parse_ho_mobile_catalog(source, catalog_url, &incomplete).is_err());
        let incomplete = html.replace("11</div>", "da 11</div>");
        let (offers, partial) = parse_ho_mobile_catalog(source, catalog_url, &incomplete).unwrap();
        assert!(partial);
        assert_eq!(offers.len(), 3);
    }

    #[test]
    fn unomobile_speed_keeps_intro_and_renewal_prices_separate() {
        let source = Source {
            name: "1Mobile",
            url: "https://www.unomobile.it/offerte/start-xplus-reward",
        };
        let url = "https://www.unomobile.it/offerte/speed-5g-180";
        let bundle = serde_json::json!({
            "name": "Speed 5G 180",
            "publish": 1,
            "price": 5,
            "data": "180",
            "additional_data": "<p>180 GB in 5G</p>",
            "overview": "Offerta Valida in promozione fino al 30/09/2099 per i nuovi clienti in portabilità da tutti gli operatori e nuovi numeri",
            "activation_info": "Costo di attivazione GRATUITO in portabilità da TUTTI GLI OPERATORI, 5€ per le nuove SIM",
            "note": "L’offerta Speed 5G 180 è attivabile al prezzo 5€/mese per il primo mese e 6,99€ dal secondo mese fino al&nbsp;30/09/2099"
        });
        let html = format!("<script>window.bundle = {bundle};</script>");
        let offer = parse_unomobile_speed(source, url, 180, &html).unwrap();
        assert_eq!(offer.monthly_price, Some(5.0));
        assert_eq!(offer.first_year_cost, None);
        assert_eq!(offer.valid_until.as_deref(), Some("2099-09-30"));
        assert!(offer.conditions.iter().any(|c| c.contains("6.99")));
        assert_eq!(offer.source_url, url);
        assert!(is_product_url(source.name, &offer.url, "internet"));
        let inconsistent = html.replace("\"price\":5", "\"price\":4");
        assert!(parse_unomobile_speed(source, url, 180, &inconsistent).is_err());
        let inconsistent = html.replace("180 GB in 5G", "250 GB in 5G");
        assert!(parse_unomobile_speed(source, url, 180, &inconsistent).is_err());
    }

    #[test]
    fn unomobile_extra_cards_keep_bonus_activation_and_deadline_scoped() {
        let source = Source {
            name: "1Mobile",
            url: "https://www.unomobile.it/offerte/start-xplus-reward",
        };
        for (slug, name, data, price, activation, note) in [
            (
                "flash-120",
                "Flash 120",
                "120",
                5.99,
                "Costo di attivazione GRATUITO in portabilità da TUTTI GLI OPERATORI, 4€ per le nuove SIM",
                "L’offerta Flash 120 è attivabile al prezzo di 5,99€/mese fino al 30/09/2099. Portabilità entro il primo rinnovo.",
            ),
            (
                "world-plus-5g",
                "World Plus 5G",
                "130",
                9.99,
                "Costo di attivazione 5€ per nuovi numeri, GRATIS in portabilità da tutti gli operatori",
                "L’offerta World Plus 5G è attivabile al prezzo 9,99€/mese fino al 30/09/2099. Portabilità entro il primo rinnovo; 20GB dal 3° rinnovo consecutivo.",
            ),
            (
                "flash-5g-320-lim-edition",
                "Flash 5G 320 Limited Edition",
                "320",
                4.99,
                "Costo di attivazione GRATUITO in portabilità da TUTTI GLI OPERATORI, 10€ per le nuove SIM",
                "L’offerta è attivabile al prezzo 4,99€/mese per il primo mese, 8,99€ dal secondo mese e un ulteriore mese omaggio al completamento del primo rinnovo fino al 30/09/2099. Il credito viene erogato immediatamente dopo il primo rinnovo e non da diritto ad alcun rimborso. Portabilità entro il primo rinnovo.",
            ),
        ] {
            let url = format!("https://www.unomobile.it/offerte/{slug}");
            let bundle = serde_json::json!({
                "name": name,
                "publish": 1,
                "price": price,
                "data": data,
                "overview": "Offerta valida fino al 30/09/2099 per nuovi numeri",
                "activation_info": activation,
                "note": note,
            });
            let html = format!("<script>window.bundle = {bundle};</script>");
            let offer = parse_unomobile_extra(source, &url, slug, &html).unwrap();
            assert_eq!(offer.name, name);
            assert_eq!(offer.monthly_price, Some(price));
            assert_eq!(offer.valid_until.as_deref(), Some("2099-09-30"));
            assert!(offer.first_year_cost.is_none());
            assert!(is_product_url(source.name, &url, "internet"));
            assert!(parse_unomobile_extra(
                source,
                &url,
                slug,
                &html.replace(&format!("\"price\":{price}"), "\"price\":1")
            )
            .is_err());
            assert!(parse_unomobile_extra(
                source,
                &url,
                slug,
                &html.replace("entro il primo rinnovo", "dopo il rinnovo")
            )
            .is_err());
            if slug == "flash-5g-320-lim-edition" {
                assert!(offer.conditions.iter().any(|c| c.contains("8.99")));
                assert!(offer.conditions.iter().any(|c| c.contains("omaggio")));
            }
        }
    }

    #[test]
    fn unomobile_catalog_and_xconnect_keep_iot_terms_distinct() {
        let source = Source {
            name: "1Mobile",
            url: "https://www.unomobile.it/offerte/start-xplus-reward",
        };
        let catalog = r#"<script>const bundles = [{"url":"start-xplus-reward","publish":1},{"url":"xconnect","publish":1}];</script>"#;
        let slugs = parse_unomobile_catalog(catalog).unwrap();
        assert!(slugs.contains("xconnect"));
        assert_eq!(slugs.len(), 2);
        assert!(parse_unomobile_catalog(&catalog.replace("xconnect", "../unsafe")).is_err());
        let url = "https://www.unomobile.it/offerte/xconnect";
        let bundle = serde_json::json!({
            "name": "XConnect", "url": "xconnect", "publish": 1, "price": 2.5,
            "data": "1", "min": "100", "sms": "50",
            "overview": "<p>Internet of things fino al 30/09/2099 Costo di attivazione 10€</p>",
            "activation_info": "10€ Costo di attivazione",
            "note": "L’offerta XConnect è attivabile al prezzo 2,50€/mese fino al 30/09/2099. La promozione si rinnova in automatico ogni mese."
        });
        let html = format!("<script>window.bundle = {bundle};</script>");
        let offer = parse_unomobile_xconnect(source, url, &html).unwrap();
        assert_eq!(offer.monthly_price, Some(2.5));
        assert_eq!(offer.first_year_cost, None);
        assert!(is_product_url(source.name, url, "internet"));
        assert!(offer.description.contains("IoT"));
        assert!(
            parse_unomobile_xconnect(source, url, &html.replace("2,50€/mese", "3,50€/mese"))
                .is_err()
        );
        assert!(parse_unomobile_xconnect(
            source,
            url,
            &html.replace("attivazione 10€", "attivazione 5€")
        )
        .is_err());
    }

    #[test]
    fn ho_home_prices_stay_separate_by_customer_type() {
        let source = Source {
            name: "ho.",
            url: "https://www.ho-mobile.it/offer-home",
        };
        let html = r#"<div class="ho-product-header_bg_clients"><h1>ho. una SIM Dati per la casa</h1></div>
            <div class="ho-product-header_bg_offer-container">500 Giga in 5G
              <div class="ho-product-header_bg_offer-box__container">
                <div class="offer-new-usersMobile"><div class="ho-product-header_bg_offer-box_detail_content_price">14<span>,95€</span></div></div>
                <div class="ho-product-header_bg_offer-box"><div class="ho-product-header_bg_offer-box_detail_content_price">12<span>,95€</span></div></div>
              </div>
            </div>
            <div class="ho-product-header__content offer-6"><div class="ho-product-header_right-box">
              Attivazione 5,99€ SIM Gratis Prima ricarica 13,00€
              Per i nuovi clienti la ricarica è di 15,00 €
              Dalla prima ricarica verrà scalato il costo del rinnovo di 14,95€ oppure di 12,95€ per i già clienti
              Per i nuovi clienti il costo totale è di 20,99€
            </div></div>"#;
        let (offers, partial) = parse_ho_home(source, html).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 2);
        assert_eq!(offers[0].monthly_price, Some(14.95));
        assert_eq!(offers[1].monthly_price, Some(12.95));
        assert!(offers.iter().all(|offer| offer.first_year_cost.is_none()));
        assert!(parse_ho_home(source, &html.replace("12<span>,95€", "11<span>,95€")).is_err());
        assert!(is_product_url(source.name, source.url, "internet"));
        assert!(!is_product_url(
            source.name,
            "https://other.example/offer-home",
            "internet"
        ));
    }

    #[test]
    fn unomobile_double_encoded_notes_keep_price_period_and_activation_scoped() {
        let source = Source {
            name: "1Mobile",
            url: "https://www.unomobile.it/offerte/start-xplus-reward",
        };
        let bundle = serde_json::json!({
            "name": "Start XPlus Reward",
            "publish": 1,
            "price": 4.99,
            "overview": "<p>Offerta Valida in promozione fino al 30/09/2099 per i nuovi clienti in portabilità e nuove attivazioni</p>",
            "activation_info": "5€ Costo di attivazione per tutti i clienti in portabilità\n10€ Costo di attivazione per nuove SIM",
            "note": "&lt;ul&gt;&lt;li&gt;L’offerta è attivabile al prezzo 4,99€/mese in promozione fino al 30/09/2099, dal 3°rinnovo consecutivo il canone mensile diventa 4,49€. Per le sim in portabilità il passaggio deve essere completato entro il primo rinnovo, altrimenti verranno addebitati i 5€.&lt;/li&gt;&lt;/ul&gt;"
        });
        let html = format!("<html><script>window.bundle = {bundle};</script></html>");
        let (offers, partial) = parse_unomobile(source, &html).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].monthly_price, Some(4.99));
        assert_eq!(offers[0].valid_until.as_deref(), Some("2099-09-30"));
        assert_eq!(offers[0].first_year_cost, None);
        assert!(offers[0].conditions.iter().any(|c| c.contains("4.49")));
        assert!(offers[0]
            .conditions
            .iter()
            .any(|c| c.contains("portabilità")));
        assert!(!offers[0].evidence.contains("&lt;li&gt;"));
        assert!(
            parse_unomobile(source, &html.replace("\"price\":4.99", "\"price\":3.99")).is_err()
        );
        assert!(parse_unomobile(
            source,
            &html.replace("entro il primo rinnovo", "dopo il rinnovo")
        )
        .is_err());
    }

    #[test]
    fn scoped_catalog_pages_survive_cache_url_filtering() {
        for (source, url) in [
            ("Vodafone", "https://privati.vodafone.it/casa/fibra"),
            (
                "1Mobile",
                "https://www.unomobile.it/offerte/start-xplus-reward",
            ),
            ("spusu", "https://www.spusu.it/spusu150xl"),
        ] {
            assert!(is_product_url(source, url, "internet"));
            assert!(!is_product_url(
                source,
                &url.replace("https://", "http://"),
                "internet"
            ));
            assert!(!is_product_url(
                source,
                &url.replace(".it", ".example"),
                "internet"
            ));
        }
    }

    #[test]
    fn spusu_public_cards_keep_monthly_price_and_subscription_note_scoped() {
        let source = Source {
            name: "spusu",
            url: "https://www.spusu.it/",
        };
        let catalog = r#"{"tariffs":[{"tariffDetailLink":"spusu150xl","tariffModel":{"tariffModelName":"spusu 150 XL","paymentType":"PRE_PAID","billPeriod":{"billPeriodType":"MONTHLY"},"fees":{"contractFee":{"amount":5.98,"currencyCode":"EUR"},"packageFee":{"amount":5.98,"currencyCode":"EUR"}},"balances":{"nationalData":{"value":150}},"balanceAndCostDescription":"150 GB | 5,98 euro mese"},"specialDeals":[{"specialDealText":"Offerta fino al 30/09"}]},{"tariffDetailLink":"new-product","tariffModel":{}}]}"#;
        let (offers, partial) = parse_spusu(source, catalog).unwrap();
        assert!(partial);
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].monthly_price, Some(5.98));
        assert_eq!(offers[0].first_year_cost, None);
        assert_eq!(offers[0].valid_until, None);
        assert!(offers[0].conditions.iter().any(|c| c.contains("30/09")));
        assert!(offers[0].evidence.contains("150 GB"));
        assert!(!offers[0].evidence.contains("Catalogo spusu parziale"));
        assert!(parse_spusu(source, &catalog.replace("\"amount\":5.98", "\"amount\":0")).is_err());
    }

    #[test]
    fn vodafone_cards_keep_advertised_prices_scoped() {
        let source = Source {
            name: "Vodafone",
            url: "https://privati.vodafone.it/casa/fibra",
        };
        let html = r#"<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"cards":[{"slug":"casa-start","category":"CASA START","hubPath":"casa/fibra/all","isShowedInHub":true,"recurrence":"mese","price":"27,95€","title":"L'offerta base","description":"<p>Costo di attivazione variabile</p>"},{"slug":"casa-pro","category":"CASA PRO","hubPath":"casa/fibra/all","isShowedInHub":true,"recurrence":"mese","price":"29,95€","title":"Internet e vantaggi","description":"<p>Modem incluso</p>"},{"slug":"wifi-da-te-ultra","category":"CASA ULTRA","hubPath":"casa/fibra/all","isShowedInHub":false,"recurrence":"mese","price":"36,95€","title":"Massima potenza e vantaggi extra","description":"<p>Internet e chiamate illimitate</p>"},{"slug":"casa-pro-lockin-app","category":"Casa Pro","price":"25,95€"}]}}}</script>"#;
        let (offers, partial) = parse_vodafone(source, html).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 2);
        assert_eq!(offers[0].monthly_price, Some(27.95));
        assert_eq!(offers[1].monthly_price, Some(29.95));
        assert!(offers
            .iter()
            .all(|offer| offer.first_year_cost.is_none() && offer.restricted));
        assert!(offers[0]
            .evidence
            .contains("Costo di attivazione variabile"));
        let incomplete = html.replace("\"price\":\"29,95€\"", "\"price\":\"da 29,95€\"");
        let (offers, partial) = parse_vodafone(source, &incomplete).unwrap();
        assert!(partial);
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].name, "Vodafone Casa Start");
    }

    #[test]
    fn vodafone_ultra_requires_public_price_technology_and_activation() {
        let source = Source {
            name: "Vodafone",
            url: "https://privati.vodafone.it/casa/fibra",
        };
        let text = "Nome commerciale Casa Ultra Tecnologia di rete Fibra, FTTC, FITH \
            Già clienti euro 0 0 Prezzo attiva: ne Nuovi clienti nativi euro 0 0 \
            Nuovi clienti in portabilità euro 0 0 Prezzo Addebito flat a regime \
            Il prezzo dell’offerta è pari a 36,95€ al mese.";
        let offer = parse_vodafone_ultra_text(
            source,
            "https://www.vodafone.it/privati/area-supporto/contratti-aggiornamenti/condizioni-generali-reti-servizi/tariffe/contratti-attivabili/casa-ultra.html",
            "https://www.vodafone.it/Casa_Ultra.pdf",
            text,
        )
        .unwrap();
        assert_eq!(offer.monthly_price, Some(36.95));
        assert_eq!(offer.first_year_cost, None);
        assert_eq!(offer.source_url, "https://www.vodafone.it/Casa_Ultra.pdf");
        assert!(is_product_url(source.name, &offer.url, "internet"));
        assert!(offer.conditions.iter().any(|c| c.contains("0 €")));
        assert!(parse_vodafone_ultra_text(
            source,
            &offer.url,
            &offer.source_url,
            &text.replace(
                "Nuovi clienti nativi euro 0 0",
                "Nuovi clienti nativi euro 19 19"
            )
        )
        .is_err());
        assert!(parse_vodafone_ultra_text(
            source,
            &offer.url,
            &offer.source_url,
            &text.replace("36,95€", "-€")
        )
        .is_err());
    }

    #[test]
    fn kiara_starting_prices_and_equipment_promotion_stay_scoped() {
        let source = Source {
            name: "BBBell Kiara",
            url: "https://www.bbbell.it/privati/internet-kiara-family/",
        };
        let html = r#"<div class="et_pb_text_inner"><p>MKT+VV nuove contrattualizzazioni Scelgo 24</p></div>
        <div class="dica-item-content"><h4 class="item-title">Kiara Super Family</h4>a partire da € 26,90 al mese Router compreso</div>
        <div class="dica-item-content"><h4 class="item-title">Promo Kiara Super</h4>noleggio apparati sconto 100% Scelgo 24 Colocation nel PCN</div>
        <div class="dica-item-content"><h4 class="item-title">Kiara Family Fast 100</h4>a partire da € 25,90 al mese Router a noleggio</div>"#;
        let (offers, partial) = parse_kiara(source, html).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 2);
        assert!(offers
            .iter()
            .all(|o| o.monthly_price.is_none() && o.first_year_cost.is_none()));
        assert!(offers[0].evidence.contains("PCN"));
        assert!(!offers[1].evidence.contains("PCN"));
        assert!(!offers[1].evidence.contains("MKT+VV"));
        let (remaining, partial) = parse_kiara(
            source,
            &html.replace("Scelgo 24 Colocation nel PCN", "conditions unavailable"),
        )
        .unwrap();
        assert!(partial);
        assert_eq!(remaining.len(), 1);
    }

    #[test]
    fn enel_cards_require_their_own_price_terms_and_equipment() {
        let source = Source {
            name: "Enel Fibra",
            url: "https://www.enel.it/it-it/offerte-fibra",
        };
        let card = |name: &str, price: &str, slug: &str, terms: &str| {
            format!(
                r#"<div class="commodity-card-xs">
        <h3 class="commodity-card-xs__content__body__information__product__title">{name}</h3>
        <p class="commodity-card-xs__content__body__information__price__detail__price__discounted"><span class="price">{price}</span></p>
        <p class="commodity-card-xs__content__body__information__price__detail__price__initial"><span class="price">99,90</span></p><p>Modem in comodato gratuito</p>
        <a data-product-sku="test" data-commodity-type="fibra" href="/it-it/offerte-fibra/{slug}">Copertura</a>
        <div class="bottom-sheet"><div class="content__text">{name} canone base {price}€/mese. {terms} Recesso entro 24 mesi.</div></div></div>"#
            )
        };
        let a = card("Enel Fibra Trio", "18,90", "trio", "Luce e gas");
        let b = card("ENEL FIBRA BASE", "26,90", "base", "Solo fibra");
        let (offers, partial) = parse_enel_fibra(source, &format!("{a}{b}")).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 2);
        assert_eq!(offers[0].monthly_price, Some(18.9));
        assert_eq!(offers[1].monthly_price, Some(26.9));
        assert!(!offers[1].evidence.contains("Luce e gas"));
        assert!(offers.iter().all(|o| o.first_year_cost.is_none()));
        let (offers, partial) = parse_enel_fibra(
            source,
            &format!("{a}{}", b.replace("canone base", "unreadable")),
        )
        .unwrap();
        assert!(partial);
        assert_eq!(offers.len(), 1);
        assert!(parse_enel_fibra(
            source,
            &a.replace(
                "/it-it/offerte-fibra/trio",
                "https://unrelated.example/offer"
            )
        )
        .is_err());
    }
    use std::io::{Read, Write};

    fn bbbell_fixture() -> String {
        let cards = [("Family 50 Super", "21,90", " MKT+VV"), ("Family 200", "37,00", "")]
            .into_iter().map(|(name, price, campaign)| format!(r#"<div class="dica-item-content"><h4 class="item-title">{name}</h4><span class="carousel-price"><span>49,00</span> € {price}</span><span class="carousel-price-period">al mese offerta in promo*{campaign}</span><p>Router compreso. Telefonate a consumo.</p></div>"#)).collect::<String>();
        format!(
            r#"<html><body>{cards}<div class="et_pb_text_inner"><p>Con la promozione SCELGO 24, il prezzo scontato è valido per sempre</p><p>Campagna con codice promozionale MKT+VV: nuovi clienti; cambio piano solo verso FWA da 200 Mbps</p></div></body></html>"#
        )
    }

    #[test]
    fn bbbell_variants_keep_scoped_prices_terms_and_source_evidence() {
        let source = Source {
            name: "BBBell",
            url: "https://www.bbbell.it/privati/internet-family/",
        };
        let (offers, partial) = parse_bbbell_family(source, &bbbell_fixture()).unwrap();
        assert!(!partial);
        assert_eq!(offers.len(), 2);
        assert_ne!(offers[0].id, offers[1].id);
        assert_eq!(offers[0].monthly_price, Some(21.9));
        assert_eq!(offers[1].monthly_price, Some(37.0));
        assert!(offers[0].evidence.contains("MKT+VV"));
        assert!(!offers[1].evidence.contains("MKT+VV"));
        assert!(!offers[0].evidence.contains("Family 200"));
        for offer in &offers {
            assert_eq!(offer.subcategory, "fwa");
            assert!(offer.first_year_cost.is_none());
            assert!(offer.conditions.iter().any(|t| t.contains("SCELGO 24")));
            assert!(offer.source_evidence().unwrap().contains("Router compreso"));
            assert!(!offer.evidence.contains("Non è il costo totale"));
            assert!(is_product_url("BBBell", &offer.url, "internet"));
        }
        assert!(!is_product_url(
            "BBBell",
            "https://example.org/privati/internet-family/",
            "internet"
        ));
    }

    #[test]
    fn bbbell_rejects_missing_terms_and_reports_unreadable_variants() {
        let source = Source {
            name: "BBBell",
            url: "https://www.bbbell.it/privati/internet-family/",
        };
        let html = bbbell_fixture();
        assert!(parse_bbbell_family(source, &html.replace("SCELGO 24", "other")).is_err());
        let (offers, partial) =
            parse_bbbell_family(source, &html.replace("€ 21,90", "€ unknown")).unwrap();
        assert!(partial);
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].name, "Family 200");
        assert!(offers[0].conditions.iter().any(|t| t.contains("parziale")));
        assert!(
            parse_bbbell_family(source, &html.replace("Family 200", "Family 50 Super")).is_err()
        );
    }

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
        assert!(!is_product_url(
            "TIM",
            "https://www.tim.it/fisso-e-mobile/fibra-e-adsl/fibra-internet-casa",
            "internet"
        ));
    }
    #[test]
    fn new_internet_sources_keep_price_and_category_scoped() {
        for (source, url) in [
            ("Sky Wifi", "https://www.sky.it/offerte/wifi/solo-internet"),
            (
                "PosteCasa",
                "https://www.poste.it/fibra/postecasa-ultraveloce",
            ),
            (
                "Tiscali",
                "https://abbonati.tiscali.it/fibra/casa-fibra-power/",
            ),
        ] {
            assert!(is_product_url(source, url, "internet"));
        }
        let sky = parse_product(
            Source {
                name: "Sky Wifi",
                url: "https://www.sky.it/offerte/wifi/solo-internet",
            },
            "internet",
            "https://www.sky.it/offerte/wifi/solo-internet",
            "",
            "<html><head><title>Sky Wifi</title></head><body><main><h1>Internet casa</h1><p>Sky Wifi Cosa include 22 ,90€ al mese per 12 mesi anziché 29,90€ al mese. Verifica la copertura per il tuo indirizzo prima di acquistare la connessione.</p></main></body></html>",
        )
        .unwrap();
        assert_eq!(sky.monthly_price, Some(22.9));
        assert!(sky
            .conditions
            .iter()
            .any(|value| value.contains("primi 12 mesi")));
        let coop = parse_product(
            Source {
                name: "CoopVoce",
                url: "https://www.coopvoce.it/portale/offerte.html",
            },
            "internet",
            "https://www.coopvoce.it/content/coopvoce/portale/offerte/turbo-200.html",
            "",
            "<html><head><title>TURBO 200</title></head><body><main><h1>TURBO 200</h1><p>Offerta mobile con giga, minuti e messaggi. Il costo, l'attivazione e le condizioni sono descritti sul sito ufficiale.</p></main></body></html>",
        )
        .unwrap();
        assert_eq!(coop.subcategory, "mobile");
        assert_eq!(coop.monthly_price, None);
        let kena = parse_product(
            Source {
                name: "Kena",
                url: "https://www.kenamobile.it/offerte/",
            },
            "internet",
            "https://www.kenamobile.it/prodotto/499-150-gb-5g-top/",
            "",
            "<html><head><title>Kena</title></head><body><main><h1>150 GB 5G TOP</h1><p>Altra opzione 1,99€ al mese. Cosa stai acquistando 150 Giga, Minuti Illimitati e 200 SMS a 4,99€ /mese. Attivazione, SIM e consegna gratuite.</p></main></body></html>",
        )
        .unwrap();
        assert_eq!(kena.subcategory, "mobile");
        assert_eq!(kena.monthly_price, Some(4.99));
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
