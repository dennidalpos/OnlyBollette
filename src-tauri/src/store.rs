use crate::domain::{Offer, SourceResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

fn connect(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS snapshots (category TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(category, source));").map_err(|e| e.to_string())?;
    Ok(db)
}

pub fn save(path: &Path, category: &str, result: &SourceResult) -> Result<(), String> {
    if result.error.is_some() {
        return Ok(());
    }
    connect(path)?.execute("INSERT INTO snapshots(category, source, payload) VALUES (?1, ?2, ?3) ON CONFLICT(category,source) DO UPDATE SET payload=excluded.payload", params![category, result.source, serde_json::to_string(result).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load(path: &Path, category: &str) -> Result<Vec<SourceResult>, String> {
    let db = connect(path)?;
    let mut query = db
        .prepare("SELECT payload FROM snapshots WHERE category=?1 ORDER BY source")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([category], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        let mut item: SourceResult =
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        item.cached = true;
        item.offers.retain(Offer::active);
        if category == "internet" || category == "assicurazioni" {
            item.offers.retain(|offer| {
                crate::sources::is_product_url(&offer.source, &offer.url, category)
            });
        }
        results.push(item);
    }
    Ok(results)
}

pub fn find(path: &Path, id: &str) -> Result<Offer, String> {
    let db = connect(path)?;
    let pattern = format!("\"id\":\"{id}\"");
    let mut stmt = db
        .prepare("SELECT payload FROM snapshots WHERE instr(payload, ?1) > 0")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pattern], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let result: SourceResult =
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if let Some(offer) = result.offers.into_iter().find(|o| o.id == id) {
            return Ok(offer);
        }
    }
    Err("Offerta non presente nell'archivio locale".into())
}

pub fn cached_summary(path: &Path, id: &str, evidence: &str) -> Result<Option<String>, String> {
    let db = connect(path)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, evidence TEXT NOT NULL, content TEXT NOT NULL)").map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT content FROM summaries WHERE id=?1 AND evidence=?2",
        params![id, evidence],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_summary(path: &Path, id: &str, evidence: &str, content: &str) -> Result<(), String> {
    let db = connect(path)?;
    db.execute("INSERT INTO summaries(id,evidence,content) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET evidence=excluded.evidence, content=excluded.content", params![id,evidence,content]).map_err(|e| e.to_string())?;
    Ok(())
}
