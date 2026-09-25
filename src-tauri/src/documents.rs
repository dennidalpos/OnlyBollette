use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use windows::{
    Data::Pdf::{PdfDocument, PdfPageRenderOptions},
    Graphics::Imaging::{BitmapDecoder, BitmapEncoder},
    Storage::Streams::{DataReader, DataWriter, InMemoryRandomAccessStream},
};

const MODEL_HASH: &str = "8df9c89176fb93f56bf4b2d4ede04c01c1f31d4b7697fbd76cc336df700f3f38";
const OUTPUT_LIMIT: u64 = 8 * 1024 * 1024;
const OCR_ERROR: &str =
    "OCR non riuscito. Inserisci i dati manualmente o riprova con un documento leggibile.";
const RUNTIME_ERROR: &str = "OCR integrato mancante o danneggiato. Reinstalla OnlyBollette.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub number: u32,
    pub text: String,
    pub lines: Vec<DocumentLine>,
}
#[derive(Serialize)]
pub struct DocumentWord {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
#[derive(Serialize)]
pub struct DocumentLine {
    pub words: Vec<DocumentWord>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentAnalysis {
    pub file_name: String,
    pub pages: Vec<DocumentPage>,
    pub readable: bool,
}
#[derive(Deserialize)]
struct RuntimeManifest {
    version: String,
    files: BTreeMap<String, String>,
}

fn verify_runtime(root: &Path) -> Result<(), String> {
    let manifest: RuntimeManifest = serde_json::from_slice(
        &std::fs::read(root.join("manifest.json")).map_err(|_| RUNTIME_ERROR)?,
    )
    .map_err(|_| RUNTIME_ERROR)?;
    if manifest.version != "5.5.3"
        || manifest
            .files
            .get("tessdata/ita.traineddata")
            .map(String::as_str)
            != Some(MODEL_HASH)
    {
        return Err(RUNTIME_ERROR.into());
    }
    for name in ["tesseract.exe", "tessdata/ita.traineddata"] {
        let expected = manifest.files.get(name).ok_or(RUNTIME_ERROR)?;
        let bytes = std::fs::read(root.join(name)).map_err(|_| RUNTIME_ERROR)?;
        if format!("{:x}", Sha256::digest(bytes)) != *expected {
            return Err(RUNTIME_ERROR.into());
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct TsvWord {
    level: u8,
    page_num: u32,
    block_num: u32,
    par_num: u32,
    line_num: u32,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    text: String,
}
fn parse_tsv(bytes: &[u8]) -> Result<Vec<DocumentLine>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .quoting(false)
        .from_reader(bytes);
    let mut lines: Vec<DocumentLine> = Vec::new();
    let mut previous = None;
    for record in reader.deserialize::<TsvWord>() {
        let word = record.map_err(|_| OCR_ERROR)?;
        if word.level != 5 || word.text.trim().is_empty() {
            continue;
        }
        if word.width == 0 || word.height == 0 {
            return Err(OCR_ERROR.into());
        }
        let key = (word.page_num, word.block_num, word.par_num, word.line_num);
        if previous != Some(key) {
            lines.push(DocumentLine { words: Vec::new() });
            previous = Some(key);
        }
        lines.last_mut().ok_or(OCR_ERROR)?.words.push(DocumentWord {
            text: word.text,
            x: word.left as f32,
            y: word.top as f32,
            width: word.width as f32,
            height: word.height as f32,
        });
    }
    Ok(lines)
}

async fn recognize(
    root: &Path,
    bytes: &[u8],
    cancel: &CancellationToken,
) -> Result<Vec<DocumentLine>, String> {
    if cancel.is_cancelled() {
        return Err("Operazione annullata".into());
    }
    let mut child = tokio::process::Command::new(root.join("tesseract.exe"))
        .current_dir(root)
        .args(["stdin", "stdout", "--tessdata-dir", "tessdata"])
        .args([
            "-l",
            "ita",
            "--oem",
            "1",
            "--psm",
            "11",
            "-c",
            "tessedit_create_tsv=1",
        ])
        .env_remove("TESSDATA_PREFIX")
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| RUNTIME_ERROR)?;
    let mut input = child.stdin.take().ok_or(OCR_ERROR)?;
    let output = child.stdout.take().ok_or(OCR_ERROR)?;
    let work = async {
        let write = async {
            input.write_all(bytes).await.map_err(|_| OCR_ERROR)?;
            input.shutdown().await.map_err(|_| OCR_ERROR)?;
            drop(input);
            Ok::<_, &str>(())
        };
        let read = async {
            let mut data = Vec::new();
            output
                .take(OUTPUT_LIMIT + 1)
                .read_to_end(&mut data)
                .await
                .map_err(|_| OCR_ERROR)?;
            if data.len() as u64 > OUTPUT_LIMIT {
                return Err(OCR_ERROR);
            }
            Ok(data)
        };
        let (_, data) = tokio::try_join!(write, read)?;
        if !child.wait().await.map_err(|_| OCR_ERROR)?.success() {
            return Err(OCR_ERROR);
        }
        Ok(data)
    };
    let result = tokio::select! {
        _ = cancel.cancelled() => Err("Operazione annullata".to_string()),
        result = tokio::time::timeout(Duration::from_secs(120), work) => {
            match result {
                Ok(Ok(data)) => parse_tsv(&data),
                _ => Err(OCR_ERROR.into()),
            }
        }
    };
    if result.is_err() {
        if child.try_wait().map_err(|_| OCR_ERROR)?.is_none() {
            child.kill().await.map_err(|_| OCR_ERROR)?;
        }
        child.wait().await.map_err(|_| OCR_ERROR)?;
    }
    result
}

fn document_page(number: u32, lines: Vec<DocumentLine>) -> DocumentPage {
    let text = lines
        .iter()
        .map(|line| {
            line.words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n");
    DocumentPage {
        number,
        text,
        lines,
    }
}
fn memory_stream(bytes: &[u8]) -> Result<InMemoryRandomAccessStream, String> {
    let stream = InMemoryRandomAccessStream::new().map_err(|_| OCR_ERROR)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|_| OCR_ERROR)?;
    writer.WriteBytes(bytes).map_err(|_| OCR_ERROR)?;
    writer
        .StoreAsync()
        .map_err(|_| OCR_ERROR)?
        .get()
        .map_err(|_| OCR_ERROR)?;
    writer.DetachStream().map_err(|_| OCR_ERROR)?;
    stream.Seek(0).map_err(|_| OCR_ERROR)?;
    Ok(stream)
}
fn stream_bytes(stream: &InMemoryRandomAccessStream) -> Result<Vec<u8>, String> {
    let size = stream.Size().map_err(|_| OCR_ERROR)?;
    if size > 64 * 1024 * 1024 {
        return Err("Immagine troppo grande per la lettura OCR".into());
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(|_| OCR_ERROR)?)
        .map_err(|_| OCR_ERROR)?;
    let loaded = reader
        .LoadAsync(size as u32)
        .map_err(|_| OCR_ERROR)?
        .get()
        .map_err(|_| OCR_ERROR)?;
    if loaded as u64 != size {
        return Err(OCR_ERROR.into());
    }
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).map_err(|_| OCR_ERROR)?;
    Ok(bytes)
}

pub fn analyze(
    path: &str,
    runtime: &Path,
    cancel: &CancellationToken,
) -> Result<DocumentAnalysis, String> {
    if cancel.is_cancelled() {
        return Err("Operazione annullata".into());
    }
    let resolved = Path::new(path)
        .canonicalize()
        .map_err(|_| "File non leggibile")?;
    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "pdf" | "png" | "jpg" | "jpeg" | "bmp" | "tif" | "tiff"
    ) {
        return Err("Seleziona un PDF o un'immagine PNG, JPEG, BMP o TIFF".into());
    }
    let size = resolved.metadata().map_err(|_| "File non leggibile")?.len();
    if size == 0 || size > 25 * 1024 * 1024 {
        return Err("Il file deve essere leggibile e non superare 25 MB".into());
    }
    let name = resolved
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Documento")
        .to_string();
    let root = runtime.join("ocr");
    verify_runtime(&root)?;
    let executor = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| OCR_ERROR)?;
    let bytes = std::fs::read(&resolved).map_err(|_| "File non leggibile")?;
    let input = memory_stream(&bytes)?;
    let mut pages = Vec::new();
    if ext == "pdf" {
        let pdf = PdfDocument::LoadFromStreamAsync(&input)
            .map_err(|_| "PDF non leggibile o protetto")?
            .get()
            .map_err(|_| "PDF non leggibile o protetto")?;
        let count = pdf.PageCount().map_err(|_| OCR_ERROR)?;
        if count == 0 || count > 60 {
            return Err("Il PDF deve contenere da 1 a 60 pagine".into());
        }
        for index in 0..count {
            if cancel.is_cancelled() {
                return Err("Operazione annullata".into());
            }
            let page = pdf.GetPage(index).map_err(|_| OCR_ERROR)?;
            let stream = InMemoryRandomAccessStream::new().map_err(|_| OCR_ERROR)?;
            let options = PdfPageRenderOptions::new().map_err(|_| OCR_ERROR)?;
            let size = page.Size().map_err(|_| OCR_ERROR)?;
            if size.Width <= 0.0 || size.Height <= 0.0 {
                return Err("Pagina PDF con dimensioni non valide".into());
            }
            let scale = (2000.0_f32 / size.Width)
                .min(6000.0 / size.Width)
                .min(6000.0 / size.Height);
            options
                .SetDestinationWidth((size.Width * scale).floor().max(1.0) as u32)
                .map_err(|_| OCR_ERROR)?;
            options
                .SetDestinationHeight((size.Height * scale).floor().max(1.0) as u32)
                .map_err(|_| OCR_ERROR)?;
            page.RenderWithOptionsToStreamAsync(&stream, &options)
                .map_err(|_| OCR_ERROR)?
                .get()
                .map_err(|_| OCR_ERROR)?;
            page.Close().map_err(|_| OCR_ERROR)?;
            pages.push(document_page(
                index + 1,
                executor.block_on(recognize(&root, &stream_bytes(&stream)?, cancel))?,
            ));
        }
    } else {
        let decoder = BitmapDecoder::CreateAsync(&input)
            .map_err(|_| OCR_ERROR)?
            .get()
            .map_err(|_| OCR_ERROR)?;
        let width = decoder.PixelWidth().map_err(|_| OCR_ERROR)? as u64;
        let height = decoder.PixelHeight().map_err(|_| OCR_ERROR)? as u64;
        if width == 0 || height == 0 || width * height > 36_000_000 {
            return Err("Immagine troppo grande per la lettura OCR".into());
        }
        let bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|_| OCR_ERROR)?
            .get()
            .map_err(|_| OCR_ERROR)?;
        let png = InMemoryRandomAccessStream::new().map_err(|_| OCR_ERROR)?;
        let encoder =
            BitmapEncoder::CreateAsync(BitmapEncoder::PngEncoderId().map_err(|_| OCR_ERROR)?, &png)
                .map_err(|_| OCR_ERROR)?
                .get()
                .map_err(|_| OCR_ERROR)?;
        encoder.SetSoftwareBitmap(&bitmap).map_err(|_| OCR_ERROR)?;
        encoder
            .FlushAsync()
            .map_err(|_| OCR_ERROR)?
            .get()
            .map_err(|_| OCR_ERROR)?;
        pages.push(document_page(
            1,
            executor.block_on(recognize(&root, &stream_bytes(&png)?, cancel))?,
        ));
    }
    let readable = pages.iter().any(|page| !page.text.trim().is_empty());
    Ok(DocumentAnalysis {
        file_name: name,
        pages,
        readable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEADER: &str = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n";
    #[test]
    fn tsv_preserves_geometry_decimals_accents_and_distinct_blocks() {
        let input = format!("{HEADER}5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t98\t0,12345\n5\t1\t1\t1\t1\t2\t100\t20\t50\t12\t90\t€/kWh\n5\t1\t2\t1\t1\t1\t400\t20\t60\t12\t90\tUnità\n");
        let lines = parse_tsv(input.as_bytes()).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].words[0].text, "0,12345");
        assert_eq!(lines[0].words[1].x, 100.0);
        assert_eq!(lines[1].words[0].text, "Unità");
    }
    #[test]
    fn tsv_does_not_repair_letters_or_missing_units() {
        let input = format!("{HEADER}5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t80\to,123\n");
        let lines = parse_tsv(input.as_bytes()).unwrap();
        assert_eq!(lines[0].words.len(), 1);
        assert_eq!(lines[0].words[0].text, "o,123");
        assert!(parse_tsv(b"malformed\nrow\n").is_err());
    }
    #[test]
    fn absent_runtime_is_explicit() {
        assert_eq!(
            verify_runtime(Path::new("missing-ocr-test-runtime")).unwrap_err(),
            RUNTIME_ERROR
        );
    }

    #[test]
    fn missing_or_corrupt_bundled_model_is_rejected() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("ocr-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("tessdata")).unwrap();
        std::fs::write(root.join("tesseract.exe"), b"synthetic executable").unwrap();
        let executable_hash = format!("{:x}", Sha256::digest(b"synthetic executable"));
        let manifest = serde_json::json!({"version":"5.5.3","files":{"tesseract.exe":executable_hash,"tessdata/ita.traineddata":MODEL_HASH}});
        std::fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let absent = verify_runtime(&root);
        std::fs::write(root.join("tessdata/ita.traineddata"), b"corrupt").unwrap();
        let corrupt = verify_runtime(&root);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(absent.unwrap_err(), RUNTIME_ERROR);
        assert_eq!(corrupt.unwrap_err(), RUNTIME_ERROR);
    }
}
