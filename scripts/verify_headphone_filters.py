"""Verify exported filter samples, format, rate and provenance metadata."""
import hashlib
import json
import os
import struct
import numpy as np
from generate_headphone_inverses import INPUT_DIR, OUTPUT_DIR, compute_regularized_inverse, read_wav

MODELS = {
    "AppleAirPods": ["AppleAirPods.wav"], "AppleEarPods": ["AppleEarPods.wav"],
    "Sony_WH1000XM2": ["Sony_WH1000XM2L.wav", "Sony_WH1000XM2R.wav"],
    "SennheiserHD": ["SennheiserHD.wav"], "AKGK240": ["AKGK240.wav"],
    "AKGK701": ["AKGK701L.wav", "AKGK701R.wav"], "HyperXCloudalpha": ["HyperXCloudalpha.wav"],
    "OppoPM3": ["OppoPM3.wav"], "SteelSeriesArctic9X": ["SteelSeriesArctic9X.wav"],
    "xiaomipiston2": ["xiaomipiston2.wav"],
}


def chunks(payload):
    if payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
        raise ValueError("Not a WAV file")
    if struct.unpack_from("<I", payload, 4)[0] + 8 != len(payload):
        raise ValueError("Incorrect RIFF size")
    offset = 12
    found = {}
    while offset + 8 <= len(payload):
        name, count = struct.unpack_from("<4sI", payload, offset)
        found[name] = payload[offset + 8:offset + 8 + count]
        if len(found[name]) != count:
            raise ValueError("Truncated WAV chunk")
        offset += 8 + count + count % 2
    return found


def verify():
    manifest = {"version": 1, "target": "DmeX regularized target approximation v1",
                "measurementProvenance": "Unverified bundled responses, not certified calibration",
                "sourceLicense": "Not established by this audit; confirm before public redistribution",
                "filters": []}
    for model, sources in MODELS.items():
        originals = [read_wav(os.path.join(INPUT_DIR, name)) for name in sources]
        rate = originals[0][1]
        if len(originals) == 2:
            assert originals[1][1] == rate
            left, right = [v[0].flatten() for v in originals]
        elif originals[0][2] == 1:
            left = right = originals[0][0]
        else:
            left, right = originals[0][0][:, 0], originals[0][0][:, 1]
        expected = np.column_stack([compute_regularized_inverse(left, rate), compute_regularized_inverse(right, rate)])
        filename = model + "_harman_inv.wav"
        with open(os.path.join(OUTPUT_DIR, filename), "rb") as source:
            payload = source.read()
        parts = chunks(payload)
        encoding, channels, exported_rate, _, align, bits = struct.unpack_from("<HHIIHH", parts[b"fmt "])
        assert (encoding, channels, exported_rate, align, bits) == (3, 2, rate, 8, 32)
        actual = np.frombuffer(parts[b"data"], dtype="<f4").reshape(-1, 2)
        assert actual.shape == (1024, 2) and np.isfinite(actual).all()
        error = float(np.max(np.abs(actual - expected)))
        assert error < 1e-7, (model, error)
        response = np.abs(np.fft.rfft(actual, n=8192, axis=0))
        manifest["filters"].append({"model": model, "file": filename, "sourceFiles": sources,
            "sampleRate": rate, "channels": 2, "frames": 1024, "encoding": "IEEE float32",
            "sha256": hashlib.sha256(payload).hexdigest(), "peakCoefficient": float(np.max(np.abs(actual))),
            "maximumResponseDb": float(20 * np.log10(np.max(response))), "roundTripError": error,
            "order": "After spatial/reverb, before final limiter"})
        print(f"PASS {model}: {rate} Hz float32, 1024 stereo frames, error={error:.3g}")
    with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w", encoding="ascii") as output:
        json.dump(manifest, output, indent=2)
        output.write("\n")
    print("10 filter exports verified; provenance limitations recorded in manifest.json")


if __name__ == "__main__":
    verify()
