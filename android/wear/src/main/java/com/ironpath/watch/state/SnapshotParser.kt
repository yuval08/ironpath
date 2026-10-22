package com.ironpath.watch.state

import org.json.JSONArray
import org.json.JSONObject

/**
 * The only place `inspect()` JSON becomes data classes (design §6.3). Optional keys default
 * safely, and v1-only keys (`snapshot`, v1 `rest`, `control`, `pending`) are mapped so a
 * legacy store still renders.
 */
object SnapshotParser {
    fun parse(json: JSONObject): WatchSnapshot {
        // v2 stores always send `workout` (null when idle/closed) next to the v1 `snapshot` key;
        // fall back to `snapshot` only when `workout` is absent (a v1 store).
        val v2 = json.has("workout")
        val workout = (if (v2) json.obj("workout") else json.obj("snapshot"))?.let(::workout)
        val rest = json.obj("rest")?.let(::rest)
        val legacy = json.obj("legacy")?.let(::legacy) ?: v1Legacy(json)
        val peer = json.obj("peer")?.let(::peer) ?: Peer()
        val closed = json.obj("closed")?.let(::closed)
        val freeze = json.obj("freeze")?.let { Freeze(it.str("id"), it.str("reason"), it.optLong("sinceWall")) }
        val conflicts = json.objects("conflicts").map(::conflict)
        val sync = json.obj("sync")?.let(::sync) ?: SyncInfo(pendingMutations = json.optJSONArray("pending")?.length() ?: 0)
        val phase = json.optString("phase").takeIf { it.isNotEmpty() }?.let(::phaseOf) ?: derivePhase(
            updateNeeded = peer.updatePairKey != null, closed = closed != null, frozen = freeze != null,
            phoneControl = legacy?.controlOwner != null, hasWorkout = workout != null,
        )
        val syncState = json.optString("syncState").takeIf { it.isNotEmpty() }?.let(::syncOf)
            ?: deriveSync(peer.updatePairKey != null, conflicts.isNotEmpty() || legacy?.blocked == true, sync)
        return WatchSnapshot(
            phase = phase,
            mode = json.optString("mode", if (v2) "shared" else if (workout != null) "legacy" else "none"),
            syncState = syncState,
            sync = sync,
            peer = peer,
            workout = workout,
            next = if (v2) json.obj("next")?.let(::next) else workout?.let(::v1Next),
            rest = rest,
            undo = json.obj("undo")?.let { UndoUi(it.str("opId"), it.str("setId"), it.optString("label", "Undo set")) },
            conflicts = conflicts,
            freeze = freeze,
            closed = closed,
            alerts = json.obj("alerts")?.let { Alerts(it.optBoolean("notifications", true), it.optBoolean("exact", true)) } ?: Alerts(),
            legacy = legacy,
        )
    }

    /** Phase precedence from design §6.3 (used when the store omits `phase`). */
    fun derivePhase(updateNeeded: Boolean, closed: Boolean, frozen: Boolean, phoneControl: Boolean, hasWorkout: Boolean): Phase = when {
        updateNeeded -> Phase.UpdateNeeded
        closed -> Phase.Closed
        frozen -> Phase.Finishing
        phoneControl -> Phase.PhoneControl
        !hasWorkout -> Phase.Idle
        else -> Phase.Active
    }

    /** Sync priority from UI spec §6. */
    fun deriveSync(updateNeeded: Boolean, review: Boolean, sync: SyncInfo): SyncState = when {
        updateNeeded -> SyncState.UpdateNeeded
        review -> SyncState.NeedsReview
        sync.receivedMutations > 0 -> SyncState.WaitingForPhone
        sync.pendingMutations + sync.pendingRestOps > 0 -> SyncState.SavedOnWatch
        else -> SyncState.Synced
    }

