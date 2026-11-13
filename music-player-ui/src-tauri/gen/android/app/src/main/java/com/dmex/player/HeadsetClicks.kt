package com.dmex.player

// Device repeat events are filtered before entering this bounded click counter.
class HeadsetClicks {
    private var count = 0
    fun add(): Int { count = (count + 1).coerceAtMost(3); return count }
    fun takeAction(): Int {
        val action = when (count) { 2 -> 3; 3 -> 4; else -> 0 }
        count = 0
        return action
    }
    fun clear() { count = 0 }
}
