package com.ironpath.watch.ui.preview

import android.content.Context
import com.ironpath.wearlink.WorkProtocol
import com.ironpath.wearlink.WorkStore
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Debug-only: feeds a phone hello + v2 snapshot through the real `WorkStore.receive`, so the UI
 * can be checked against store data on an emulator with no phone. Called only from debuggable builds.
 */
object DebugSeed {
    private const val PEER = "debug-phone"

    fun seed(context: Context) {
        val hello = JSONObject().put("role", "phone").put("protocols", JSONArray().put(1).put(2)).put("versionName", "1.0.6")
            .put("versionCode", 7).put("installId", UUID.randomUUID().toString()).put("reply", true)
            .put("features", JSONArray().put("mutations2").put("rest2").put("diag1").put("resolve1"))
        WorkStore(context).use { store ->
            store.receive(PEER, WorkProtocol(2, UUID.randomUUID().toString(), "hello", hello), true)
            store.receive(PEER, WorkProtocol(2, UUID.randomUUID().toString(), "snapshot", snapshot()), true)
        }
    }

    private fun snapshot(): JSONObject {
        val steps = JSONArray()
        fun add(id: String, pid: String, name: String, n: Int, of: Int, done: Boolean, load: String, target: String,
                weight: Double, reps: Int, slot: String?, group: Int) {
            steps.put(JSONObject().put("setId", id).put("prescriptionId", pid).put("exerciseId", pid).put("name", name)
                .put("setNumber", n).put("workingNumber", n).put("workingTotal", of).put("isWarmUp", false).put("entryStyle", "reps")
                .put("loadType", load).put("unit", "kg").put("target", target).put("recommendedWeight", weight)
                .put("band", JSONObject.NULL).put("restAfter", 90).put("supported", true)
                .put("actual", JSONObject().put("completed", done).put("reps", if (done) reps else JSONObject.NULL)
                    .put("repsLeft", JSONObject.NULL).put("repsRight", JSONObject.NULL).put("weight", if (done) weight else JSONObject.NULL)
                    .put("rpe", JSONObject.NULL).put("rir", JSONObject.NULL))
                .put("slot", slot ?: JSONObject.NULL).put("group", group).put("bandLabel", JSONObject.NULL).put("review", false))
        }
        for (i in 1..3) add("s$i", "squat", "Squat", i, 3, true, "barbell", "5", 100.0, 5, null, 0)
        for (i in 1..4) add("b$i", "bench", "Bench Press", i, 4, i == 1, "barbell", "8-10", 62.5, 8, "A1", 1)
        for (i in 1..4) add("r$i", "row", "Cable Row", i, 4, i == 1, "machine", "10-12", 55.0, 10, "A2", 1)
        return JSONObject().put("protocolVersion", 2).put("epoch", UUID.randomUUID().toString()).put("sessionId", "debug-session")
            .put("revision", 1).put("controlRevision", 1).put("title", "Upper A").put("status", "inProgress")
            .put("elapsedSeconds", 1200.0).put("elapsedRunning", true).put("capturedAtWall", System.currentTimeMillis())
            .put("vibrate", true).put("sequences", JSONObject()).put("freeze", JSONObject.NULL).put("reviews", JSONArray())
            .put("phone", JSONObject().put("versionName", "1.0.6").put("versionCode", 7)).put("steps", steps)
    }
}
