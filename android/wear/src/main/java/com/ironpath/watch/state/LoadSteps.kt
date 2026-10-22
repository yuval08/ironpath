package com.ironpath.watch.state

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToLong

/** Rotary step table from UI spec §5.2, with off-grid preservation. */
object LoadSteps {
    const val MAX_REPS = 100

    fun weightStep(loadType: String, unit: String): Double {
        val lb = unit == "lb"
        return when (loadType) {
            "dumbbell" -> if (lb) 2.0 else 1.0
            "kettlebell" -> if (lb) 5.0 else 2.0
            else -> if (lb) 5.0 else 2.5 // barbell, machine
        }
    }

    /** 0 … max(2 × prefilled, 200 kg / 450 lb) on the step grid, plus [current] if it is off-grid. */
    fun weightOptions(loadType: String, unit: String, current: Double?): List<Double> {
        val step = weightStep(loadType, unit)
        val ceiling = maxOf(2 * (current ?: 0.0), if (unit == "lb") 450.0 else 200.0)
        val count = ceil(ceiling / step).toInt()
        return withValue((0..count).map { round(it * step) }, current)
    }

    fun repsOptions(current: Double?): List<Double> =
        withValue((0..maxOf(MAX_REPS, ceil(current ?: 0.0).toInt())).map { it.toDouble() }, current)

    fun options(field: Field, step: Step, current: Double?): List<Double> =
        if (field == Field.Weight) weightOptions(step.loadType, step.unit, current) else repsOptions(current)

    /** Index of [value] in [options]; empty values start at 0 (§5.2: the picker starts at 0). */
    fun indexOf(options: List<Double>, value: Double?): Int =
        if (value == null) 0 else options.indexOfFirst { same(it, value) }.coerceAtLeast(0)

    private fun withValue(grid: List<Double>, value: Double?): List<Double> {
        if (value == null || value < 0 || grid.any { same(it, value) }) return grid
        return (grid + value).sorted()
    }

    private fun same(a: Double, b: Double) = abs(a - b) < 1e-6
    private fun round(v: Double) = (v * 1000).roundToLong() / 1000.0
}