    fun phaseOf(value: String): Phase = when (value) {
        "active", "resting" -> Phase.Active
        "finishing" -> Phase.Finishing
        "phoneControl" -> Phase.PhoneControl
        "closed" -> Phase.Closed
        "updateNeeded" -> Phase.UpdateNeeded
        else -> Phase.Idle
    }

    fun syncOf(value: String): SyncState = when (value) {
        "savedOnWatch" -> SyncState.SavedOnWatch
        "waitingForPhone" -> SyncState.WaitingForPhone
        "needsReview" -> SyncState.NeedsReview
        "updateNeeded" -> SyncState.UpdateNeeded
        else -> SyncState.Synced
    }

    private fun workout(json: JSONObject): Workout {
        val raw = json.objects("steps")
        val steps = raw.mapIndexed { index, step ->
            val ramp = if (step.optBoolean("isWarmUp")) raw.take(index + 1).count {
                it.optBoolean("isWarmUp") && it.str("prescriptionId") == step.str("prescriptionId")
            } else 0
            step(step, ramp)
        }
        return Workout(
            epoch = json.str("epoch"), sessionId = json.str("sessionId"), title = json.str("title"),
            revision = json.optLong("revision"), elapsedSeconds = json.optDouble("elapsedSeconds", 0.0).takeIf { !it.isNaN() } ?: 0.0,
            elapsedRunning = json.optBoolean("elapsedRunning"), elapsedReceivedElapsed = json.optLong("elapsedReceivedElapsed"),
            elapsedUncertain = json.optBoolean("elapsedUncertain"), vibrate = json.optBoolean("vibrate", true), steps = steps,
        )
    }

    private fun step(json: JSONObject, rampNumber: Int): Step {
        val actual = json.obj("actual") ?: JSONObject()
        return Step(
            setId = json.str("setId"), prescriptionId = json.str("prescriptionId"), exerciseId = json.str("exerciseId"),
            name = json.str("name"), setNumber = json.optInt("setNumber", 1), workingNumber = json.optInt("workingNumber"),
            workingTotal = json.optInt("workingTotal"), isWarmUp = json.optBoolean("isWarmUp"), rampNumber = rampNumber,
            entryStyle = json.optString("entryStyle", "reps"), loadType = json.optString("loadType", "none"),
            unit = json.optString("unit", "kg"), target = json.optString("target"),
            recommendedWeight = json.numberOrNull("recommendedWeight"),
            bandLabel = json.nullableString("bandLabel") ?: json.nullableString("band"),
            restAfter = json.optInt("restAfter"), supported = json.optBoolean("supported"),
            slot = json.nullableString("slot"), group = json.optInt("group"), review = json.optBoolean("review"),
            pending = json.optBoolean("pending"),
            actual = SetValues(
                completed = actual.optBoolean("completed"), reps = actual.numberOrNull("reps"),
                repsLeft = actual.numberOrNull("repsLeft"), repsRight = actual.numberOrNull("repsRight"),
                weight = actual.numberOrNull("weight"),
            ),
        )
    }

    private fun next(json: JSONObject) = NextUp(
        setId = json.str("setId"), prescriptionId = json.str("prescriptionId"), name = json.str("name"),
        slot = json.nullableString("slot"), kind = json.optString("kind", "set"), position = json.str("position"),
        weight = json.numberOrNull("weight"), unit = json.optString("unit", "kg"), bandLabel = json.nullableString("bandLabel"),
        supported = json.optBoolean("supported", true), label = Label(json.str("title"), json.str("text")),
    )

    /** v1 stores have no `next`: the first incomplete step is next. */
    private fun v1Next(workout: Workout): NextUp? = workout.steps.firstOrNull { !it.completed }?.let { step ->
        NextUp(step.setId, step.prescriptionId, step.name, step.slot, "set", step.position, step.actual.weight ?: step.recommendedWeight,
            step.unit, step.bandLabel, step.supported, Label(step.title, step.position))
    }

