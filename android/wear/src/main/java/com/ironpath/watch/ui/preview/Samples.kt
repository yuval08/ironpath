package com.ironpath.watch.ui.preview

import android.os.SystemClock
import com.ironpath.watch.state.Editor
import com.ironpath.watch.state.Field
import com.ironpath.watch.state.SnapshotParser
import com.ironpath.watch.state.WatchSnapshot
import com.ironpath.watch.state.WatchUiState
import org.json.JSONArray
import org.json.JSONObject

/**
 * Fake `inspect()` payloads for previews and the debug demo hook. They go through
 * [SnapshotParser], so previews exercise the same mapping as the real store.
 */
object Samples {
    val NAMES = listOf("idle", "set", "edited", "rest", "perside", "band", "review", "unsupported", "done", "empty",
        "finishing", "phone", "closed", "closedWarn", "update", "saved", "waiting", "synced")

    fun state(name: String): WatchUiState {
        val snapshot = snapshot(name)
        val now = SystemClock.elapsedRealtime()
        val base = WatchUiState(snapshot = snapshot, phase = snapshot.phase, loaded = true,
            undoPillUntil = if (name == "rest") now + 4000 else 0)
        // "edited": the user dialled a heavier weight in S3 (primary outline on the tile).
        val step = base.currentStep
        return if (name == "edited" && step != null) base.copy(editor = Editor.open(step).edit(Field.Weight, 65.0)) else base
    }

    fun snapshot(name: String): WatchSnapshot = SnapshotParser.parse(json(name))

    fun json(name: String): JSONObject {
        val now = SystemClock.elapsedRealtime()
        val steps = steps(name)
        val root = JSONObject()
            .put("mode", "shared")
            .put("syncState", when (name) {
                "saved" -> "savedOnWatch"; "waiting" -> "waitingForPhone"; "review" -> "needsReview"; "update" -> "updateNeeded"; else -> "synced"
            })
            .put("sync", JSONObject().put("pendingMutations", if (name == "saved") 3 else 0).put("receivedMutations", if (name == "waiting") 1 else 0)
                .put("pendingRestOps", 0).put("reviewCount", if (name == "review") 1 else 0).put("phoneReachable", name != "saved")
                .put("lastSyncedWall", System.currentTimeMillis() - 11 * 60_000))
            .put("peer", JSONObject().put("protocol", if (name == "update") 1 else 2).put("phoneVersion", if (name == "update") "1.0.5" else "1.0.6")
                .put("watchVersion", "0.5.0").put("updatePairKey", if (name == "update") "0.5.0|1.0.5" else JSONObject.NULL)
                .put("updateTarget", if (name == "update") "phone" else JSONObject.NULL))
            .put("alerts", JSONObject().put("notifications", true).put("exact", true))
            .put("conflicts", JSONArray())
        if (name == "idle") return root.put("phase", "idle").put("workout", JSONObject.NULL)
        root.put("workout", JSONObject().put("epoch", "e").put("sessionId", "s").put("title", "Upper A").put("revision", 41)
            .put("controlRevision", 7).put("elapsedSeconds", 2040.0).put("elapsedRunning", true).put("elapsedReceivedElapsed", now)
            .put("elapsedUncertain", false).put("vibrate", true).put("steps", steps))
        val firstOpen = (0 until steps.length()).map { steps.getJSONObject(it) }.firstOrNull {
            !it.getJSONObject("actual").getBoolean("completed") && (name == "unsupported" || it.getBoolean("supported"))
        }
        firstOpen?.let { root.put("next", next(it)) }
        when (name) {
            "rest" -> root.put("phase", "resting").put("rest", JSONObject().put("timerId", "t1").put("localRev", 3).put("revision", 12)
                .put("state", "running").put("endsElapsed", now + 84_000).put("remainingMs", 84_000).put("durationMs", 120_000)
                .put("origin", "watch").put("sourceOp", "op1").put("pendingSync", false).put("uncertain", false).put("test", false)
                .put("alert", JSONObject().put("destination", "watch").put("armed", true).put("reason", "ok")))
                .put("undo", JSONObject().put("opId", "op1").put("setId", "b1").put("label", "Undo set 1"))
            "review" -> root.put("conflicts", JSONArray().put(JSONObject().put("id", "c1").put("setId", "b2").put("exerciseName", "Bench")
                .put("position", "Set 2").put("origin", "watch").put("code", "fieldConflict").put("reason", "")
                .put("fields", JSONArray().put(JSONObject().put("field", "completed").put("phone", false).put("watch", true).put("conflict", false))
                    .put(JSONObject().put("field", "reps").put("phone", 8).put("watch", 10).put("conflict", true)))
                .put("queuedResolution", JSONObject.NULL)))
            "finishing" -> root.put("freeze", JSONObject().put("id", "f").put("reason", "finish").put("sinceWall", System.currentTimeMillis()))
            "phone" -> root.put("legacy", JSONObject().put("blocked", false).put("canUndo", false).put("control", JSONObject().put("owner", "phone")))
            "closed", "closedWarn" -> root.put("closed", JSONObject().put("sessionId", "s").put("reason", "completed")
                .put("summary", JSONObject().put("done", 18).put("total", 20).put("elapsedSeconds", 3120))
                .put("unsynced", if (name == "closedWarn") 2 else 0))
        }
        if (!root.has("phase")) root.put("phase", when (name) {
            "finishing" -> "finishing"; "phone" -> "phoneControl"; "closed", "closedWarn" -> "closed"; "update" -> "updateNeeded"; else -> "active"
        })
        return root
    }

