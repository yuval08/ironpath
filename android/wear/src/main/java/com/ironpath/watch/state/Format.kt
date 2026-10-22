package com.ironpath.watch.state

import kotlin.math.abs
import kotlin.math.roundToLong

/** Display formatting shared by every screen. */
object Format {
    /** "62.5", "60", "–" for empty. Never shows float noise. */
    fun number(value: Double?): String {
        if (value == null) return "–"
        val rounded = (value * 100).roundToLong() / 100.0
        return if (abs(rounded - rounded.toLong()) < 1e-9) rounded.toLong().toString() else rounded.toString()
    }

    /** Countdown text "1:24" from milliseconds, rounded up so 0:00 only shows at the deadline. */
    fun clock(ms: Long): String {
        val seconds = (ms + 999) / 1000
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }

    /** Ambient rest text: whole minutes rounded up, or "< 1 min" in the final minute (§5.6). */
    fun ambientMinutes(ms: Long): String = if (ms < 60_000) "< 1 min" else "${(ms + 59_999) / 60_000} min"

    /** "Rest, 1 minute 24 seconds left" for TalkBack. */
    fun restDescription(ms: Long): String {
        val seconds = (ms + 999) / 1000
        val m = seconds / 60
        val s = seconds % 60
        val parts = listOfNotNull(
            if (m > 0) "$m minute${if (m == 1L) "" else "s"}" else null,
            if (s > 0 || m == 0L) "$s second${if (s == 1L) "" else "s"}" else null,
        )
        return "Rest, ${parts.joinToString(" ")} left"
    }

    /** Elapsed workout duration "34 min" (prefixed "~" when the delta is uncertain). */
    fun minutes(seconds: Double, uncertain: Boolean = false): String =
        "${if (uncertain) "~" else ""}${(seconds / 60).toLong()} min"

    /** "8 × 62.5 kg", "8 / 8", "8" depending on the step's fields. */
    fun setSummary(step: Step, values: Map<Field, Double?>, withUnit: Boolean = true): String {
        val reps = if (step.perSide) "${number(values[Field.RepsLeft])} / ${number(values[Field.RepsRight])}"
            else number(values[Field.Reps])
        val weight = values[Field.Weight]
        if (!step.hasWeight || weight == null) return reps
        return "$reps × ${number(weight)}" + if (withUnit) " ${step.unit}" else ""
    }

    /** "8–12 reps" for numeric targets; other targets ("45 s each side") are shown as sent. */
    fun target(target: String): String {
        val text = target.replace('-', '–')
        return if (text.isNotEmpty() && text.last().isDigit()) "$text reps" else text
    }

    fun conflictValue(value: Any?): String = when (value) {
        null -> "–"
        is Boolean -> if (value) "✓" else "✗"
        is Number -> number(value.toDouble())
        else -> value.toString()
    }

    /** "Also: completed ✓ · weight 62.5" for the watch-side values of non-conflicting changes. */
    fun alsoChanged(fields: List<ConflictField>): String? {
        if (fields.isEmpty()) return null
        return "Also: " + fields.joinToString(" · ") { f ->
            val value = f.watch
            if (value is Boolean) "${fieldLabel(f.field).lowercase()} ${if (value) "✓" else "✗"}"
            else "${fieldLabel(f.field).lowercase()} ${conflictValue(value)}"
        }
    }

    fun fieldLabel(field: String): String = when (field) {
        "reps" -> "Reps"
        "repsLeft" -> "Left reps"
        "repsRight" -> "Right reps"
        "weight" -> "Weight"
        "completed" -> "Completed"
        "rpe" -> "RPE"
        "rir" -> "RIR"
        else -> field
    }
}
