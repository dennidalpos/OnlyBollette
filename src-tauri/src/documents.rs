use serde::Serialize;
use std::path::Path;
use windows::{
    Data::Pdf::{PdfDocument, PdfPageRenderOptions},
    Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode,
        ExifOrientationMode,
    },
    Media::Ocr::OcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
};

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

fn recognize(
    engine: &OcrEngine,
    stream: &windows::Storage::Streams::IRandomAccessStream,
) -> Result<Vec<DocumentLine>, String> {
    let decoder = BitmapDecoder::CreateAsync(stream)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let original = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let limit = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())? as f32;
    let width = original.PixelWidth().map_err(|e| e.to_string())? as f32;
    let height = original.PixelHeight().map_err(|e| e.to_string())? as f32;
    let bitmap = if width > limit || height > limit {
        let scale = (limit / width).min(limit / height);
        let transform = BitmapTransform::new().map_err(|e| e.to_string())?;
        transform
            .SetScaledWidth((width * scale).floor() as u32)
            .map_err(|e| e.to_string())?;
        transform
            .SetScaledHeight((height * scale).floor() as u32)
            .map_err(|e| e.to_string())?;
        decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Premultiplied,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?
    } else {
        original
    };
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    for line in result.Lines().map_err(|e| e.to_string())? {
        let mut words = Vec::new();
        for word in line.Words().map_err(|e| e.to_string())? {
            let rect = word.BoundingRect().map_err(|e| e.to_string())?;
            words.push(DocumentWord {
                text: word.Text().map_err(|e| e.to_string())?.to_string(),
                x: rect.X,
                y: rect.Y,
                width: rect.Width,
                height: rect.Height,
            });
        }
        lines.push(DocumentLine { words });
    }
    Ok(lines)
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
    let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|e| e.to_string())?;
    writer.WriteBytes(bytes).map_err(|e| e.to_string())?;
    writer
        .StoreAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    writer.DetachStream().map_err(|e| e.to_string())?;
    stream.Seek(0).map_err(|e| e.to_string())?;
    Ok(stream)
}

pub fn analyze(path: &str) -> Result<DocumentAnalysis, String> {
    let resolved = Path::new(path)
        .canonicalize()
        .map_err(|_| "File non leggibile".to_string())?;
    let file = resolved.as_path();
    let ext = file
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
    let size = file
        .metadata()
        .map_err(|_| "File non leggibile".to_string())?
        .len();
    if size == 0 || size > 25 * 1024 * 1024 {
        return Err("Il file deve essere leggibile e non superare 25 MB".into());
    }
    let name = file
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Documento")
        .to_string();
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| "OCR Windows non disponibile: verifica la lingua installata".to_string())?;
    let bytes = std::fs::read(file).map_err(|_| "File non leggibile".to_string())?;
    let input = memory_stream(&bytes)?;
    let mut pages = Vec::new();
    if ext == "pdf" {
        let pdf = PdfDocument::LoadFromStreamAsync(&input)
            .map_err(|_| "PDF non leggibile o protetto".to_string())?
            .get()
            .map_err(|_| "PDF non leggibile o protetto".to_string())?;
        let count = pdf.PageCount().map_err(|e| e.to_string())?;
        if count == 0 || count > 60 {
            return Err("Il PDF deve contenere da 1 a 60 pagine".into());
        }
        for index in 0..count {
            let page = pdf.GetPage(index).map_err(|e| e.to_string())?;
            let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
            let options = PdfPageRenderOptions::new().map_err(|e| e.to_string())?;
            let size = page.Size().map_err(|e| e.to_string())?;
            if size.Width <= 0.0 || size.Height <= 0.0 {
                return Err("Pagina PDF con dimensioni non valide".into());
            }
            let max = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())? as f32;
            let scale = (2000.0 / size.Width)
                .min(max / size.Width)
                .min(max / size.Height);
            options
                .SetDestinationWidth((size.Width * scale).floor() as u32)
                .map_err(|e| e.to_string())?;
            options
                .SetDestinationHeight((size.Height * scale).floor() as u32)
                .map_err(|e| e.to_string())?;
            page.RenderWithOptionsToStreamAsync(&stream, &options)
                .map_err(|e| e.to_string())?
                .get()
                .map_err(|e| e.to_string())?;
            stream.Seek(0).map_err(|e| e.to_string())?;
            pages.push(document_page(
                index + 1,
                recognize(&engine, &stream.into())?,
            ));
            page.Close().map_err(|e| e.to_string())?;
        }
    } else {
        pages.push(document_page(1, recognize(&engine, &input.into())?));
    }
    let readable = pages.iter().any(|page| !page.text.trim().is_empty());
    Ok(DocumentAnalysis {
        file_name: name,
        pages,
        readable,
    })
}
