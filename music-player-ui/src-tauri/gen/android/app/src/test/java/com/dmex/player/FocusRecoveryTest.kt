package com.dmex.player
import org.junit.Assert.*
import org.junit.Test

class FocusRecoveryTest {
    @Test fun resumesOnlyInterruptedPlayback() { val focus = FocusRecovery(); focus.loss(true, true); assertTrue(focus.suspended); assertTrue(focus.gain()); assertFalse(focus.gain()) }
    @Test fun pausedMusicStaysPaused() { val focus = FocusRecovery(); focus.loss(true, false); assertFalse(focus.gain()) }
    @Test fun explicitPauseCancelsResume() { val focus = FocusRecovery(); focus.loss(true, true); focus.cancel(); assertFalse(focus.gain()) }
    @Test fun permanentLossCancelsResume() { val focus = FocusRecovery(); focus.loss(true, true); focus.loss(false, false); assertFalse(focus.gain()) }
    @Test fun repeatedTransientLossRetainsIntent() { val focus = FocusRecovery(); focus.loss(true, true); focus.loss(true, false); assertTrue(focus.gain()) }
}
