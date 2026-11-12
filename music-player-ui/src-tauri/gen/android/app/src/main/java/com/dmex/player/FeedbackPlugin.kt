package com.dmex.player

import android.app.Activity
import android.os.Build
import android.view.HapticFeedbackConstants
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class FeedbackArgs { var kind: String = "tap" }

@TauriPlugin
class FeedbackPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun perform(invoke: Invoke) {
        val args = invoke.parseArgs(FeedbackArgs::class.java)
        activity.runOnUiThread {
            val effect = when (args.kind) {
                "longPress" -> HapticFeedbackConstants.LONG_PRESS
                "dragStart" -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.DRAG_START else HapticFeedbackConstants.LONG_PRESS
                "dragTick", "selection" -> if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
                "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
                "reject" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
                else -> HapticFeedbackConstants.VIRTUAL_KEY
            }
            val performed = activity.window.decorView.performHapticFeedback(effect)
            invoke.resolve(JSObject().put("performed", performed))
        }
    }
}
