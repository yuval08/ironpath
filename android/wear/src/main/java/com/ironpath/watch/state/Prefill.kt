package com.ironpath.watch.state

/** Pre-fill rules from UI spec §5.1. The values shown are exactly what Done set logs. */
object Prefill {
    private val leadingInt = Regex("\\d+")

    /** First integer of a target such as "8-12" or "8 per side"; null when there is none. */
    fun targetReps(target: String): Double? = leadingInt.find(target)?.value?.toDoubleOrNull()

    /** Latest completed set of the same prescription that precedes [step] in snapshot order. */
    private fun previous(step: Step, steps: List<Step>): Step? =
        steps.takeWhile { it.setId != step.setId }.lastOrNull { it.prescriptionId == step.prescriptionId && it.completed }

    fun value(field: Field, step: Step, steps: List<Step>): Double? {
        step.actual[field]?.let { return it }
        val previous = previous(step, steps)
        return when (field) {
            Field.Weight -> previous?.actual?.weight ?: step.recommendedWeight
            else -> targetReps(step.target) ?: previous?.actual?.get(field)
        }
    }

    fun values(step: Step, steps: List<Step>): Map<Field, Double?> = step.fields.associateWith { value(it, step, steps) }
}
