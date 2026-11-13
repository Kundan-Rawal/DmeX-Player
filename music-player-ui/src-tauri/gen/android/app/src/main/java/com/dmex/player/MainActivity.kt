package com.dmex.player

import android.os.Bundle
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.graphics.Color
import androidx.core.view.WindowCompat
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.view.View
import android.view.ViewGroup
import android.view.KeyEvent
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (PlaybackService.instance?.handleMediaKey(event) == true) return true
        return super.dispatchKeyEvent(event)
    }

    private fun webViewIn(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                webViewIn(view.getChildAt(index))?.let { return it }
            }
        }
        return null
    }

    private fun publishMobileInsets(insets: WindowInsetsCompat) {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val density = resources.displayMetrics.density
        val values = listOf("top" to bars.top, "right" to bars.right, "bottom" to bars.bottom, "left" to bars.left)
        val script = values.joinToString(";") { (edge, value) ->
            "document.documentElement.style.setProperty('--dmex-inset-$edge','${value / density}px')"
        }
        webViewIn(window.decorView)?.evaluateJavascript(script, null)
    }

    // Link to our low-level Rust function
    external fun onAudioBecomingNoisy()

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY == intent.action) {
                onAudioBecomingNoisy() // Instantly kills C++ engine
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = AudioManager.STREAM_MUSIC
        
        // --- PHASE 2: Register Headphone Disconnect Listener ---
        registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))

        // --- PHASE 1: UI & Permissions ---
        // 1. Tell Android to let the React app draw completely edge-to-edge
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // 2. Force the app to draw INTO the camera notch/cutout
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        // 3. Keep the system bars ON screen, but make their backgrounds 100% transparent
        // This allows your React dark mode (or expanded player gradient) to show through!
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
            publishMobileInsets(insets)
            insets
        }
        window.decorView.postDelayed({
            ViewCompat.getRootWindowInsets(window.decorView)?.let { publishMobileInsets(it) }
        }, 1800)

        // 4. Delay permissions so React can boot
        Handler(Looper.getMainLooper()).postDelayed({
            val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                arrayOf(Manifest.permission.READ_MEDIA_AUDIO)
            } else {
                arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
            }

            if (ContextCompat.checkSelfPermission(this@MainActivity, permissions[0]) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this@MainActivity, permissions, 1)
            }
        }, 1500)
    }

    override fun onDestroy() {
        super.onDestroy()
        // Clean up the listener when the app is completely killed
        unregisterReceiver(noisyReceiver)
    }
}