    private fun rest(json: JSONObject): RestUi {
        // v2 view uses timerId/localRev/state; v1 records use id/revision/active.
        val state = json.nullableString("state") ?: if (json.optBoolean("active")) "running" else "ended"
        return RestUi(
            timerId = json.nullableString("timerId") ?: json.str("id"),
            localRev = if (json.has("localRev")) json.optLong("localRev") else json.optLong("revision"),
            revision = if (json.has("localRev") && !json.isNull("revision")) json.optLong("revision") else null,
            state = state, endsElapsed = json.optLong("endsElapsed"), remainingMs = json.optLong("remainingMs"),
            durationMs = if (json.has("durationMs")) json.optLong("durationMs") else json.optLong("duration"),
            origin = json.optString("origin", "watch"), sourceOp = json.nullableString("sourceOp"),
            next = json.obj("next")?.let { Label(it.str("title"), it.str("text")) },
            pendingSync = json.optBoolean("pendingSync"), uncertain = json.optBoolean("uncertain"),
            recovery = json.nullableString("recovery"), test = json.optBoolean("test"),
            alert = json.obj("alert")?.let { RestAlert(it.optString("destination", "watch"), it.optBoolean("armed"), it.optString("reason", "ok")) },
        )
    }

    private fun conflict(json: JSONObject) = Conflict(
        id = json.str("id"), setId = json.str("setId"), exerciseName = json.str("exerciseName"), position = json.str("position"),
        origin = json.optString("origin", "watch"), code = json.optString("code"), reason = json.optString("reason"),
        // `conflict` is absent in pre-fix stores, where every listed field conflicted.
        fields = json.objects("fields").map { ConflictField(it.str("field"), it.value("phone"), it.value("watch"), it.optBoolean("conflict", true)) },
        queuedResolution = json.nullableString("queuedResolution"),
    )

    private fun closed(json: JSONObject): Closed {
        val summary = json.obj("summary") ?: JSONObject()
        return Closed(json.str("sessionId"), json.optString("reason", "completed"), summary.optInt("done"),
            summary.optInt("total"), summary.optLong("elapsedSeconds"), json.optInt("unsynced"))
    }

    private fun sync(json: JSONObject) = SyncInfo(
        pendingMutations = json.optInt("pendingMutations"), receivedMutations = json.optInt("receivedMutations"),
        pendingRestOps = json.optInt("pendingRestOps"), reviewCount = json.optInt("reviewCount"),
        phoneReachable = json.optBoolean("phoneReachable"),
        lastSyncedWall = if (json.has("lastSyncedWall") && !json.isNull("lastSyncedWall")) json.optLong("lastSyncedWall") else null,
    )

    private fun peer(json: JSONObject) = Peer(
        protocol = if (json.has("protocol") && !json.isNull("protocol")) json.optInt("protocol") else null,
        phoneVersion = json.nullableString("phoneVersion"), watchVersion = json.nullableString("watchVersion"),
        updatePairKey = json.nullableString("updatePairKey"), updateTarget = json.nullableString("updateTarget"),
    )

    private fun legacy(json: JSONObject) =
        Legacy(json.optBoolean("blocked"), json.optBoolean("canUndo"), json.obj("control")?.nullableString("owner"))

    /** v1 stores report blocked/canUndo/control at top level. */
    private fun v1Legacy(json: JSONObject): Legacy? =
        if (json.has("workout") || !json.has("canUndo")) null
        else Legacy(json.optBoolean("blocked"), json.optBoolean("canUndo"), json.obj("control")?.nullableString("owner"))

    private fun JSONObject.obj(key: String): JSONObject? = if (isNull(key)) null else optJSONObject(key)
    private fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key)
    private fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else optString(key).takeIf { has(key) }
    private fun JSONObject.value(key: String): Any? = if (isNull(key)) null else opt(key)
    private fun JSONObject.objects(key: String): List<JSONObject> {
        val array: JSONArray = optJSONArray(key) ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    }
}
