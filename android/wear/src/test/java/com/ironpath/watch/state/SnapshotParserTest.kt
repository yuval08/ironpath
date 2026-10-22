package com.ironpath.watch.state

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SnapshotParserTest {
    private fun stepJson(id: String, completed: Boolean = false, warmUp: Boolean = false) = JSONObject()
        .put("setId", id).put("prescriptionId", "bench").put("exerciseId", "bench").put("name", "Bench").put("setNumber", 1)
        .put("workingNumber", 2).put("workingTotal", 4).put("isWarmUp", warmUp).put("entryStyle", "reps").put("loadType", "barbell")
        .put("unit", "kg").put("target", "8-10").put("recommendedWeight", 60).put("band", JSONObject.NULL).put("restAfter", 90)
        .put("supported", true).put("slot", "A1").put("group", 0).put("bandLabel", JSONObject.NULL).put("review", false)
        .put("actual", JSONObject().put("completed", completed).put("reps", if (completed) 8 else JSONObject.NULL).put("weight", 60.0))

    private fun v2(phase: String, sync: String = "synced") = JSONObject().put("phase", phase).put("mode", "shared").put("syncState", sync)
        .put("sync", JSONObject().put("pendingMutations", 2).put("receivedMutations", 1).put("pendingRestOps", 0).put("reviewCount", 0)
            .put("phoneReachable", true).put("lastSyncedWall", 1729600000000))
        .put("peer", JSONObject().put("protocol", 2).put("phoneVersion", "1.0.6").put("watchVersion", "0.5.0").put("updatePairKey", JSONObject.NULL))
        .put("workout", JSONObject().put("epoch", "e").put("sessionId", "s").put("title", "Upper").put("revision", 41)
            .put("elapsedSeconds", 120.0).put("elapsedRunning", true).put("elapsedReceivedElapsed", 1000)
            .put("steps", JSONArray().put(stepJson("w1", warmUp = true)).put(stepJson("b1", true)).put(stepJson("b2"))))
        .put("conflicts", JSONArray())

    @Test fun everyPhaseMaps() {
        val expected = mapOf("idle" to Phase.Idle, "active" to Phase.Active, "resting" to Phase.Active, "finishing" to Phase.Finishing,
            "phoneControl" to Phase.PhoneControl, "closed" to Phase.Closed, "updateNeeded" to Phase.UpdateNeeded)
        expected.forEach { (wire, phase) -> assertEquals(wire, phase, SnapshotParser.parse(v2(wire)).phase) }
    }

    @Test fun everySyncStateMaps() {
        val expected = mapOf("synced" to SyncState.Synced, "savedOnWatch" to SyncState.SavedOnWatch,
            "waitingForPhone" to SyncState.WaitingForPhone, "needsReview" to SyncState.NeedsReview, "updateNeeded" to SyncState.UpdateNeeded)
        expected.forEach { (wire, state) -> assertEquals(wire, state, SnapshotParser.parse(v2("active", wire)).syncState) }
    }

    @Test fun stepsCountsAndRampNumbers() {
        val s = SnapshotParser.parse(v2("active"))
        assertEquals(3, s.steps.size)
        assertEquals("Ramp 1", s.steps[0].position)
        assertEquals("Set 2 of 4", s.steps[2].position)
        assertEquals("A1", s.steps[2].slot)
        assertEquals(60.0, s.steps[2].actual.weight!!, 0.0)
        assertNull(s.steps[2].actual.reps)
        assertEquals(2, s.sync.pendingMutations)
        assertEquals(1729600000000, s.sync.lastSyncedWall)
        assertEquals(2, s.peer.protocol)
    }

    @Test fun restConflictsUndoFreezeAndClosed() {
        val json = v2("resting")
            .put("rest", JSONObject().put("timerId", "t").put("localRev", 3).put("revision", 12).put("state", "running")
                .put("endsElapsed", 5000).put("remainingMs", 4000).put("durationMs", 90000).put("origin", "phone")
                .put("next", JSONObject().put("title", "A1 · Bench").put("text", "Set 2 of 4"))
                .put("alert", JSONObject().put("destination", "watch").put("armed", true).put("reason", "ok")))
            .put("undo", JSONObject().put("opId", "o").put("setId", "b1").put("label", "Undo set 1"))
            .put("conflicts", JSONArray().put(JSONObject().put("id", "c").put("setId", "b2").put("exerciseName", "Bench")
                .put("position", "Set 2").put("origin", "watch").put("code", "fieldConflict").put("reason", "")
                .put("fields", JSONArray().put(JSONObject().put("field", "reps").put("phone", 8).put("watch", 10)))
                .put("queuedResolution", JSONObject.NULL)))
            .put("freeze", JSONObject().put("id", "f").put("reason", "finish").put("sinceWall", 1))
            .put("closed", JSONObject().put("sessionId", "s").put("reason", "completed")
                .put("summary", JSONObject().put("done", 18).put("total", 20).put("elapsedSeconds", 3120)).put("unsynced", 2))
        val s = SnapshotParser.parse(json)
        val rest = s.runningRest!!
        assertEquals("t", rest.timerId); assertEquals(3L, rest.localRev); assertEquals(12L, rest.revision)
        assertEquals(1000L, rest.remainingAt(4000)); assertEquals(0L, rest.remainingAt(9000))
        assertEquals("watch", rest.alert!!.destination)
        assertEquals("Undo set 1", s.undo!!.label)
        assertTrue(s.canUndo)
        val conflict = s.conflicts.single()
        assertEquals(8, conflict.fields.single().phone); assertEquals(10, conflict.fields.single().watch)
        assertNull(conflict.queuedResolution)
        assertEquals("finish", s.freeze!!.reason)
        assertEquals(2, s.closed!!.unsynced); assertEquals(18, s.closed!!.done)
    }

    @Test fun conflictFieldsSplitByFlag() {
        val json = v2("active").put("conflicts", JSONArray().put(JSONObject().put("id", "c").put("setId", "b2")
            .put("fields", JSONArray()
                .put(JSONObject().put("field", "completed").put("phone", false).put("watch", true).put("conflict", false))
                .put(JSONObject().put("field", "reps").put("phone", 8).put("watch", 10).put("conflict", true)))))
        val conflict = SnapshotParser.parse(json).conflicts.single()
        assertEquals(listOf("reps"), conflict.conflicting.map { it.field })
        assertEquals(listOf("completed"), conflict.alsoChanged.map { it.field })
        assertEquals(true, conflict.alsoChanged.single().watch)
    }

    @Test fun missingOptionalKeysDefault() {
        val s = SnapshotParser.parse(JSONObject().put("phase", "idle"))
        assertEquals(Phase.Idle, s.phase)
        assertEquals(SyncState.Synced, s.syncState)
        assertNull(s.workout); assertNull(s.rest); assertNull(s.next)
        assertTrue(s.conflicts.isEmpty())
        assertTrue(s.alerts.notifications)
        assertFalse(s.canUndo)
    }

    @Test fun legacyV1InspectStillRenders() {
        val v1 = JSONObject()
            .put("snapshot", JSONObject().put("epoch", "e").put("sessionId", "s").put("title", "Upper").put("revision", 3)
                .put("steps", JSONArray().put(stepJson("b1", true)).put(stepJson("b2"))))
            .put("rest", JSONObject().put("id", "r").put("revision", 4).put("active", true).put("endsElapsed", 9000).put("duration", 90000))
            .put("control", JSONObject.NULL).put("canUndo", true).put("blocked", false).put("pending", JSONArray().put(JSONObject()))
        val s = SnapshotParser.parse(v1)
        assertEquals(Phase.Active, s.phase)
        assertEquals("legacy", s.mode)
        assertEquals(SyncState.SavedOnWatch, s.syncState)
        assertEquals("b2", s.next!!.setId)
        assertEquals("r", s.runningRest!!.timerId); assertEquals(4L, s.runningRest!!.localRev); assertNull(s.runningRest!!.revision)
        assertTrue(s.canUndo)
        val paused = SnapshotParser.parse(JSONObject(v1.toString()).put("control", JSONObject().put("owner", "phone")))
        assertEquals(Phase.PhoneControl, paused.phase)
    }

    @Test fun nullWorkoutIgnoresTheV1SnapshotKey() {
        // After close/clearClosed, inspect() keeps the v1 `snapshot` key but reports `workout: null`.
        val stale = v2("idle").put("workout", JSONObject.NULL).put("next", JSONObject.NULL)
            .put("snapshot", JSONObject().put("epoch", "e").put("sessionId", "s").put("title", "Old")
                .put("steps", JSONArray().put(stepJson("b1"))))
        val s = SnapshotParser.parse(stale)
        assertNull(s.workout)
        assertNull(s.next)
        assertTrue(s.steps.isEmpty())
        assertEquals(Phase.Idle, s.phase)

        // Same with no `phase` key: precedence must still derive Closed / Idle, not Active.
        val closed = JSONObject(stale.toString()).apply { remove("phase") }
            .put("closed", JSONObject().put("sessionId", "s").put("reason", "completed"))
        assertEquals(Phase.Closed, SnapshotParser.parse(closed).phase)
        assertNull(SnapshotParser.parse(closed).workout)
        val idle = JSONObject(stale.toString()).apply { remove("phase") }
        assertEquals(Phase.Idle, SnapshotParser.parse(idle).phase)
        assertEquals("shared", SnapshotParser.parse(idle).mode)
    }

    @Test fun phasePrecedence() {
        fun p(update: Boolean = false, closed: Boolean = false, frozen: Boolean = false, control: Boolean = false, workout: Boolean = true) =
            SnapshotParser.derivePhase(update, closed, frozen, control, workout)
        assertEquals(Phase.UpdateNeeded, p(update = true, closed = true, frozen = true))
        assertEquals(Phase.Closed, p(closed = true, frozen = true, control = true))
        assertEquals(Phase.Finishing, p(frozen = true, control = true))
        assertEquals(Phase.PhoneControl, p(control = true))
        assertEquals(Phase.Idle, p(workout = false))
        assertEquals(Phase.Active, p())
    }

    @Test fun syncPriority() {
        val busy = SyncInfo(pendingMutations = 1, receivedMutations = 1)
        assertEquals(SyncState.UpdateNeeded, SnapshotParser.deriveSync(true, true, busy))
        assertEquals(SyncState.NeedsReview, SnapshotParser.deriveSync(false, true, busy))
        assertEquals(SyncState.WaitingForPhone, SnapshotParser.deriveSync(false, false, busy))
        assertEquals(SyncState.SavedOnWatch, SnapshotParser.deriveSync(false, false, SyncInfo(pendingRestOps = 1)))
        assertEquals(SyncState.Synced, SnapshotParser.deriveSync(false, false, SyncInfo()))
    }
}
