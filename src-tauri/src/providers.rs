use crate::{domain::now, domain::web_url, sources};
use calamine::{DataType, Reader, Xlsx};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};

const ARERA: &str = "https://www.arera.it/area-operatori/ricerca-operatori";
const AGCOM: &str = "https://datiroc.agcom.it/elenco-pubblico";
const IVASS: &str = "https://www.ivass.it/consumatori/siti-imprese-intermediari/";
const IVASS_CSV: &str = "https://www.ivass.it/consumatori/siti-imprese-intermediari/lista_siti_compagnie_vigilate_da_ivass.zip";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub website: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDirectory {
    pub providers: Vec<Provider>,
    pub source_url: String,
    pub fetched_at: String,
    pub note: String,
}

pub async fn fetch(category: &str) -> Result<ProviderDirectory, String> {
    let client = sources::client()?;
    let (providers, source_url, note) = match category {
        "luce" | "gas" => {
            let html = sources::fetch_text(&client, ARERA, 8_000_000).await?;
            let marker = if category == "luce" {
                "export-mercato-vend"
            } else {
                "export-gas-vend"
            };
            let archive_url = sources::links(&html, ARERA)
                .into_iter()
                .find(|(url, _)| url.contains(marker) && url.ends_with(".zip"))
                .map(|(url, _)| url)
                .ok_or("Elenco venditori ARERA non trovato")?;
            let bytes = sources::fetch_bytes(&client, &archive_url, 4_000_000).await?;
            let spreadsheet = zip_entry(&bytes, ".xlsx", 10_000_000)?;
            (
                parse_arera(&spreadsheet)?,
                ARERA,
                "Venditori presenti nell'anagrafica ARERA. La registrazione non garantisce un'offerta domestica attiva.",
            )
        }
        "internet" => (
            fetch_agcom(&client).await?,
            AGCOM,
            "Soggetti attivi nel registro AGCOM per servizi di comunicazione elettronica. Include attività diverse dalla vendita di offerte Internet domestiche.",
        ),
        "assicurazioni" => {
            let bytes = sources::fetch_bytes(&client, IVASS_CSV, 2_000_000).await?;
            let csv = zip_entry(&bytes, ".csv", 2_000_000)?;
            (
                parse_ivass(&csv)?,
                IVASS,
                "Imprese vigilate da IVASS con sito pubblicato. Per tutte le imprese abilitate, comprese quelle SEE, consultare l'Albo RIGA; la presenza non indica una polizza per ogni ramo.",
            )
        }
        _ => return Err("Categoria non riconosciuta".into()),
    };
    if providers.is_empty() {
        return Err("Il registro ufficiale non contiene operatori leggibili".into());
    }
    Ok(ProviderDirectory {
        providers,
        source_url: source_url.into(),
        fetched_at: now(),
        note: note.into(),
    })
}

fn zip_entry(bytes: &[u8], suffix: &str, max_size: u64) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("Archivio ufficiale non leggibile: {e}"))?;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| format!("Archivio ufficiale non leggibile: {e}"))?;
        if !entry.name().to_ascii_lowercase().ends_with(suffix) {
            continue;
        }
        if entry.size() > max_size {
            return Err("Documento nel registro troppo grande".into());
        }
        let mut output = Vec::new();
        entry
            .take(max_size + 1)
            .read_to_end(&mut output)
            .map_err(|e| format!("Documento nel registro non leggibile: {e}"))?;
        if output.len() as u64 > max_size {
            return Err("Documento nel registro troppo grande".into());
        }
        return Ok(output);
    }
    Err(format!(
        "Documento {suffix} non trovato nell'archivio ufficiale"
    ))
}

