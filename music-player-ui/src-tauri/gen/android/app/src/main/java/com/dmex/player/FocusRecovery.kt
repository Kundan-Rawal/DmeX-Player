package com.dmex.player

class FocusRecovery {
    var suspended = false
        private set
    private var resume = false
    fun loss(transient: Boolean, playing: Boolean) {
        resume = transient && (playing || resume)
        suspended = transient
    }
    fun gain(): Boolean { val shouldResume = resume; resume = false; suspended = false; return shouldResume }
    fun cancel() { resume = false; suspended = false }
}
