use std::{fs::File, io::{Read, Seek, SeekFrom}};
use symphonia::core::{formats::FormatOptions, io::{MediaSource, MediaSourceStream}, meta::MetadataOptions, probe::{Hint, ProbeResult}};

pub fn audio_track(format: &dyn symphonia::core::formats::FormatReader) -> Option<&symphonia::core::formats::Track> {
    format.tracks().iter().find(|track| symphonia::default::get_codecs().get_codec(track.codec_params.codec).is_some())
}

struct OffsetFile { file: File, offset: u64, length: u64 }
impl Read for OffsetFile {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> { self.file.read(buffer) }
}
impl Seek for OffsetFile {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        let position = match position {
            SeekFrom::Start(value) => self.offset.checked_add(value),
            SeekFrom::End(value) => self.offset.checked_add(self.length).and_then(|v| v.checked_add_signed(value)),
            SeekFrom::Current(value) => self.file.stream_position()?.checked_add_signed(value),
        }.filter(|value| *value >= self.offset)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid media seek"))?;
        self.file.seek(SeekFrom::Start(position)).map(|value| value - self.offset)
    }
}
impl MediaSource for OffsetFile {
    fn is_seekable(&self) -> bool { true }
    fn byte_len(&self) -> Option<u64> { Some(self.length) }
}

pub fn probe(file: File, hint: &Hint, options: &FormatOptions) -> Result<(ProbeResult, bool), String> {
    let mut backup = file.try_clone().map_err(|e| e.to_string())?;
    match symphonia::default::get_probe().format(hint, MediaSourceStream::new(Box::new(file), Default::default()), options, &MetadataOptions::default()) {
        Ok(result) => Ok((result, false)),
        Err(error) => {
            let original = error.to_string();
            if !original.contains("id3v2:") { return Err(original); }
            backup.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            let mut header = [0u8; 10];
            backup.read_exact(&mut header).map_err(|_| original.clone())?;
            if &header[..3] != b"ID3" || ![2, 3, 4].contains(&header[3]) || header[6..10].iter().any(|v| v & 0x80 != 0) {
                return Err(original);
            }
            let size = header[6..10].iter().fold(0u64, |size, byte| (size << 7) | *byte as u64);
            let offset = 10 + size + if header[3] == 4 && header[5] & 0x10 != 0 { 10 } else { 0 };
            let length = backup.metadata().map_err(|e| e.to_string())?.len();
            if size > 64 * 1024 * 1024 || offset >= length { return Err(original); }
            backup.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            // Discard only the bounded damaged tag, never audio frames or arbitrary file bytes.
            let source = OffsetFile { file: backup, offset, length: length - offset };
            symphonia::default::get_probe().format(hint, MediaSourceStream::new(Box::new(source), Default::default()), options, &MetadataOptions::default())
                .map(|result| (result, true)).map_err(|e| format!("{original}; audio recovery failed: {e}"))
        }
    }
}
