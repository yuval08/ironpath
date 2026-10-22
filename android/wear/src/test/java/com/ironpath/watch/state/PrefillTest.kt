package com.ironpath.watch.state

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PrefillTest {
    @Test fun actualValuesWinFirst() {
        val s = step("b2", reps = 6.0, weight = 70.0)
        assertEquals(mapOf(Field.Reps to 6.0, Field.Weight to 70.0), Prefill.values(s, listOf(s)))
    }

    @Test fun repsUseTargetLowerBoundBeforePreviousSet() {
        val previous = step("b1", completed = true, reps = 9.0, weight = 62.5)
        val current = step("b2")
        val values = Prefill.values(current, listOf(previous, current))
        assertEquals(8.0, values[Field.Reps])
        assertEquals(62.5, values[Field.Weight]) // previous completed set beats recommendedWeight
    }

    @Test fun repsFallBackToPreviousSetWhenTargetHasNoNumber() {
        val previous = step("b1", completed = true, reps = 9.0, target = "AMRAP")
        val current = step("b2", target = "AMRAP")
        assertEquals(9.0, Prefill.value(Field.Reps, current, listOf(previous, current)))
    }

    @Test fun onlyEarlierSetsOfTheSamePrescriptionCount() {
        val other = step("r1", prescription = "row", completed = true, weight = 40.0)
        val later = step("b3", completed = true, weight = 80.0)
        val current = step("b2")
        assertEquals(60.0, Prefill.value(Field.Weight, current, listOf(other, current, later)))
    }

    @Test fun emptyWhenNothingKnown() {
        val s = step("x", target = "", recommended = null)
        assertNull(Prefill.value(Field.Reps, s, listOf(s)))
        assertNull(Prefill.value(Field.Weight, s, listOf(s)))
    }

    @Test fun perSideFieldsAndNoWeightForBodyweight() {
        val s = step("l1", style = "repsPerSide", load = "bodyweight", target = "8 per side")
        assertEquals(mapOf(Field.RepsLeft to 8.0, Field.RepsRight to 8.0), Prefill.values(s, listOf(s)))
    }

    @Test fun targetParsing() {
        assertEquals(8.0, Prefill.targetReps("8-12")!!, 0.0)
        assertEquals(12.0, Prefill.targetReps("12 per side")!!, 0.0)
        assertNull(Prefill.targetReps("to failure"))
    }
}
