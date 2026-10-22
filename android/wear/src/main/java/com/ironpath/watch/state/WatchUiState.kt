package com.ironpath.watch.state

/** Immutable view of `WorkStore.inspect()` plus the UI-local state the ViewModel owns. */

enum class Phase { Idle, Active, Finishing, PhoneControl, Closed, UpdateNeeded, Error }

/** Ordered by display priority (UI spec §6): the first entry wins. */
enum class SyncState { UpdateNeeded, NeedsReview, WaitingForPhone, SavedOnWatch, Synced }

/** Editable set fields, keyed by their wire names. */
enum class Field(val key: String) {
    Reps("reps"), RepsLeft("repsLeft"), RepsRight("repsRight"), Weight("weight");
    companion object { fun of(key: String): Field? = entries.firstOrNull { it.key == key } }
}

data class SetValues(
    val completed: Boolean = false,
    val reps: Double? = null,
    val repsLeft: Double? = null,
    val repsRight: Double? = null,
    val weight: Double? = null,
) {
    operator fun get(field: Field): Double? = when (field) {
        Field.Reps -> reps
        Field.RepsLeft -> repsLeft
        Field.RepsRight -> repsRight
        Field.Weight -> weight
    }
}

data class Step(
    val setId: String,
    val prescriptionId: String,
    val exerciseId: String,
    val name: String,
    val setNumber: Int,
    val workingNumber: Int,
    val workingTotal: Int,
    val isWarmUp: Boolean,
    /** 1-based index among this prescription's ramp sets; 0 for working sets. */
    val rampNumber: Int,
    val entryStyle: String,
    val loadType: String,
    val unit: String,
    val target: String,
    val recommendedWeight: Double?,
    val bandLabel: String?,
    val restAfter: Int,
    val supported: Boolean,
    val slot: String?,
    val group: Int,
    val review: Boolean,
    val pending: Boolean,
    val actual: SetValues,
) {
    val perSide get() = entryStyle == "repsPerSide"
    val hasWeight get() = loadType in WEIGHTED_LOADS
    val completed get() = actual.completed
    /** Fields the watch may edit for this step, in display order. */
    val fields: List<Field>
        get() = (if (perSide) listOf(Field.RepsLeft, Field.RepsRight) else listOf(Field.Reps)) +
            (if (hasWeight) listOf(Field.Weight) else emptyList())
    val position get() = if (isWarmUp) "Ramp $rampNumber" else "Set $workingNumber of $workingTotal"
    val title get() = if (slot != null) "$slot · $name" else name

    companion object { val WEIGHTED_LOADS = setOf("barbell", "dumbbell", "kettlebell", "machine") }
}

data class Workout(
    val epoch: String,
    val sessionId: String,
    val title: String,
    val revision: Long,
    val elapsedSeconds: Double,
    val elapsedRunning: Boolean,
    val elapsedReceivedElapsed: Long,
    val elapsedUncertain: Boolean,
    val vibrate: Boolean,
    val steps: List<Step>,
) {
    /** Elapsed workout seconds at device uptime [nowElapsed] (§1.4 elapsed rule). */
    fun elapsedAt(nowElapsed: Long): Double =
        elapsedSeconds + if (elapsedRunning && elapsedReceivedElapsed > 0)
            maxOf(0L, nowElapsed - elapsedReceivedElapsed) / 1000.0 else 0.0
}

data class Label(val title: String, val text: String)

data class NextUp(
    val setId: String,
    val prescriptionId: String,
    val name: String,
    val slot: String?,
    /** "set" when the next step continues the same prescription, else "exercise". */
    val kind: String,
    val position: String,
    val weight: Double?,
    val unit: String,
    val bandLabel: String?,
    val supported: Boolean,
    val label: Label,
)

data class RestAlert(val destination: String, val armed: Boolean, val reason: String)

data class RestUi(
    val timerId: String,
    val localRev: Long,
    val revision: Long?,
    val state: String,
    val endsElapsed: Long,
    val remainingMs: Long,
    val durationMs: Long,
    val origin: String,
    val sourceOp: String?,
    val next: Label?,
    val pendingSync: Boolean,
    val uncertain: Boolean,
    val recovery: String?,
    val test: Boolean,
    val alert: RestAlert?,
) {
    val running get() = state == "running"
    /** Remaining time measured against this device's uptime clock. */
    fun remainingAt(nowElapsed: Long): Long = if (running) maxOf(0L, endsElapsed - nowElapsed) else 0L
}

