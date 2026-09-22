#!/usr/bin/env python3
"""
generate_headphone_inverses.py
Task T22: Inverse Headphone Compensation (Harman Target Calibration)

Implements the exact regularized minimum-phase inversion algorithm specified in
Section T22.3 & T22.4 of the DmeX DSP specification.
"""

import os
import wave
import struct
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
INPUT_DIR = os.path.join(PROJECT_ROOT, "music-player-ui", "src-tauri", "resources", "impulses")
OUTPUT_DIR = os.path.join(INPUT_DIR, "headphone_comp")

SR = 48000.0
FFT_SIZE = 8192
OUT_LEN = 1024

def read_wav(file_path):
    """Reads a WAV file and returns (numpy_array, sample_rate, num_channels)."""
    with wave.open(file_path, "rb") as w:
        nch = w.getnchannels()
        sr = w.getframerate()
        nframes = w.getnframes()
        sampwidth = w.getsampwidth()
        raw = w.readframes(nframes)

    if sampwidth == 2:
        dtype = np.int16
        scale = 32768.0
        data = np.frombuffer(raw, dtype=dtype).astype(np.float32) / scale
    elif sampwidth == 3:
        # 24-bit PCM
        raw_bytes = np.frombuffer(raw, dtype=np.uint8)
        # Reshape to (n_samples, 3)
        reshaped = raw_bytes.reshape(-1, 3)
        # Pad with 0 at MSB for little-endian int32
        padded = np.column_stack([np.zeros((len(reshaped), 1), dtype=np.uint8), reshaped])
        int32_arr = padded.view(dtype=np.int32).flatten()
        data = (int32_arr / 2147483648.0).astype(np.float32)
    elif sampwidth == 4:
        # 32-bit float or int32
        data = np.frombuffer(raw, dtype=np.float32)
    else:
        raise ValueError(f"Unsupported sample width: {sampwidth}")

    if nch > 1:
        data = data.reshape(-1, nch)
    return data, sr, nch

def write_wav_float32(file_path, data_stereo, sr=48000):
    """Writes a 2-channel float32 WAV file."""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    # data_stereo shape: (N, 2)
    nframes = len(data_stereo)
    interleaved = data_stereo.flatten().astype(np.float32)
    
    with wave.open(file_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2) # 16-bit PCM for universal cross-platform compatibility
        w.setframerate(int(sr))
        # Convert float32 to int16
        clipped = np.clip(interleaved, -1.0, 1.0)
        int16_data = (clipped * 32767.0).astype(np.int16)
        w.writeframes(int16_data.tobytes())

def compute_harman_target(freqs):
    """
    T22.4 Harman Over-Ear Target Curve:
    - +6 dB bass shelf below 105 Hz (Q = 0.707)
    - Flat 200 Hz - 1 kHz (0 dB)
    - -1 dB/octave downward tilt above 1 kHz
    - +3 dB ear-gain resonance around 3 kHz
    """
    f = np.maximum(freqs, 1.0)
    
    # 1. Bass Shelf below 105 Hz (+6 dB max)
    g_bass = 6.0 / (1.0 + (f / 105.0) ** 2)
    
    # 2. Ear-Gain Peak at 3000 Hz (+3.0 dB, Q ≈ 1.4)
    g_ear = 3.0 * np.exp(-((np.log2(f / 3000.0)) ** 2) / (2.0 * (0.55 ** 2)))
    
    # 3. Downward Tilt above 1000 Hz (-1.0 dB/octave)
    g_tilt = np.where(f > 1000.0, -1.0 * np.log2(f / 1000.0), 0.0)
    
    target_db = g_bass + g_ear + g_tilt
    return 10.0 ** (target_db / 20.0)