    private fun next(step: JSONObject) = JSONObject().put("setId", step.getString("setId")).put("prescriptionId", step.getString("prescriptionId"))
        .put("name", step.getString("name")).put("slot", step.opt("slot")).put("kind", "set")
        .put("position", "Set ${step.getInt("workingNumber")} of ${step.getInt("workingTotal")}")
        .put("target", step.getString("target")).put("weight", step.opt("recommendedWeight")).put("unit", "kg")
        .put("bandLabel", step.opt("bandLabel")).put("supported", step.getBoolean("supported"))
        .put("title", step.getString("name")).put("text", "")

    private fun steps(name: String): JSONArray {
        val list = JSONArray()
        if (name == "empty") return list
        fun add(id: String, pid: String, label: String, n: Int, of: Int, done: Boolean, load: String = "barbell", style: String = "reps",
                target: String = "8-10", weight: Double? = null, reps: Double? = null, slot: String? = null, band: String? = null,
                supported: Boolean = true, review: Boolean = false, rec: Double? = 60.0) {
            list.put(JSONObject().put("setId", id).put("prescriptionId", pid).put("exerciseId", pid).put("name", label)
                .put("setNumber", n).put("workingNumber", n).put("workingTotal", of).put("isWarmUp", false).put("entryStyle", style)
                .put("loadType", load).put("unit", "kg").put("target", target).put("recommendedWeight", rec ?: JSONObject.NULL)
                .put("band", band ?: JSONObject.NULL).put("bandLabel", band ?: JSONObject.NULL).put("restAfter", 90).put("supported", supported)
                .put("slot", slot ?: JSONObject.NULL).put("group", 0).put("review", review).put("pending", false)
                .put("actual", JSONObject().put("completed", done).put("reps", reps ?: JSONObject.NULL).put("weight", weight ?: JSONObject.NULL)
                    .put("repsLeft", if (style == "repsPerSide" && done) 8 else JSONObject.NULL)
                    .put("repsRight", if (style == "repsPerSide" && done) 8 else JSONObject.NULL)))
        }
        val allDone = name == "done"
        if (name == "unsupported") add("p1", "plank", "Plank", 1, 1, false, load = "none", style = "time", target = "45 s each side", supported = false, rec = null)
        if (name == "perside") add("l1", "lunge", "Bulgarian Split Squat", 1, 3, false, load = "dumbbell", style = "repsPerSide", target = "8 per side", rec = 16.0)
        if (name == "band") add("f1", "facepull", "Face Pull", 1, 3, false, load = "band", target = "12-15", band = "Light", rec = null)
        for (i in 1..3) add("s$i", "squat", "Squat", i, 3, true, weight = 100.0, reps = 5.0, target = "5", rec = 100.0)
        add("b1", "bench", "Bench Press", 1, 4, true, weight = 62.5, reps = 8.0, slot = "A1", rec = 62.5)
        for (i in 2..4) add("b$i", "bench", "Bench Press", i, 4, allDone, weight = if (allDone) 62.5 else null, reps = if (allDone) 8.0 else null,
            slot = "A1", rec = 62.5, review = name == "review" && i == 2)
        for (i in 1..4) add("r$i", "row", "Cable Row", i, 4, allDone || i == 1, load = "machine", weight = if (allDone || i == 1) 55.0 else null,
            reps = if (allDone || i == 1) 10.0 else null, slot = "A2", target = "10-12", rec = 55.0)
        return list
    }
}
