use std::{fs::File, hash::{Hash, Hasher}, path::Path};
use symphonia::core::{formats::FormatOptions, meta::{MetadataRevision, StandardTagKey}, probe::Hint};

#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetadata {
    title: Option<String>, artist: Option<String>, album: Option<String>, year: Option<String>,
    genre: Option<String>, duration: f64, quality: Option<String>, art_path: Option<String>,
    #[serde(skip)]
    pub recovered_tags: bool,
}

impl AudioMetadata {
    #[cfg(target_os = "android")]
    pub fn merge_native(mut self, native: Self) -> Self {
        if native.title.is_some() { self.title = native.title; }
        if native.artist.is_some() { self.artist = native.artist; }
        if native.album.is_some() { self.album = native.album; }
        if native.year.is_some() { self.year = native.year; }
        if native.genre.is_some() { self.genre = native.genre; }
        if native.art_path.is_some() { self.art_path = native.art_path; }
        if self.duration <= 0.0 { self.duration = native.duration; }
        if self.quality.is_none() { self.quality = native.quality; }
        self
    }
}

fn read_tags(result: &mut AudioMetadata, revision: &MetadataRevision) {
    let mut artists = Vec::new();
    for tag in revision.tags() {
        let value = tag.value.to_string().trim_matches('\0').trim().to_string();
        if value.is_empty() { continue; }
        match tag.std_key {
            Some(StandardTagKey::TrackTitle) => { result.title.get_or_insert(value); }
            Some(StandardTagKey::Artist) => { if !artists.contains(&value) { artists.push(value); } }
            Some(StandardTagKey::Album) => { result.album.get_or_insert(value); }
            Some(StandardTagKey::Date) | Some(StandardTagKey::ReleaseDate) => { result.year.get_or_insert(value); }
            Some(StandardTagKey::Genre) => { result.genre.get_or_insert(value); }
            _ => {}
        }
    }
    if result.artist.is_none() && !artists.is_empty() { result.artist = Some(artists.join("; ")); }
}

pub fn extract(file: File, identity: &str, art_dir: &Path) -> Result<AudioMetadata, String> {
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(identity).extension().and_then(|v| v.to_str()) { hint.with_extension(ext); }
    let (mut probed, recovered_tags) = crate::media_source::probe(file, &hint, &FormatOptions::default())?;
    let mut result = AudioMetadata::default();
    result.recovered_tags = recovered_tags;
    if let Some(track) = crate::media_source::audio_track(probed.format.as_ref()) {
        let p = &track.codec_params;
        result.duration = match (p.time_base, p.n_frames) {
            (Some(base), Some(frames)) => { let time = base.calc_time(frames); time.seconds as f64 + time.frac }
            _ => 0.0,
        };
        result.quality = match (p.bits_per_sample, p.sample_rate) {
            (Some(bits), Some(rate)) => Some(format!("{bits}-bit / {} kHz", rate as f64 / 1000.0)),
            _ if result.duration > 0.0 => Some(format!("{} kbps", (length as f64 * 8.0 / result.duration / 1000.0).round() as u64)),
            _ => None,
        };
    }
    let mut revisions = Vec::new();
    if let Some(meta) = probed.metadata.get().as_ref().and_then(|m| m.current()) { revisions.push(meta.clone()); }
    if let Some(meta) = probed.format.metadata().current() { revisions.push(meta.clone()); }
    for revision in &revisions { read_tags(&mut result, revision); }
    let visuals: Vec<_> = revisions.iter().flat_map(|r| r.visuals()).collect();
    if let Some(visual) = visuals.iter().find(|v| v.usage == Some(symphonia::core::meta::StandardVisualKey::FrontCover)).or_else(|| visuals.first()) {
        if !visual.data.is_empty() && visual.data.len() <= 20 * 1024 * 1024 {
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            visual.data.hash(&mut hash);
            let ext = if visual.media_type.contains("png") { "png" } else if visual.media_type.contains("webp") { "webp" } else { "jpg" };
            std::fs::create_dir_all(art_dir).map_err(|e| e.to_string())?;
            let art = art_dir.join(format!("art_{:016x}.{ext}", hash.finish()));
            if std::fs::metadata(&art).map(|m| m.len()).unwrap_or(0) != visual.data.len() as u64 {
                std::fs::write(&art, &visual.data).map_err(|e| e.to_string())?;
            }
            result.art_path = Some(art.to_string_lossy().into_owned());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damaged_id3_text_does_not_block_valid_mp3_audio() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/audio");
        let root = std::env::temp_dir().join(format!("dmex-bad-tag-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let mut bytes = b"ID3\x03\x00\x00\x00\x00\x00\x0eTIT2\x00\x00\x00\x04\x00\x00\xffbad".to_vec();
        bytes.extend_from_slice(&std::fs::read(fixtures.join("metadata.mp3")).unwrap());
        let path = root.join("bad-tag.mp3");
        std::fs::write(&path, bytes).unwrap();
        let metadata = extract(File::open(&path).unwrap(), path.to_str().unwrap(), &root.join("art")).unwrap();
        assert!(metadata.recovered_tags);
        assert!((metadata.duration - 1.0).abs() < 0.15);
        let pcm = crate::audio_decode::prepare(path.to_str().unwrap(), 48000, &root.join("pcm")).unwrap();
        assert!(pcm.metadata().unwrap().len() > 44);
        let reference = crate::audio_decode::prepare(fixtures.join("metadata.mp3").to_str().unwrap(), 48000, &root.join("pcm")).unwrap();
        assert_eq!(std::fs::read(pcm).unwrap(), std::fs::read(reference).unwrap(), "Damaged tags must not alter decoded audio");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn real_format_fixtures_extract_metadata_and_decode() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/audio");
        let cache = std::env::temp_dir().join(format!("dmex-format-test-{}", std::process::id()));
        for extension in ["wav", "flac", "mp3", "m4a", "mp4", "ogg", "aac", "aiff", "caf"] {
            let path = fixtures.join(format!("metadata.{extension}"));
            let metadata = extract(File::open(&path).unwrap(), path.to_str().unwrap(), &cache.join("art")).unwrap_or_else(|e| panic!("{extension}: {e}"));
            if ["wav", "flac", "mp3", "m4a", "ogg"].contains(&extension) {
                assert_eq!(metadata.title.as_deref(), Some("Metadata Fixture"), "{extension} title");
                assert_eq!(metadata.artist.as_deref(), Some("Artist One"), "{extension} artist");
            }
            if extension != "aac" { assert!((metadata.duration - 1.0).abs() < 0.15, "{extension} duration: {}", metadata.duration); }
            if ["flac", "mp3", "m4a"].contains(&extension) {
                let art = metadata.art_path.expect("Embedded cover should be extracted");
                assert!(std::fs::metadata(&art).unwrap().len() > 0);
                std::fs::write(&art, b"broken").unwrap();
                let repaired = extract(File::open(&path).unwrap(), path.to_str().unwrap(), &cache.join("art")).unwrap();
                assert_eq!(repaired.art_path.as_deref(), Some(art.as_str()));
                assert!(std::fs::metadata(&art).unwrap().len() > 6);
            }
            let decoded = crate::audio_decode::prepare(path.to_str().unwrap(), 48000, &cache.join("pcm")).unwrap_or_else(|e| panic!("{extension} decode: {e}"));
            assert!(decoded.metadata().unwrap().len() > 44, "{extension} PCM");
        }
        std::fs::remove_dir_all(cache).unwrap();
    }
}