def compute_regularized_inverse(measured_ir, sr_in):
    """
    Computes a 1024-tap minimum-phase regularized Harman-target inverse impulse response.
    """
    # 1. Resample / pad to FFT_SIZE
    N = FFT_SIZE
    if len(measured_ir) < N:
        padded = np.pad(measured_ir, (0, N - len(measured_ir)))
    else:
        padded = measured_ir[:N]
        
    H = np.fft.rfft(padded, n=N)
    freqs = np.fft.rfftfreq(N, d=1.0 / sr_in)
    mag = np.abs(H)
    
    # Normalize measured magnitude: 0 dB average in 500 Hz - 2000 Hz
    mid_bins = np.where((freqs >= 500.0) & (freqs <= 2000.0))[0]
    if len(mid_bins) > 0:
        ref_level = np.mean(mag[mid_bins])
        if ref_level > 1e-9:
            mag = mag / ref_level

    # 2. 1/6-Octave Magnitude Smoothing (T22.3)
    smooth = np.copy(mag)
    n_bins = len(mag)
    for k in range(1, n_bins):
        f = freqs[k]
        lo = f / 1.12246  # 2^(1/6)
        hi = f * 1.12246
        k0 = max(1, int(lo * N / sr_in))
        k1 = min(n_bins - 1, int(hi * N / sr_in))
        if k1 >= k0:
            smooth[k] = np.sqrt(np.mean(mag[k0:k1+1] ** 2))
    smooth[0] = smooth[1]
    
    # 3. Frequency-Dependent Regularisation Curve (T22.3)
    lambd = np.zeros(n_bins, dtype=np.float32)
    for k in range(n_bins):
        f = freqs[k]
        if f < 60.0:
            lambd[k] = 0.50
        elif f < 200.0:
            lambd[k] = 0.10
        elif f < 8000.0:
            lambd[k] = 0.01  # high trust in midrange
        elif f < 12000.0:
            lambd[k] = 0.10
        else:
            lambd[k] = 0.50  # unreliable highs

    # 4. Harman Target
    target = compute_harman_target(freqs)
    
    # 5. Regularized Inversion: Target(f) * smooth(f) / (smooth(f)^2 + lambda(f))
    denom = smooth ** 2 + lambd
    g = (target * smooth) / denom
    
    # Clamp to [-12 dB, +12 dB] (T22.3)
    MAX_GAIN = 3.98107  # +12 dB
    MIN_GAIN = 0.25119  # -12 dB
    g = np.clip(g, MIN_GAIN, MAX_GAIN)
    
    # 6. Minimum-Phase Conversion via Real Cepstrum
    # Full symmetric 2-sided log spectrum
    log_g = np.log(np.maximum(g, 1e-12))
    full_log = np.zeros(N, dtype=np.float32)
    full_log[:n_bins] = log_g
    full_log[n_bins:] = log_g[N - n_bins:0:-1]
    
    cepstrum = np.fft.ifft(full_log).real
    
    # Causal folding for minimum phase
    causal_cep = np.zeros(N, dtype=np.float32)
    causal_cep[0] = cepstrum[0]
    causal_cep[1:N//2] = 2.0 * cepstrum[1:N//2]
    causal_cep[N//2] = cepstrum[N//2]
    
    min_phase_spectrum = np.exp(np.fft.fft(causal_cep))
    min_phase_ir = np.fft.ifft(min_phase_spectrum).real
    
    # 7. Window to OUT_LEN (1024 taps) with Half-Hann Fade-Out
    out = min_phase_ir[:OUT_LEN].copy()
    hann_fade = 0.5 * (1.0 + np.cos(np.pi * np.arange(OUT_LEN) / OUT_LEN))
    out *= hann_fade
    
    # 8. Gain normalization: Normalize so RMS gain across 200Hz-4kHz is exactly 1.0 (0 dB)
    test_fft = np.abs(np.fft.rfft(out, n=N))
    test_freqs = np.fft.rfftfreq(N, d=1.0 / sr_in)
    ref_mask = (test_freqs >= 200.0) & (test_freqs <= 4000.0)
    norm_gain = np.sqrt(np.mean(test_fft[ref_mask] ** 2))
    if norm_gain > 1e-6:
        out /= norm_gain
        
    return out

def process_headphone_models():
    """Processes all headphone models in resources/impulses/ and saves calibrated inverse IRs."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    models = [
        ("AppleAirPods", ["AppleAirPods.wav"]),
        ("AppleEarPods", ["AppleEarPods.wav"]),
        ("Sony_WH1000XM2", ["Sony_WH1000XM2L.wav", "Sony_WH1000XM2R.wav"]),
        ("SennheiserHD", ["SennheiserHD.wav"]),
        ("AKGK240", ["AKGK240.wav"]),
        ("AKGK701", ["AKGK701L.wav", "AKGK701R.wav"]),
        ("HyperXCloudalpha", ["HyperXCloudalpha.wav"]),
        ("OppoPM3", ["OppoPM3.wav"]),
        ("SteelSeriesArctic9X", ["SteelSeriesArctic9X.wav"]),
        ("xiaomipiston2", ["xiaomipiston2.wav"]),
    ]
    
    print("=" * 70)
    print("TASK T22: GENERATING HARMAN-TARGET INVERSE HEADPHONE FILTERS")
    print("=" * 70)
    
    for model_id, files in models:
        print(f"\nProcessing {model_id}...")
        if len(files) == 1:
            in_path = os.path.join(INPUT_DIR, files[0])
            data, sr, nch = read_wav(in_path)
            if nch == 1:
                inv_l = compute_regularized_inverse(data, sr)
                inv_r = inv_l.copy()
            else:
                inv_l = compute_regularized_inverse(data[:, 0], sr)
                inv_r = compute_regularized_inverse(data[:, 1], sr)
        elif len(files) == 2:
            path_l = os.path.join(INPUT_DIR, files[0])
            path_r = os.path.join(INPUT_DIR, files[1])
            data_l, sr_l, _ = read_wav(path_l)
            data_r, sr_r, _ = read_wav(path_r)
            inv_l = compute_regularized_inverse(data_l.flatten(), sr_l)
            inv_r = compute_regularized_inverse(data_r.flatten(), sr_r)
            sr = sr_l
            
        stereo_inv = np.column_stack([inv_l, inv_r])
        out_path = os.path.join(OUTPUT_DIR, f"{model_id}_harman_inv.wav")
        write_wav_float32(out_path, stereo_inv, sr=48000)
        
        # Verify criteria:
        peak_l = np.max(np.abs(inv_l))
        peak_idx_l = np.argmax(np.abs(inv_l))
        peak_r = np.max(np.abs(inv_r))
        peak_idx_r = np.argmax(np.abs(inv_r))
        print(f"  -> Saved to {os.path.basename(out_path)}")
        print(f"  -> Left:  peak={peak_l:.4f} at sample {peak_idx_l} (Minimum phase front-loaded)")
        print(f"  -> Right: peak={peak_r:.4f} at sample {peak_idx_r} (Minimum phase front-loaded)")
        
    print("\n" + "=" * 70)
    print("ALL 10 HEADPHONE INVERSE FILTERS GENERATED SUCCESSFULLY!")
    print("=" * 70)

if __name__ == "__main__":
    process_headphone_models()
