use crate::domain::{now, web_url, Offer, PriceComponent};
use serde::Deserialize;

#[derive(Default, Deserialize)]
struct Feed {
    #[serde(rename = "offerta", default)]
    offers: Vec<EnergyOffer>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct EnergyOffer {
    #[serde(rename = "IdentificativiOfferta")]
    identifiers: Identifiers,
    #[serde(rename = "DettaglioOfferta")]
    detail: Detail,
    #[serde(rename = "ValiditaOfferta")]
    validity: Validity,
    #[serde(rename = "ComponenteImpresa")]
    components: Vec<Component>,
    #[serde(rename = "CondizioniContrattuali")]
    conditions: Vec<Condition>,
    #[serde(rename = "ZoneOfferta")]
    zones: Option<serde::de::IgnoredAny>,
    #[serde(rename = "CaratteristicheOfferta")]
    characteristics: Option<serde::de::IgnoredAny>,
    #[serde(rename = "Sconto")]
    discounts: Vec<serde::de::IgnoredAny>,
    #[serde(rename = "ProdottiServiziAggiuntivi")]
    extras: Vec<serde::de::IgnoredAny>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Identifiers {
    #[serde(rename = "COD_OFFERTA")]
    code: String,
    #[serde(rename = "PIVA_UTENTE")]
    vat: String,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Detail {
    #[serde(rename = "TIPO_CLIENTE")]
    client: String,
    #[serde(rename = "TIPO_OFFERTA")]
    kind: String,
    #[serde(rename = "NOME_OFFERTA")]
    name: String,
    #[serde(rename = "DESCRIZIONE")]
    description: String,
    #[serde(rename = "DURATA")]
    duration: String,
    #[serde(rename = "GARANZIE")]
    guarantees: String,
    #[serde(rename = "Contatti")]
    contacts: Contacts,
    #[serde(rename = "ModalitaAttivazione")]
    activation: Vec<Condition>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Contacts {
    #[serde(rename = "URL_OFFERTA")]
    offer: String,
    #[serde(rename = "URL_SITO_VENDITORE")]
    site: String,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Validity {
    #[serde(rename = "DATA_INIZIO")]
    start: String,
    #[serde(rename = "DATA_FINE")]
    end: String,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Component {
    #[serde(rename = "NOME")]
    name: String,
    #[serde(rename = "DESCRIZIONE")]
    description: String,
    #[serde(rename = "IntervalloPrezzi")]
    prices: Vec<Price>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Price {
    #[serde(rename = "PREZZO")]
    value: String,
    #[serde(rename = "UNITA_MISURA")]
    unit: String,
    #[serde(rename = "FASCIA_COMPONENTE")]
    band: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Condition {
    #[serde(rename = "DESCRIZIONE")]
    description: String,
}

fn date(input: &str) -> Option<String> {
    chrono::NaiveDate::parse_from_str(input.split('_').next()?, "%d/%m/%Y")
        .ok()
        .map(|d| d.format("%Y-%m-%d").to_string())
}

pub fn parse(xml: &str, category: &str, source_url: &str) -> Result<Vec<Offer>, String> {
    let feed: Feed = quick_xml::de::from_str(xml)
        .map_err(|e| format!("Formato Open Data non riconosciuto: {e}"))?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut offers = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in feed.offers {
        if raw.detail.client != "01"
            || raw.identifiers.code.is_empty()
            || !seen.insert(raw.identifiers.code.clone())
        {
            continue;
        }
        let end = date(&raw.validity.end);
        let start = date(&raw.validity.start);
        if end.as_ref().is_none_or(|v| v < &today) || start.as_ref().is_none_or(|v| v > &today) {
            continue;
        }
        let normalize = |s: &str| {
            let s = s.trim();
            if s.starts_with("http") {
                s.to_string()
            } else {
                format!("https://{s}")
            }
        };
        let official = normalize(&raw.detail.contacts.site);
        let url = web_url(&normalize(&raw.detail.contacts.offer))
            .or_else(|_| web_url(&official))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| "https://www.ilportaleofferte.it/portaleOfferte/".into());
        let provider = web_url(&official)
            .ok()
            .and_then(|u| {
                u.host_str()
                    .map(|s| s.trim_start_matches("www.").to_string())
            })
            .unwrap_or(raw.identifiers.vat);
        let mut components = Vec::new();
        let mut source_passages = vec![raw.detail.name.clone(), raw.detail.description.clone()];
        for c in raw.components {
            source_passages.push(c.name.clone());
            source_passages.push(c.description.clone());
            for price in c.prices {
                let Ok(amount) = price.value.replace(',', ".").parse::<f64>() else {
                    continue;
                };
                if !amount.is_finite() {
                    continue;
                }
                let unit = match price.unit.as_str() {
                    "01" => "€/anno",
                    "02" => "€/kW/anno",
                    "03" => "€/kWh",
                    "04" => "€/Smc",
                    _ => "unità da verificare",
                };
                components.push(PriceComponent {
                    name: if c.name.is_empty() {
                        c.description.clone()
                    } else {
                        c.name.clone()
                    },
                    amount,
                    unit: unit.into(),
                    band: price.band,
                });
            }
        }
        let mut conditions: Vec<String> = raw
            .conditions
            .into_iter()
            .map(|c| c.description)
            .filter(|s| !s.is_empty())
            .collect();
        conditions.extend(
            raw.detail
                .activation
                .iter()
                .map(|c| c.description.clone())
                .filter(|s| !s.is_empty()),
        );
        if !raw.detail.guarantees.is_empty() && raw.detail.guarantees != "NO" {
            conditions.push(raw.detail.guarantees);
        }
        source_passages.extend(conditions.iter().cloned());
        let evidence = source_passages
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if raw.detail.duration.parse::<u32>().is_ok() {
            conditions.push(format!(
                "Durata condizioni economiche: {} mesi.",
                raw.detail.duration
            ));
        }
        let restricted = raw.zones.is_some() || raw.characteristics.is_some();
        if restricted {
            conditions.insert(0, "Sono presenti requisiti territoriali o di consumo: verificare l'ammissibilità sul Portale Offerte.".into());
        }
        if !raw.discounts.is_empty() {
            conditions.push("Sono previsti sconti: requisiti e importi sono consultabili nella fonte ufficiale.".into());
        }
        if !raw.extras.is_empty() {
            conditions.push(
                "L'offerta comprende servizi aggiuntivi: consultare le relative condizioni.".into(),
            );
        }
        conditions.insert(0, "Componenti di vendita pubblicate, non totale bolletta. Trasporto, oneri, imposte, dispacciamento ed eventuali sconti vanno verificati nel confronto ufficiale.".into());
        let kind = match raw.detail.kind.as_str() {
            "01" => "fixed",
            "02" => "variable",
            _ => "other",
        };
        if kind == "variable" {
            conditions.insert(0, "Prezzo indicizzato: gli importi possono rappresentare spread da aggiungere all'indice, non il prezzo finale dell'energia.".into());
        }
        offers.push(Offer {
            id: raw.identifiers.code,
            category: category.into(),
            subcategory: category.into(),
            provider,
            name: raw.detail.name,
            description: raw.detail.description,
            url,
            source: "Portale Offerte".into(),
            source_url: source_url.into(),
            fetched_at: now(),
            valid_until: end,
            price_type: kind.into(),
            monthly_price: None,
            first_year_cost: None,
            components,
            conditions,
            evidence,
            evidence_version: 1,
            restricted,
            electricity_rates: None,
        });
    }
    if offers.is_empty() {
        return Err("Il file non contiene offerte domestiche attive riconosciute".into());
    }
    offers.sort_by(|a, b| a.provider.cmp(&b.provider).then(a.name.cmp(&b.name)));
    Ok(offers)
}

pub fn parse_placet(input: &str, category: &str, source_url: &str) -> Result<Vec<Offer>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(input.as_bytes());
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut offers = Vec::new();
    for record in reader.deserialize::<std::collections::HashMap<String, String>>() {
        let row = record.map_err(|e| format!("Formato PLACET non riconosciuto: {e}"))?;
        let get = |key: &str| row.get(key).map(String::as_str).unwrap_or("");
        if get("tipo_cliente") != "domestico" || get("cod_offerta").is_empty() {
            continue;
        }
        let end = date(get("data_fine"));
        let start = date(get("data_inizio"));
        if end.as_ref().is_none_or(|v| v < &today) || start.as_ref().is_none_or(|v| v > &today) {
            continue;
        }
        let kind = match get("tipo_offerta") {
            "prezzo fisso" => "fixed",
            "prezzo variabile" => "variable",
            _ => "other",
        };
        let unit = if category == "luce" {
            "€/kWh"
        } else {
            "€/Smc"
        };
        let columns = [
            ("p_fix_f", "Quota fissa", "€/anno", None),
            ("p_fix_v", "Quota fissa", "€/anno", None),
            ("p_vol_mono", "Energia monoraria", unit, None),
            ("p_vol_f1", "Energia", unit, Some("01")),
            ("p_vol_f2", "Energia", unit, Some("02")),
            ("p_vol_f3", "Energia", unit, Some("03")),
            ("p_vol_bf1", "Energia bioraria", unit, Some("01")),
            ("p_vol_bf23", "Energia bioraria", unit, Some("91")),
            ("p_vol", "Gas", unit, None),
            ("alpha", "Spread (indice escluso)", unit, None),
        ];
        let mut components = Vec::new();
        for (key, name, unit, band) in columns {
            if get(key).is_empty() {
                continue;
            }
            let amount = get(key)
                .parse::<f64>()
                .map_err(|_| format!("Prezzo PLACET non valido: {}", get("cod_offerta")))?;
            if !amount.is_finite() {
                return Err("Prezzo PLACET non finito".into());
            }
            components.push(PriceComponent {
                name: name.into(),
                amount,
                unit: unit.into(),
                band: band.map(String::from),
            });
        }
        let restricted = ["regione", "provincia", "comune"]
            .iter()
            .any(|key| !get(key).is_empty());
        let rate = |key: &str| get(key).parse::<f64>().ok().filter(|v| v.is_finite());
        // ARERA 135/2022, art. 1: simulated fixed PLACET; M/F selects the contract tariff.
        let code = get("cod_offerta").as_bytes();
        let tariff = if code.len() == 32 && code[..6].iter().all(u8::is_ascii_digit) {
            match code.get(6..11) {
                Some(b"ESFMP") => Some("mono"),
                Some(b"ESFFP") => Some("bio"),
                _ => None,
            }
        } else {
            None
        };
        let electricity_rates =
            (category == "luce" && kind == "fixed" && tariff.is_some()).then(|| {
                crate::domain::ElectricityRates {
                    annual_fee: rate("p_fix_f"),
                    mono: if tariff == Some("mono") {
                        rate("p_vol_mono")
                    } else {
                        None
                    },
                    f1: if tariff == Some("bio") {
                        rate("p_vol_bf1")
                    } else {
                        None
                    },
                    f23: if tariff == Some("bio") {
                        rate("p_vol_bf23")
                    } else {
                        None
                    },
                }
            });
        let mut conditions=vec!["Offerta PLACET. Le componenti pubblicate non rappresentano il totale della bolletta: rete, oneri, imposte e dispacciamento vanno verificati nel confronto ufficiale.".into(),format!("Attivazione: {}",get("modalita_attivazione")),format!("Pagamento: {}",get("modalita_pagamento"))];
        if kind == "variable" {
            conditions.insert(
                0,
                "Prezzo indicizzato: lo spread si aggiunge all'indice, non è il prezzo finale."
                    .into(),
            );
        }
        if category == "luce" {
            conditions.push("Eventuali prezzi mono/biorari e per fasce sono alternative contrattuali, non componenti da sommare.".into());
        }
        if restricted {
            conditions.push(format!(
                "Disponibilità territoriale: {} {} {}",
                get("regione"),
                get("provincia"),
                get("comune")
            ));
        }
        let mut fields: Vec<_> = row.iter().collect();
        fields.sort_by_key(|(key, _)| *key);
        let evidence = fields
            .into_iter()
            .map(|(_, value)| value.as_str())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        let url = web_url(get("url_offerta"))
            .or_else(|_| web_url(get("url_sito_venditore")))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| "https://www.ilportaleofferte.it/portaleOfferte/".into());
        offers.push(Offer {
            id: get("cod_offerta").into(),
            category: category.into(),
            subcategory: category.into(),
            provider: get("denominazione").into(),
            name: get("nome_offerta").into(),
            description: format!("Offerta PLACET domestica a {}.", get("tipo_offerta")),
            url,
            source: "Portale Offerte".into(),
            source_url: source_url.into(),
            fetched_at: now(),
            valid_until: end,
            price_type: kind.into(),
            monthly_price: None,
            first_year_cost: None,
            components,
            conditions,
            evidence,
            evidence_version: 1,
            restricted,
            electricity_rates,
        });
    }
    if offers.is_empty() {
        return Err("Nessuna offerta PLACET domestica attiva riconosciuta".into());
    }
    Ok(offers)
}

pub fn parse_parameters(
    input: &str,
    source_url: &str,
) -> Result<crate::domain::ElectricityParameters, String> {
    #[derive(Deserialize)]
    struct Parameter {
        nome_parametro: String,
        valore: f64,
    }
    let mut values = std::collections::HashMap::new();
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(input.as_bytes());
    for row in reader.deserialize::<Parameter>() {
        let row = row.map_err(|e| format!("Parametri elettrici non riconosciuti: {e}"))?;
        if !row.valore.is_finite() || values.insert(row.nome_parametro, row.valore).is_some() {
            return Err("Parametro elettrico duplicato o non finito".into());
        }
    }
    for key in [
        "dispbt_d",
        "cdispd",
        "sigma1",
        "sigma2",
        "sigma3",
        "uc3",
        "uc6p_d",
        "uc6s_d",
        "asos_dr",
        "arim_dr",
        "asos_dnr_f",
        "arim_dnr_f",
        "asos_dnr_v",
        "arim_dnr_v",
        "acc_c_r_l",
        "acc_c_r_h",
        "acc_c_nr",
        "iva_c",
    ] {
        if !values.contains_key(key) {
            return Err(format!("Parametro elettrico mancante: {key}"));
        }
    }
    let published = source_url
        .rsplit('_')
        .next()
        .and_then(|s| s.strip_suffix(".csv"))
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y%m%d").ok())
        .ok_or("Data dei parametri elettrici non riconosciuta")?;
    Ok(crate::domain::ElectricityParameters {
        values,
        source_url: source_url.into(),
        published_on: published.format("%Y-%m-%d").to_string(),
        fetched_at: now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(client: &str, end: &str) -> String {
        format!(
            r#"<ListaOfferteMercatoLibero><offerta><IdentificativiOfferta><COD_OFFERTA>TEST</COD_OFFERTA></IdentificativiOfferta><DettaglioOfferta><TIPO_CLIENTE>{client}</TIPO_CLIENTE><TIPO_OFFERTA>02</TIPO_OFFERTA><NOME_OFFERTA>Indexed</NOME_OFFERTA><Contatti><URL_OFFERTA>https://example.org/offer</URL_OFFERTA></Contatti></DettaglioOfferta><ValiditaOfferta><DATA_INIZIO>01/01/2020_00:00:00</DATA_INIZIO><DATA_FINE>{end}_23:59:59</DATA_FINE></ValiditaOfferta><ComponenteImpresa><NOME>Spread</NOME><IntervalloPrezzi><PREZZO>0.015</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi></ComponenteImpresa></offerta></ListaOfferteMercatoLibero>"#
        )
    }
    #[test]
    fn indexed_is_never_total() {
        let items = parse(&fixture("01", "31/12/2099"), "luce", "https://example.org").unwrap();
        assert_eq!(items[0].price_type, "variable");
        assert!(items[0].first_year_cost.is_none());
        assert_eq!(items[0].components[0].amount, 0.015);
        assert!(items[0].conditions[0].contains("spread"));
    }

    #[test]
    fn ai_evidence_excludes_application_annotations_and_rejects_legacy_snapshots() {
        let xml = fixture("01", "31/12/2099").replace("<NOME_OFFERTA>Indexed</NOME_OFFERTA>", "<NOME_OFFERTA>Indexed</NOME_OFFERTA><DESCRIZIONE>Pagamento tramite addebito sul conto corrente.</DESCRIZIONE><DURATA>12</DURATA>");
        let offer = parse(&xml, "luce", "https://example.org")
            .unwrap()
            .remove(0);
        assert!(offer
            .conditions
            .iter()
            .any(|s| s.contains("Durata condizioni economiche")));
        let evidence = offer.source_evidence().unwrap();
        assert!(evidence.contains("Pagamento tramite addebito sul conto corrente."));
        assert!(!evidence.contains("Durata condizioni economiche"));
        assert!(!evidence.contains("non totale bolletta"));
        assert!(!evidence.contains("si aggiunge"));
        let mut old = serde_json::to_value(&offer).unwrap();
        old.as_object_mut().unwrap().remove("evidenceVersion");
        let legacy: Offer = serde_json::from_value(old).unwrap();
        assert!(legacy.source_evidence().unwrap_err().contains("Aggiorna"));
    }
    #[test]
    fn excludes_business_and_expired() {
        assert!(parse(&fixture("02", "31/12/2099"), "luce", "").is_err());
        assert!(parse(&fixture("01", "01/01/2020"), "luce", "").is_err());
    }
    #[test]
    fn rejects_corrupt_feed() {
        assert!(parse("<broken>", "gas", "").is_err());
    }
    #[test]
    fn placet_csv_preserves_decimal_prices_and_excludes_business() {
        let csv="denominazione,nome_offerta,cod_offerta,tipo_cliente,tipo_offerta,data_inizio,data_fine,p_fix_f,p_vol\nExample,Gas,1,domestico,prezzo fisso,01/01/2020,31/12/2099,120,0.65\nExample,Business,2,non domestico,prezzo fisso,01/01/2020,31/12/2099,100,0.50\n";
        let result = parse_placet(csv, "gas", "https://example.org/data.csv").unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].components[1].amount, 0.65);
        assert!(result[0].first_year_cost.is_none());
        assert!(result[0].source_evidence().unwrap().contains("0.65"));
        assert!(!result[0].evidence.contains("p_vol:"));
        assert!(!result[0].evidence.contains("totale della bolletta"));
        assert_eq!(
            result[0].evidence,
            parse_placet(csv, "gas", "https://example.org/data.csv").unwrap()[0].evidence
        );
    }

    #[test]
    fn placet_estimation_obeys_contract_tariff_and_preserves_missing_fee() {
        let input = "denominazione,nome_offerta,cod_offerta,tipo_cliente,tipo_offerta,data_inizio,data_fine,p_fix_f,p_vol_mono,p_vol_bf1,p_vol_bf23\nExample,Mono,028269ESFMP01XXPLACLFISDOM260812,domestico,prezzo fisso,01/01/2020,31/12/2099,120,0.10,0.11,0.09\nExample,Bio,020237ESFFP08XXPLACETFISSALUCEDO,domestico,prezzo fisso,01/01/2020,31/12/2099,,0.10,0.11,0.09\nExample,Unknown,short,domestico,prezzo fisso,01/01/2020,31/12/2099,120,0.10,,\n";
        let offers = parse_placet(input, "luce", "https://example.org/data.csv").unwrap();
        let mono = offers[0].electricity_rates.as_ref().unwrap();
        assert_eq!(mono.mono, Some(0.10));
        assert!(mono.f1.is_none());
        let bio = offers[1].electricity_rates.as_ref().unwrap();
        assert!(bio.mono.is_none());
        assert!(bio.annual_fee.is_none());
        assert_eq!(bio.f23, Some(0.09));
        assert!(offers[2].electricity_rates.is_none());
        assert!(parse_placet(input, "gas", "").unwrap()[0]
            .electricity_rates
            .is_none());
    }

    #[test]
    fn parameters_reject_missing_duplicate_and_non_finite_values() {
        let url = "https://example.org/PO_Parametri_E_20260923.csv";
        assert!(
            parse_parameters("nome_parametro,valore\nsigma1,23.04\n", url)
                .unwrap_err()
                .contains("mancante")
        );
        for data in ["sigma1,23.04\nsigma1,10", "sigma1,NaN"] {
            assert!(
                parse_parameters(&format!("nome_parametro,valore\n{data}\n"), url)
                    .unwrap_err()
                    .contains("duplicato o non finito")
            );
        }
    }
}
