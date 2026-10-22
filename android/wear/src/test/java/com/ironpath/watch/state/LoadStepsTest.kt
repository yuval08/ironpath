package com.ironpath.watch.state

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LoadStepsTest {
    @Test fun stepTable() {
        assertEquals(2.5, LoadSteps.weightStep("barbell", "kg"), 0.0)
        assertEquals(5.0, LoadSteps.weightStep("barbell", "lb"), 0.0)
        assertEquals(1.0, LoadSteps.weightStep("dumbbell", "kg"), 0.0)
        assertEquals(2.0, LoadSteps.weightStep("dumbbell", "lb"), 0.0)
        assertEquals(2.0, LoadSteps.weightStep("kettlebell", "kg"), 0.0)
        assertEquals(5.0, LoadSteps.weightStep("kettlebell", "lb"), 0.0)
        assertEquals(2.5, LoadSteps.weightStep("machine", "kg"), 0.0)
        assertEquals(5.0, LoadSteps.weightStep("machine", "lb"), 0.0)
    }

    @Test fun weightRangeIsAtLeastTwoHundredKgOrTwiceTheValue() {
        val kg = LoadSteps.weightOptions("barbell", "kg", 60.0)
        assertEquals(0.0, kg.first(), 0.0); assertEquals(200.0, kg.last(), 0.0); assertEquals(81, kg.size)
        assertEquals(300.0, LoadSteps.weightOptions("barbell", "kg", 150.0).last(), 0.0)
        assertEquals(450.0, LoadSteps.weightOptions("machine", "lb", null).last(), 0.0)
    }

    @Test fun offGridValueIsInsertedSortedAndSelected() {
        val options = LoadSteps.weightOptions("barbell", "kg", 61.3)
        val index = LoadSteps.indexOf(options, 61.3)
        assertEquals(61.3, options[index], 0.0)
        assertEquals(60.0, options[index - 1], 0.0)
        assertEquals(62.5, options[index + 1], 0.0)
        assertEquals(82, options.size)
    }

    @Test fun onGridValueIsNotDuplicated() {
        val options = LoadSteps.weightOptions("barbell", "kg", 62.5)
        assertEquals(1, options.count { it == 62.5 })
    }

    @Test fun repsStartAtZeroForEmptyAndExtendPastHundred() {
        val reps = LoadSteps.repsOptions(null)
        assertEquals(101, reps.size)
        assertEquals(0, LoadSteps.indexOf(reps, null))
        assertTrue(LoadSteps.repsOptions(120.0).contains(120.0))
        assertEquals(8, LoadSteps.indexOf(reps, 8.0))
    }
}
