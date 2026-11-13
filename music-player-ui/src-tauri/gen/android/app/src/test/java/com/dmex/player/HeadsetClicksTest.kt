package com.dmex.player

import org.junit.Assert.assertEquals
import org.junit.Test

class HeadsetClicksTest {
    @Test fun singleToggles() { val clicks = HeadsetClicks(); clicks.add(); assertEquals(0, clicks.takeAction()) }
    @Test fun doubleSkipsNext() { val clicks = HeadsetClicks(); repeat(2) { clicks.add() }; assertEquals(3, clicks.takeAction()) }
    @Test fun tripleSkipsPrevious() { val clicks = HeadsetClicks(); repeat(3) { clicks.add() }; assertEquals(4, clicks.takeAction()) }
    @Test fun consumptionResets() { val clicks = HeadsetClicks(); repeat(2) { clicks.add() }; clicks.takeAction(); clicks.add(); assertEquals(0, clicks.takeAction()) }
    @Test fun cancellationResets() { val clicks = HeadsetClicks(); repeat(2) { clicks.add() }; clicks.clear(); clicks.add(); assertEquals(0, clicks.takeAction()) }
}