data class UndoUi(val opId: String, val setId: String, val label: String)

/** One changed field of the reviewed op; [conflict] marks the ones the user must choose between. */
data class ConflictField(val field: String, val phone: Any?, val watch: Any?, val conflict: Boolean = true)

data class Conflict(
    val id: String,
    val setId: String,
    val exerciseName: String,
    val position: String,
    val origin: String,
    val code: String,
    val reason: String,
    val fields: List<ConflictField>,
    val queuedResolution: String?,
) {
    val conflicting get() = fields.filter { it.conflict }
    /** Non-conflicting changes the op also carries (kept when "Use watch value" is chosen). */
    val alsoChanged get() = fields.filterNot { it.conflict }
}

data class Freeze(val id: String, val reason: String, val sinceWall: Long)

data class Closed(
    val sessionId: String,
    val reason: String,
    val done: Int,
    val total: Int,
    val elapsedSeconds: Long,
    val unsynced: Int,
)

data class SyncInfo(
    val pendingMutations: Int = 0,
    val receivedMutations: Int = 0,
    val pendingRestOps: Int = 0,
    val reviewCount: Int = 0,
    val phoneReachable: Boolean = false,
    val lastSyncedWall: Long? = null,
)

data class Peer(
    val protocol: Int? = null,
    val phoneVersion: String? = null,
    val watchVersion: String? = null,
    val updatePairKey: String? = null,
    val updateTarget: String? = null,
)

data class Alerts(val notifications: Boolean = true, val exact: Boolean = true)

data class Legacy(val blocked: Boolean, val canUndo: Boolean, val controlOwner: String?)

/** Parsed `inspect()` result. */
data class WatchSnapshot(
    val phase: Phase,
    val mode: String,
    val syncState: SyncState,
    val sync: SyncInfo,
    val peer: Peer,
    val workout: Workout?,
    val next: NextUp?,
    val rest: RestUi?,
    val undo: UndoUi?,
    val conflicts: List<Conflict>,
    val freeze: Freeze?,
    val closed: Closed?,
    val alerts: Alerts,
    val legacy: Legacy?,
) {
    val steps get() = workout?.steps.orEmpty()
    fun step(setId: String?): Step? = setId?.let { id -> steps.firstOrNull { it.setId == id } }
    val runningRest get() = rest?.takeIf { it.running }
    val canUndo get() = undo != null || legacy?.canUndo == true

    companion object {
        val EMPTY = WatchSnapshot(Phase.Idle, "none", SyncState.Synced, SyncInfo(), Peer(), null, null, null,
            null, emptyList(), null, null, Alerts(), null)
    }
}

/** Short-lived flash line ("Next: A2", "Finish cancelled") with an uptime expiry. */
data class Flash(val text: String, val untilElapsed: Long)

/** Everything the composables need; screens receive slices of it plus lambdas. */
data class WatchUiState(
    val snapshot: WatchSnapshot = WatchSnapshot.EMPTY,
    val phase: Phase = Phase.Idle,
    val loaded: Boolean = false,
    val busy: Boolean = false,
    /** Set the user picked from Exercises or the next-up card; null follows `inspect().next`. */
    val selectedSetId: String? = null,
    /** True while the user peeks at the upcoming set during rest. */
    val peekDuringRest: Boolean = false,
    val editor: Editor? = null,
    val undoPillUntil: Long = 0,
    val flash: Flash? = null,
    val saveFailed: Boolean = false,
    val serviceFailed: Boolean = false,
    /** Local alert capability, refreshed on every poll. */
    val notificationsOn: Boolean = true,
    val preciseOn: Boolean = true,
    /** Inline result under the Settings test buttons; cleared after 4 s. */
    val testResult: Pair<String, String>? = null,
) {
    /** The set S2 shows: the explicit pick, else the store's next step. */
    val currentStep: Step? get() = snapshot.step(selectedSetId) ?: snapshot.step(snapshot.next?.setId)
    val showRest get() = snapshot.runningRest != null && !peekDuringRest
}
