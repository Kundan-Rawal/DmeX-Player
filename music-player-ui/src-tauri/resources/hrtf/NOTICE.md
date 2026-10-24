# DmeX HRTF Data Notice

`subject_003.sofa` is from the CIPIC HRTF database maintained by the
UC Davis Center for Image Processing and Integrated Computing.

- Source: https://sofacoustics.org/data/database/cipic/
- Original project: https://www.ece.ucdavis.edu/cipic/spatial-sound/hrtf-data/
- Citation: V. R. Algazi, R. O. Duda, D. M. Thompson, and C. Avendano,
  "The CIPIC HRTF Database," 2001 IEEE Workshop on Applications of Signal
  Processing to Audio and Electroacoustics.

The CIPIC database is publicly available for research and development; its
maintainers request acknowledgement when used in commercial products.

DmeX uses this measured `SimpleFreeFieldHRIR` profile with Valve Steam Audio.
Steam Audio generates the binaural filters at the active DmeX pipeline rate.

Android and Eco mode use fixed-zone measured filters generated from the same
profile in `audio-engine-cpp/PortableHrtfData.h`. The generator is
`scripts/generate_portable_hrtf.py`. Its generated header includes the original
SOFA permission notice and source SHA256. Both ears share one normalization
gain per direction; interaural timing and level differences remain intact.
The filters are resampled offline for supported pipeline rates, not during
the real-time callback. Full uses the complete measured impulse and Eco uses
its first 160 source-rate-equivalent taps. This is an eight-zone renderer,
not continuous head tracking or a personalized HRTF measurement.
