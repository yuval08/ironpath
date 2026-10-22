package com.ironpath.watch.state

/** Minimal step builder for pure-logic tests. */
fun step(
    id: String, prescription: String = "bench", completed: Boolean = false, reps: Double? = null, weight: Double? = null,
    target: String = "8-10", load: String = "barbell", style: String = "reps", unit: String = "kg", recommended: Double? = 60.0,
    warmUp: Boolean = false, supported: Boolean = true, left: Double? = null, right: Double? = null,
) = Step(
    setId = id, prescriptionId = prescription, exerciseId = prescription, name = prescription, setNumber = 1, workingNumber = 1,
    workingTotal = 4, isWarmUp = warmUp, rampNumber = if (warmUp) 1 else 0, entryStyle = style, loadType = load, unit = unit,
    target = target, recommendedWeight = recommended, bandLabel = null, restAfter = 90, supported = supported, slot = null,
    group = 0, review = false, pending = false,
    actual = SetValues(completed = completed, reps = reps, repsLeft = left, repsRight = right, weight = weight),
)
