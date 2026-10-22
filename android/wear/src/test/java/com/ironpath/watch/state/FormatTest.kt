package com.ironpath.watch.state

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {
    @Test fun numbers() {
        assertEquals("62.5", Format.number(62.5))
        assertEquals("60", Format.number(60.0))
        assertEquals("–", Format.number(null))
        assertEquals("0.3", Format.number(0.1 + 0.2))
    }

    @Test fun clockRoundsUp() {
        assertEquals("1:24", Format.clock(83_001))
        assertEquals("0:00", Format.clock(0))
        assertEquals("0:01", Format.clock(1))
    }

    @Test fun ambientMinutes() {
        assertEquals("< 1 min", Format.ambientMinutes(59_000))
        assertEquals("2 min", Format.ambientMinutes(60_001))
        assertEquals("1 min", Format.ambientMinutes(60_000))
    }

    @Test fun restDescription() {
        assertEquals("Rest, 1 minute 24 seconds left", Format.restDescription(84_000))
        assertEquals("Rest, 2 minutes left", Format.restDescription(120_000))
        assertEquals("Rest, 10 seconds left", Format.restDescription(10_000))
    }

    @Test fun conflictSummary() {
        assertEquals("Also: completed ✓ · weight 62.5", Format.alsoChanged(listOf(
            ConflictField("completed", false, true, conflict = false), ConflictField("weight", 60, 62.5, conflict = false))))
        assertEquals(null, Format.alsoChanged(emptyList()))
        assertEquals("✓", Format.conflictValue(true))
    }

    @Test fun targets() {
        assertEquals("8–12 reps", Format.target("8-12"))
        assertEquals("45 s each side", Format.target("45 s each side"))
    }

    @Test fun setSummary() {
        val s = step("b", load = "barbell")
        assertEquals("8 × 62.5 kg", Format.setSummary(s, mapOf(Field.Reps to 8.0, Field.Weight to 62.5)))
        assertEquals("8 × 62.5", Format.setSummary(s, mapOf(Field.Reps to 8.0, Field.Weight to 62.5), withUnit = false))
        val side = step("l", style = "repsPerSide", load = "none")
        assertEquals("8 / 7", Format.setSummary(side, mapOf(Field.RepsLeft to 8.0, Field.RepsRight to 7.0)))
    }
}
