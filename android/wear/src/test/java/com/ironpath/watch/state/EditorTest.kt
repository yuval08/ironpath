package com.ironpath.watch.state

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EditorTest {
    private val current = step("b2", weight = 60.0)
    private val prefill = mapOf(Field.Reps to 8.0, Field.Weight to 60.0)

    @Test fun acceptedTargetLogsPrefillAndCompletion() {
        val (expected, changes) = Editor.open(current).submission(current, prefill, complete = true)
        assertEquals(true, changes.getBoolean("completed")); assertEquals(false, expected.getBoolean("completed"))
        assertEquals(8.0, changes.getDouble("reps"), 0.0); assertTrue(expected.isNull("reps"))
        assertFalse(changes.has("weight")) // unchanged values are not sent
        assertEquals(changes.keys().asSequence().toSet(), expected.keys().asSequence().toSet())
    }

    @Test fun userValueWinsOverPrefill() {
        val editor = Editor.open(current).edit(Field.Weight, 62.5)
        assertEquals(62.5, editor.value(Field.Weight, prefill)!!, 0.0)
        assertEquals(8.0, editor.value(Field.Reps, prefill)!!, 0.0)
        val (expected, changes) = editor.submission(current, prefill, complete = true)
        assertEquals(62.5, changes.getDouble("weight"), 0.0); assertEquals(60.0, expected.getDouble("weight"), 0.0)
    }

    @Test fun remoteChangeToTouchedFieldIsStaleUntilAccepted() {
        val editor = Editor.open(current).edit(Field.Weight, 62.5).rebase(current.actual.copy(weight = 65.0, reps = 9.0))
        assertEquals(mapOf(Field.Weight to 65.0), editor.stale)
        assertEquals(62.5, editor.value(Field.Weight, prefill)!!, 0.0)
        val accepted = editor.accept(Field.Weight)
        assertTrue(accepted.stale.isEmpty())
        val (expected, _) = accepted.submission(current, prefill, complete = true)
        assertEquals(65.0, expected.getDouble("weight"), 0.0) // conditional on the phone's latest value
    }

    @Test fun dirtyOnlyWhenAValueChanges() {
        val logged = step("b1", completed = true, reps = 8.0, weight = 60.0)
        val values = mapOf(Field.Reps to 8.0, Field.Weight to 60.0)
        assertFalse(Editor.open(logged).dirty(logged, values))
        assertTrue(Editor.open(logged).edit(Field.Reps, 9.0).dirty(logged, values))
    }
}
