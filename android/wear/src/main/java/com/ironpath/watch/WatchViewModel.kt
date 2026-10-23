package com.ironpath.watch

import android.app.Application
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ironpath.watch.state.Editor
import com.ironpath.watch.state.Field
import com.ironpath.watch.state.Flash
import com.ironpath.watch.state.Phase
import com.ironpath.watch.state.Prefill
import com.ironpath.watch.state.Step
import com.ironpath.watch.state.WatchSnapshot
import com.ironpath.watch.state.WatchUiState
import com.ironpath.wearlink.Clock
import com.ironpath.wearlink.Diagnostics
import com.ironpath.wearlink.LinkClient
import com.ironpath.wearlink.LinkProtocol
import com.ironpath.wearlink.SyncError
import com.ironpath.wearlink.WorkClient
import com.ironpath.wearlink.WorkStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

/** One-shot UI effects: haptics and navigation requests. */
sealed interface UiEvent {
    data object Confirm : UiEvent
    data object Reject : UiEvent
    /** Done set was refused because the phone changed this touched field: open S3 for it. */
    data class Adjust(val field: Field) : UiEvent
    /** Return to pager page 0 (after picking an exercise). */
    data object ShowNow : UiEvent
}

/**
 * Maps `WorkStore.inspect()` into [WatchUiState] and forwards user actions to WorkStore on IO.
 * No sync rules live here: next-step, rest, undo and conflict logic stay in wear-link.
 */
class WatchViewModel(app: Application) : AndroidViewModel(app) {
    private val context get() = getApplication<Application>()
    private val prefs = WatchPrefs(app)
    private val _state = MutableStateFlow(WatchUiState())
    val state: StateFlow<WatchUiState> = _state.asStateFlow()
    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<UiEvent> = _events

    /** Bumped by every action so a stale inspect cannot overwrite a fresher post-action state. */
    private var generation = 0
    /** Debug-only fixed snapshot for screenshots and demos; actions become no-ops. */
    private var demo: WatchSnapshot? = null

    fun useDemo(state: WatchUiState) { demo = state.snapshot; _state.value = state }

    /** Inspect loop; the caller runs it inside `repeatOnLifecycle(STARTED)`. */
    suspend fun poll() {
        var first = true
        while (true) {
            val before = generation
            if (demo != null) { delay(1000); continue }
            try {
                val snapshot = withContext(Dispatchers.IO) {
                    if (first) WorkStore(context).use { it.retryReceivedCommands() }
                    RestRuntime.read(context, recover = first)
                }
                if (!_state.value.busy && before == generation) applySnapshot(snapshot)
                _state.update { it.copy(notificationsOn = NotificationManagerCompat.from(context).areNotificationsEnabled(),
                    preciseOn = RestRuntime.precise(context)) }
                if (first && snapshot.runningRest != null) startRuntime()
                withContext(Dispatchers.IO) {
                    // Announce this version on launch, so the phone's background listener can answer
                    // even when the phone app is closed.
                    if (first) WorkClient.helloIfStale(context)
                    flushQuietly()
                }
                first = false
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                Diagnostics.record(context, "sync.storageFailure", org.json.JSONObject().put("data",
                    org.json.JSONObject().put("stage", "inspect").put("message", error.javaClass.simpleName)))
                _state.update { it.copy(phase = Phase.Error, loaded = true) }
            }
            delay(nextPollDelay())
        }
    }

    /** Poll at 1 s, but wake right at the rest deadline so the foreground delivery is on time. */
    private suspend fun nextPollDelay(): Long {
        val rest = _state.value.snapshot.runningRest ?: return 1000
        val left = rest.remainingAt(SystemClock.elapsedRealtime())
        if (left == 0L && demo == null) {
            withContext(Dispatchers.IO) {
                try { RestRuntime.deliver(context, rest.timerId, rest.localRev, "foreground") }
                catch (error: Exception) { android.util.Log.e("IronpathTimer", "Foreground delivery failed", error) }
            }
            refresh()
            return 1000
        }
        return left.coerceIn(50, 1000)
    }

