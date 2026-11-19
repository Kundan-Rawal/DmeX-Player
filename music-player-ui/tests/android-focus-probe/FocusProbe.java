package com.dmex.focusprobe;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

// Test-only silent focus owner. Never bundled with DmeX; uninstalled by the device test.
public final class FocusProbe extends Activity {
    private AudioManager audio;
    private AudioFocusRequest request;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        audio = getSystemService(AudioManager.class);
        int gain = getIntent().getBooleanExtra("permanent", false)
            ? AudioManager.AUDIOFOCUS_GAIN : AudioManager.AUDIOFOCUS_GAIN_TRANSIENT;
        request = new AudioFocusRequest.Builder(gain)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setOnAudioFocusChangeListener(change -> {}).build();
        int result = audio.requestAudioFocus(request);
        Log.i("DmeXFocusProbe", "request=" + result + " gain=" + gain);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            audio.abandonAudioFocusRequest(request);
            Log.i("DmeXFocusProbe", "released");
            finish();
        }, getIntent().getIntExtra("duration", 2500));
    }
    @Override public void onDestroy() {
        if (audio != null && request != null) audio.abandonAudioFocusRequest(request);
        super.onDestroy();
    }
}