fn parse_arera(bytes: &[u8]) -> Result<Vec<Provider>, String> {
    let mut workbook = Xlsx::new(Cursor::new(bytes.to_vec()))
        .map_err(|e| format!("Elenco ARERA non leggibile: {e}"))?;
    let sheet = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or("Elenco ARERA senza foglio dati")?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|e| format!("Elenco ARERA non leggibile: {e}"))?;
    let mut rows = range.rows();
    let header = rows.next().ok_or("Elenco ARERA vuoto")?;
    let column = |name: &str| header.iter().position(|cell| cell.get_string() == Some(name));
    let name_index = column("RAGIONE SOCIALE").ok_or("Nome venditore assente dall'elenco ARERA")?;
    let id_index = column("ID_SOGGETTO").ok_or("Codice soggetto assente dall'elenco ARERA")?;
    let site_index = column("SITO WEB").ok_or("Sito web assente dall'elenco ARERA")?;
    let mut providers = Vec::new();
    for row in rows {
        let value = |index: usize| {
            row.get(index)
                .map(|cell| cell.to_string())
                .unwrap_or_default()
        };
        let name = value(name_index).trim().to_string();
        let id = value(id_index).trim().to_string();
        if name.is_empty() || id.is_empty() {
            continue;
        }
        let website = value(site_index).trim().to_string();
        providers.push(Provider {
            id,
            name,
            website: web_url(&website).ok().map(|url| url.to_string()),
        });
    }
    providers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(providers)
}

fn parse_ivass(bytes: &[u8]) -> Result<Vec<Provider>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b';')
        .trim(csv::Trim::All)
        .from_reader(bytes);
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let column = |name: &str| headers.iter().position(|header| header == name);
    let id_index = column("COD_IVASS").ok_or("Codice impresa assente dall'elenco IVASS")?;
    let name_index =
        column("DENOMINAZIONE_IMPRESA").ok_or("Nome impresa assente dall'elenco IVASS")?;
    let site_index = column("IND_WEB").ok_or("Sito web assente dall'elenco IVASS")?;
    let mut providers = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("Elenco IVASS non leggibile: {e}"))?;
        let id = record.get(id_index).unwrap_or("").trim();
        let name = record.get(name_index).unwrap_or("").trim();
        if id.is_empty() || name.is_empty() {
            continue;
        }
        providers.push(Provider {
            id: id.into(),
            name: name.into(),
            website: record
                .get(site_index)
                .and_then(|site| web_url(site.trim()).ok())
                .map(|url| url.to_string()),
        });
    }
    providers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(providers)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgcomResponse {
    total_records: usize,
    records: Vec<AgcomRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgcomRecord {
    num_iscrizione_roc: String,
    ragione_sociale: String,
    dt_cessazione: Option<String>,
}

async fn fetch_agcom(client: &reqwest::Client) -> Result<Vec<Provider>, String> {
    let response = client
        .post("https://datiroc.agcom.it/api/getElencoPubblico")
        .json(&serde_json::json!({
            "attivitaFilters": ["S"],
            "pageNumber": 0,
            "pageSize": 10_000
        }))
        .timeout(std::time::Duration::from_secs(45))
        .send()
        .await
        .map_err(|e| format!("Registro AGCOM non disponibile: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Registro AGCOM: HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > 10_000_000)
    {
        return Err("Registro AGCOM troppo grande".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Registro AGCOM non leggibile: {e}"))?;
    if bytes.len() > 10_000_000 {
        return Err("Registro AGCOM troppo grande".into());
    }
    let parsed: AgcomResponse = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Formato registro AGCOM non riconosciuto: {e}"))?;
    if parsed.total_records != parsed.records.len() {
        return Err("Elenco AGCOM incompleto; consultare il registro ufficiale".into());
    }
    let mut providers: Vec<_> = parsed
        .records
        .into_iter()
        .filter(|record| record.dt_cessazione.as_deref().unwrap_or("").is_empty())
        .filter(|record| !record.ragione_sociale.trim().is_empty())
        .map(|record| Provider {
            id: record.num_iscrizione_roc,
            name: record.ragione_sociale,
            website: None,
        })
        .collect();
    providers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(providers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ivass_official_columns() {
        let csv = b"Oss;COD_IVASS;DENOMINAZIONE_IMPRESA;IND_WEB\n1;A498S;BENE ASSICURAZIONI S.P.A.;https://www.bene.it/\n";
        let providers = parse_ivass(csv).unwrap();
        assert_eq!(providers[0].id, "A498S");
        assert_eq!(
            providers[0].website.as_deref(),
            Some("https://www.bene.it/")
        );
    }
}