    private fun applySnapshot(snapshot: WatchSnapshot) = _state.update { old ->
        val previous = old.snapshot
        val phase = snapshot.phase
        val now = SystemClock.elapsedRealtime()
        // Editors survive remote edits by rebasing; they never survive a freeze or close.
        val editor = old.editor?.let { e ->
            val step = snapshot.step(e.setId)
            if (step == null || phase != Phase.Active) null else e.rebase(step.actual)
        }
        val restChanged = previous.runningRest?.timerId != snapshot.runningRest?.timerId
        val flash = when {
            old.loaded && old.phase == Phase.Finishing && phase == Phase.Active -> Flash("Finish cancelled", now + 1500)
            else -> old.flash
        }
        old.copy(
            snapshot = snapshot, phase = phase, loaded = true, editor = editor, flash = flash,
            selectedSetId = old.selectedSetId?.takeIf { snapshot.step(it) != null },
            peekDuringRest = old.peekDuringRest && !restChanged && snapshot.runningRest != null,
        )
    }

    // ---- Current set -------------------------------------------------------------------------

    private fun editorFor(step: Step): Editor = _state.value.editor?.takeIf { it.setId == step.setId } ?: Editor.open(step)

    fun prefill(step: Step): Map<Field, Double?> = Prefill.values(step, _state.value.snapshot.steps)

    /** S3 "Set": writes the values into the editor only; nothing is saved yet. */
    fun setValues(step: Step, values: Map<Field, Double?>) {
        var editor = editorFor(step)
        for ((field, value) in values) {
            editor = editor.edit(field, value)
            if (field in editor.stale) editor = editor.accept(field)
        }
        _state.update { it.copy(editor = editor) }
        _events.tryEmit(UiEvent.Confirm)
    }

    /** Done set / Update set. */
    fun submit() {
        val step = _state.value.currentStep ?: return
        val editor = editorFor(step)
        editor.stale.keys.firstOrNull()?.let { _events.tryEmit(UiEvent.Reject); _events.tryEmit(UiEvent.Adjust(it)); return }
        val prefill = prefill(step)
        val complete = !step.completed
        if (!complete && !editor.dirty(step, prefill)) { _events.tryEmit(UiEvent.Reject); return }
        val (expected, changes) = editor.submission(step, prefill, complete)
        action(work = { store ->
            val clock = Clock.now(context)
            if (complete) store.logSet(step.setId, expected, changes, clock.elapsed, clock.wall, clock.boot)
            else store.updateSet(step.setId, expected, changes)
        }, after = { snapshot ->
            val now = SystemClock.elapsedRealtime()
            val nextLabel = snapshot.next?.let { it.slot ?: it.name }
            _state.update { s ->
                s.copy(
                    editor = null, selectedSetId = null, peekDuringRest = false,
                    undoPillUntil = if (complete && snapshot.canUndo) now + UNDO_MS else s.undoPillUntil,
                    flash = if (complete && snapshot.runningRest == null && nextLabel != null) Flash("Next: $nextLabel", now + 1500) else s.flash,
                )
            }
        })
    }

    /** Unsupported step "Next": local selection only, moves to the next supported incomplete step. */
    fun skipUnsupported() {
        val state = _state.value
        val steps = state.snapshot.steps
        val from = steps.indexOfFirst { it.setId == state.currentStep?.setId }
        val next = steps.drop(from + 1).firstOrNull { it.supported && !it.completed } ?: return
        _state.update { it.copy(selectedSetId = next.setId) }
        _events.tryEmit(UiEvent.Confirm)
    }

    /** Exercises page: first incomplete set of the prescription, else its last set. */
    fun selectExercise(prescriptionId: String) {
        val sets = _state.value.snapshot.steps.filter { it.prescriptionId == prescriptionId }
        val pick = sets.firstOrNull { !it.completed } ?: sets.lastOrNull() ?: return
        _state.update { it.copy(selectedSetId = pick.setId, peekDuringRest = it.snapshot.runningRest != null) }
        _events.tryEmit(UiEvent.ShowNow)
    }

    fun peekNext() = _state.update { it.copy(peekDuringRest = true, selectedSetId = null) }
    fun showRest() = _state.update { it.copy(peekDuringRest = false) }

    fun undo() = action(work = { it.undoLast() }, after = {
        _state.update { s -> s.copy(editor = null, selectedSetId = null, peekDuringRest = false, undoPillUntil = 0) }
    })

    // ---- Rest --------------------------------------------------------------------------------

    fun adjustRest(deltaSeconds: Int) = action(work = { it.editRest(deltaSeconds, SystemClock.elapsedRealtime()) })
    fun skipRest() = action(work = { it.skipRest(SystemClock.elapsedRealtime()) })

    // ---- Sync, phases ------------------------------------------------------------------------

