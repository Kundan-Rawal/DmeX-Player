# Audio regression fixtures

Synthetic one-second, stereo, 44.1 kHz 440 Hz tones generated locally with FFmpeg.
No copyrighted recordings or private library files are included.

Formats: PCM WAV, FLAC, MP3, AAC in M4A, Ogg Vorbis, ADTS AAC, AIFF and CAF.
A separate MP4 fixture has a video track first and AAC audio second, to verify
that audio selection does not depend on container track order.
Tags, where the container supports them: title `Metadata Fixture`, artist
`Artist One`, album `Fixture Album`.

The FLAC, MP3 and M4A fixtures include the project's existing 128 px application
icon as an attached cover. Native tests verify extraction, deterministic cache
reuse, and repair of a deliberately truncated cache entry.

Example generation (change codec and extension for each format):

```powershell
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -ac 2 -c:a flac -metadata 'title=Metadata Fixture' -metadata 'artist=Artist One' -metadata 'album=Fixture Album' metadata.flac
```
