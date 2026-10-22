package com.ironpath.watch.state

import com.ironpath.wearlink.EditorRebase
import com.ironpath.wearlink.MutationRules
import org.json.JSONObject

/**
 * Open set editor. Wraps the wear-link [EditorRebase] JSON `{base, draft, touched, stale}`.
 * Only values the user set in S3 are "touched"; untouched tiles show the live pre-fill (§5.1),
 * so remote edits rebase them silently.
 */
data class Editor(val setId: String, val json: String) {
    private val obj get() = JSONObject(json)

    val touched: Set<Field> by lazy {
        val array = obj.getJSONArray("touched")
        (0 until array.length()).mapNotNull { Field.of(array.getString(it)) }.toSet()
    }
    private val draft: Map<Field, Double?> by lazy { numbers(obj.getJSONObject("draft")) }
    private val base: Map<Field, Double?> by lazy { numbers(obj.getJSONObject("base")) }

    /** Touched fields the phone changed meanwhile, with the phone's latest value. */
    val stale: Map<Field, Double?> by lazy {
        val array = obj.optJSONArray("stale") ?: return@lazy emptyMap()
        (0 until array.length()).map { array.getJSONObject(it) }
            .mapNotNull { e -> Field.of(e.getString("field"))?.let { it to e.numberOrNull("latest") } }.toMap()
    }

    fun value(field: Field, prefill: Map<Field, Double?>): Double? = if (field in touched) draft[field] else prefill[field]
    fun values(step: Step, prefill: Map<Field, Double?>) = step.fields.associateWith { value(it, prefill) }

    /** True when any shown value differs from the stored set (enables "Update set"). */
    fun dirty(step: Step, prefill: Map<Field, Double?>) = step.fields.any { !same(value(it, prefill), base[it]) }

    fun edit(field: Field, value: Double?) = copy(json = EditorRebase.edit(obj, field.key, value).toString())
    fun rebase(actual: SetValues) = copy(json = EditorRebase.rebase(obj, actual.toJson()).toString())
    /** The user explicitly keeps their value over the phone's change ("Set" in S3). */
    fun accept(field: Field) = copy(json = EditorRebase.accept(obj, field.key).toString())

    /**
     * `expected`/`changes` for logSet (complete) or updateSet. Untouched fields whose pre-fill
     * differs from the stored value are marked touched first, so what is shown is what is logged.
     */
    fun submission(step: Step, prefill: Map<Field, Double?>, complete: Boolean): Pair<JSONObject, JSONObject> {
        var editor = obj
        for (field in step.fields) if (field !in touched && !same(prefill[field], base[field]))
            editor = EditorRebase.edit(editor, field.key, prefill[field])
        return EditorRebase.expected(editor, complete) to EditorRebase.changes(editor, complete)
    }

    companion object {
        fun open(step: Step) = Editor(step.setId, EditorRebase.open(step.actual.toJson()).toString())
        private fun same(a: Double?, b: Double?) = MutationRules.same(a, b)
        private fun numbers(json: JSONObject) = Field.entries.associateWith { json.numberOrNull(it.key) }
    }
}

internal fun JSONObject.numberOrNull(key: String): Double? =
    if (!has(key) || isNull(key)) null else (opt(key) as? Number)?.toDouble()

fun SetValues.toJson(): JSONObject = JSONObject().put("completed", completed)
    .put("reps", reps ?: JSONObject.NULL).put("repsLeft", repsLeft ?: JSONObject.NULL)
    .put("repsRight", repsRight ?: JSONObject.NULL).put("weight", weight ?: JSONObject.NULL)