    fun resolve(conflictId: String, keepPhone: Boolean) = action(work = { it.resolveConflict(conflictId, keepPhone) })
    fun acknowledgeUpdate() {
        val key = _state.value.snapshot.peer.updatePairKey ?: return
        action(work = { it.acknowledgeUpdate(key) })
    }
    fun clearClosed() = action(work = { it.clearClosed() })
    fun refresh() = action(work = { }, haptic = false)
    fun dismissSaveFailure() = _state.update { it.copy(saveFailed = false) }

    // ---- Settings ----------------------------------------------------------------------------

    fun testAlert() = action(work = { store ->
        val clock = Clock.now(context)
        store.testRest(clock.elapsed, clock.wall, clock.boot)
    }, after = { showTestResult("alert", "Buzzing in 3 s") }, onError = { showTestResult("alert", "Finish the rest first") })

    fun testConnection() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, testResult = "connection" to "Checking…") }
        viewModelScope.launch {
            val ok = try {
                val id = withContext(Dispatchers.IO) { LinkClient.ping(context, LinkProtocol.PHONE) }
                var confirmed = false
                repeat(10) {
                    if (!confirmed) {
                        delay(1000)
                        val receipts: JSONArray = withContext(Dispatchers.IO) { LinkClient.inspect(context, LinkProtocol.PHONE) }.getJSONArray("receipts")
                        confirmed = (0 until receipts.length()).any { receipts.getJSONObject(it).let { r -> r.getString("id") == id && r.getString("type") == "pong" } }
                    }
                }
                confirmed
            } catch (error: Exception) { if (error is CancellationException) throw error; false }
            _state.update { it.copy(busy = false) }
            _events.tryEmit(if (ok) UiEvent.Confirm else UiEvent.Reject)
            showTestResult("connection", if (ok) "Connected ✓" else "No reply. Check pairing.")
        }
    }

    fun diagnostics(): List<org.json.JSONObject> = try {
        val events = Diagnostics.recent(context, "watch", 50)
        (0 until events.length()).map { events.getJSONObject(it) }
    } catch (_: Exception) { emptyList() }

    var warnBeforeEnd: Boolean
        get() = prefs.warnBeforeEnd
        set(value) { prefs.warnBeforeEnd = value }
    var alertInDnd: Boolean
        get() = prefs.alertInDnd
        set(value) { prefs.alertInDnd = value }
    var permissionAsked: Boolean
        get() = prefs.permissionAsked
        set(value) { prefs.permissionAsked = value }

    private fun showTestResult(key: String, text: String) {
        _state.update { it.copy(testResult = key to text) }
        viewModelScope.launch {
            delay(4000)
            _state.update { if (it.testResult == key to text) it.copy(testResult = null) else it }
        }
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    /**
     * Runs one WorkStore action with a busy guard. Local save happens first; flush and runtime
     * start are best-effort afterwards. Failures keep the screen and editor in place.
     */
    private fun action(
        work: (WorkStore) -> Unit,
        haptic: Boolean = true,
        after: (WatchSnapshot) -> Unit = {},
        onError: ((Exception) -> Unit)? = null,
    ) {
        if (_state.value.busy) return
        if (demo != null) { _events.tryEmit(UiEvent.Confirm); return }
        generation++
        _state.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { WorkStore(context).use(work) }
                if (haptic) _events.tryEmit(UiEvent.Confirm)
                withContext(Dispatchers.IO) { flushQuietly() }
                val snapshot = startRuntime()
                applySnapshot(snapshot)
                after(snapshot)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                _events.tryEmit(UiEvent.Reject)
                // Storage failures get the "Not saved" dialog; refusals (frozen, review, stale) only buzz.
                if (onError != null) onError(error)
                else if (error !is SyncError || error.code == "storage") _state.update { it.copy(saveFailed = true) }
                android.util.Log.w("IronpathWatch", "Action refused", error)
            } finally {
                generation++
                _state.update { it.copy(busy = false) }
            }
        }
    }

    /** Arms alarms/notifications from the store and starts the rest service; returns the fresh view. */
    private suspend fun startRuntime(): WatchSnapshot = withContext(Dispatchers.IO) {
        val ok = try { RestRuntime.startFromUser(context) } catch (_: Exception) { false }
        _state.update { it.copy(serviceFailed = !ok) }
        RestRuntime.read(context)
    }

    private fun flushQuietly() {
        try { WorkClient.flush(context) } catch (error: Exception) { android.util.Log.i("IronpathWatch", "Flush deferred", error) }
    }

    companion object { const val UNDO_MS = 6000L }
}
