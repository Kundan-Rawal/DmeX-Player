package com.dmex.player

import android.app.Activity
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.annotation.Keep
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@Keep
object NativeMediaBridge {
    external fun transport(action: Int, position: Long)
    external fun flags(): Int
    fun stateFlags(): Int = try { flags() } catch (_: UnsatisfiedLinkError) { 0 }
    fun send(action: Int, position: Long = 0) { try { transport(action, position) } catch (_: UnsatisfiedLinkError) { /* Open the app before restoring an expired session. */ } }
}

@TauriPlugin
class MediaPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun update(invoke: Invoke) {
        // Jackson does not populate JSONObject's internal map when used as an InvokeArg field.
        val state = invoke.getArgs().getJSONObject("state")
        activity.runOnUiThread {
            try {
                if (state.optBoolean("hasTrack") || PlaybackService.instance != null) {
                    val intent = Intent(activity, PlaybackService::class.java).putExtra("state", state.toString())
                    if (state.optBoolean("playing")) ContextCompat.startForegroundService(activity, intent)
                    else activity.startService(intent)
                }
                invoke.resolve(JSObject())
            } catch (error: Exception) { invoke.reject(error.message ?: "Media session unavailable") }
        }
    }
}
