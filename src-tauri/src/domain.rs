use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceComponent {
    pub name: String,
    pub amount: f64,
    pub unit: String,
    pub band: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    pub category: String,
    pub subcategory: String,
    pub provider: String,
    pub name: String,
    pub description: String,
    pub url: String,
    pub source: String,
    pub source_url: String,
    pub fetched_at: String,
    pub valid_until: Option<String>,
    pub price_type: String,
    pub monthly_price: Option<f64>,
    pub first_year_cost: Option<f64>,
    pub components: Vec<PriceComponent>,
    pub conditions: Vec<String>,
    pub evidence: String,
    #[serde(default)]
    pub evidence_version: u8,
    pub restricted: bool,
    #[serde(default)]
    pub electricity_rates: Option<ElectricityRates>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElectricityRates {
    pub annual_fee: Option<f64>,
    pub mono: Option<f64>,
    pub f1: Option<f64>,
    pub f23: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElectricityParameters {
    pub values: std::collections::HashMap<String, f64>,
    pub source_url: String,
    pub published_on: String,
    pub fetched_at: String,
}

impl Offer {
    pub fn source_evidence(&self) -> Result<&str, String> {
        if self.evidence_version != 1 {
            return Err(
                "Aggiorna le offerte per acquisire il testo originale prima dell'analisi AI".into(),
            );
        }
        Ok(&self.evidence)
    }

    pub fn active(&self) -> bool {
        self.valid_until.as_ref().is_none_or(|v| {
            v.as_str() >= chrono::Local::now().format("%Y-%m-%d").to_string().as_str()
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResult {
    pub source: String,
    pub url: String,
    pub offers: Vec<Offer>,
    pub fetched_at: String,
    pub error: Option<String>,
    pub cached: bool,
    #[serde(default)]
    pub electricity_parameters: Option<ElectricityParameters>,
    #[serde(default)]
    pub calculation_error: Option<String>,
    #[serde(default)]
    pub partial: bool,
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn web_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(|_| "Indirizzo non valido".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Sono consentiti soltanto collegamenti web pubblici".into());
    }
    match parsed.host() {
        Some(url::Host::Ipv4(_)) | Some(url::Host::Ipv6(_)) => {
            return Err("Indirizzo IP non consentito".into())
        }
        Some(url::Host::Domain(host))
            if host == "localhost" || !host.contains('.') || host.ends_with(".local") =>
        {
            return Err("Indirizzo locale non consentito".into())
        }
        _ => {}
    }
    Ok(parsed)
}
