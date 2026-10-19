package com.ironpath.watch

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.*
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import com.ironpath.wearlink.*
import kotlinx.coroutines.*
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            var report by remember { mutableStateOf<JSONObject?>(null) }
            var busy by remember { mutableStateOf(false) }
            var message by remember { mutableStateOf<String?>(null) }
            var selected by remember { mutableStateOf<String?>(null) }
            var screen by remember { mutableStateOf("set") }
            var generation by remember { mutableIntStateOf(0) }
            var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
            var notifications by remember { mutableStateOf(NotificationManagerCompat.from(this).areNotificationsEnabled()) }
            var precise by remember { mutableStateOf(RestRuntime.precise(this)) }
            val scope = rememberCoroutineScope()
            val requestNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                notifications = it
                message = if (it) "Wrist alerts enabled." else "Notifications are off. The countdown still works on screen."
            }
            fun action(work: () -> Unit, after: () -> Unit = {}) {
                if (busy) return
                busy = true; generation++; message = null
                scope.launch {
                    var saved = false
                    try {
                        withContext(Dispatchers.IO) { work() }
                        saved = true
                        after()
                        try { withContext(Dispatchers.IO) { WorkClient.flush(applicationContext) } }
                        catch (_: Exception) { message = "Saved on your watch. Open your phone to sync." }
                        try { RestRuntime.startFromUser(this@MainActivity) }
                        catch (_: Exception) { message = "Saved. Keep Ironpath open for this rest; its background timer could not start." }
                        report = withContext(Dispatchers.IO) { WorkStore(applicationContext).use { it.inspect() } }
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        message = if (saved) "Action saved. Reopen Ironpath to refresh the screen."
                            else if (error is IllegalStateException || error is IllegalArgumentException) error.message ?: "Could not save this action."
                            else "Could not save this action. Check available watch storage and retry."
                    } finally { generation++; busy = false }
                }
            }
            LaunchedEffect(Unit) {
                lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    var resumed = false
                    while (true) {
                        val before = generation
                        try {
                            val next = withContext(Dispatchers.IO) {
                                WorkStore(applicationContext).use {
                                    if (!resumed) { it.retryReceivedCommands(); it.recoverRest(SystemClock.elapsedRealtime(), System.currentTimeMillis(), RestRuntime.boot(applicationContext)) }
                                    it.inspect()
                                }
                            }
                            if (!busy && before == generation) report = next
                            if (!resumed && next.optJSONObject("rest")?.optBoolean("active") == true) {
                                try { RestRuntime.startFromUser(this@MainActivity) }
                                catch (_: Exception) { message = "Keep the app open for the current rest." }
                            }
                            withContext(Dispatchers.IO) { WorkClient.flush(applicationContext) }
                            notifications = NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()
                            precise = RestRuntime.precise(this@MainActivity)
                            resumed = true
                        } catch (error: Exception) {
                            if (error is CancellationException) throw error
                            message = "Could not read saved workout. Retry or open your phone."
                        }
                        delay(1000)
                    }
                }
            }
            LaunchedEffect(Unit) {
                lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                    while (true) { now = SystemClock.elapsedRealtime(); delay(250) }
                }
            }
            val snapshot = report?.optJSONObject("snapshot")
            val steps = snapshot?.getJSONArray("steps")?.let { values -> (0 until values.length()).map { values.getJSONObject(it) } } ?: emptyList()
            val next = steps.firstOrNull { !it.getJSONObject("actual").getBoolean("completed") }
            val current = steps.firstOrNull { it.getString("setId") == selected } ?: next
            val timer = report?.optJSONObject("rest")
            val resting = timer?.optBoolean("active") == true
            LaunchedEffect(timer?.optString("id"), timer?.optLong("revision"), now / 1000) {
                if (timer?.optBoolean("active") == true && RestState.remaining(timer, SystemClock.elapsedRealtime()) == 0L) {
                    try { withContext(Dispatchers.IO) { RestRuntime.deliver(applicationContext, timer.getString("id"), timer.getLong("revision")) } }
                    catch (_: Exception) { message = "Rest ended. Wrist alert could not be delivered." }
                }
            }
            val control = report?.optJSONObject("control")
            val paused = control != null
            val pending = report?.getJSONArray("pending")?.length() ?: 0
            val blocked = report?.optBoolean("blocked") ?: false
            val editor = remember(current?.optString("setId"), screen, resting) { current?.let { SetInputs(it) } }
            MaterialTheme {
                Scaffold(timeText = { TimeText() }) {
                    ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
                        item { Text("Ironpath", style = MaterialTheme.typography.title2) }
                        if (message != null) item { Text(message!!, textAlign = TextAlign.Center) }
                        if (paused) {
                            item { Text(if (control?.optString("owner") == "closed") "Workout closed on phone" else "Phone has control", style = MaterialTheme.typography.title3, textAlign = TextAlign.Center) }
                            item { Text("Saved watch actions will sync. Send the workout from your phone to resume wrist logging.", textAlign = TextAlign.Center) }
                        } else if (resting) {
                            val seconds = (RestState.remaining(timer, now) + 999) / 1000
                            item { Text("Rest") }
                            item { Text("${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}", style = MaterialTheme.typography.display1) }
                            if (next != null) item { Text("Next: ${next.getString("name")}", textAlign = TextAlign.Center) }
                            item { Chip(onClick = { action({ WorkStore(applicationContext).use { it.editRest(true, SystemClock.elapsedRealtime()) } }) }, enabled = !busy, label = { Text("+15 seconds") }) }
                            item { Chip(onClick = { action({ WorkStore(applicationContext).use { it.editRest(false, SystemClock.elapsedRealtime()) } }) }, enabled = !busy, label = { Text("Skip rest") }) }
                        } else if (screen == "list") {
                            item { Text("Exercises", style = MaterialTheme.typography.title3) }
                            steps.groupBy { it.getString("prescriptionId") }.forEach { (_, group) ->
                                val first = group.firstOrNull { !it.getJSONObject("actual").getBoolean("completed") } ?: group.first()
                                item { Chip(onClick = { selected = first.getString("setId"); screen = "set" }, label = { Text(first.getString("name")) }) }
                            }
                        } else if (screen == "progress") {
                            val working = steps.filter { !it.getBoolean("isWarmUp") }
                            item { Text("${working.count { it.getJSONObject("actual").getBoolean("completed") }} / ${working.size} working sets", textAlign = TextAlign.Center) }
                            item { Text(if (pending == 0) "Actions synced" else "$pending actions saved on watch, waiting for phone", textAlign = TextAlign.Center) }
                        } else if (current != null) {
                            item { Text(current.getString("name"), style = MaterialTheme.typography.title3, textAlign = TextAlign.Center) }
                            item { Text(if (current.getBoolean("isWarmUp")) "Ramp set" else "Set ${current.getInt("workingNumber")} / ${current.getInt("workingTotal")}", textAlign = TextAlign.Center) }
                            item { Text("Target: ${current.getString("target")}", textAlign = TextAlign.Center) }
                            if (!current.isNull("band")) item { Text("Band: ${current.getString("band")}", textAlign = TextAlign.Center) }
                            val supported = current.getBoolean("supported") && snapshot?.has("sequences") == true
                            if (!supported) item { Text("Update the phone app and resend this workout. Unsupported exercise styles are logged on the phone.", textAlign = TextAlign.Center) }
                            else if (current.getJSONObject("actual").getBoolean("completed")) item { Text("Set completed") }
                            else if (editor != null) {
                                val enabled = !busy && !blocked
                                if (current.getString("entryStyle") == "repsPerSide") {
                                    item { Metric("Left reps", editor.left, 1.0, enabled) { editor.left = it } }
                                    item { Metric("Right reps", editor.right, 1.0, enabled) { editor.right = it } }
                                } else item { Metric("Reps", editor.reps, 1.0, enabled) { editor.reps = it } }
                                val suggestion = Regex("^(\\d+)").find(current.getString("target"))?.value?.toDoubleOrNull()
                                if (suggestion != null) item { Chip(onClick = {
                                    if (current.getString("entryStyle") == "repsPerSide") { editor.left = suggestion; editor.right = suggestion } else editor.reps = suggestion
                                }, enabled = enabled, label = { Text("Use ${number(suggestion)} ${if (current.getString("entryStyle") == "repsPerSide") "reps each side" else "reps"}") }) }
                                if (current.getString("loadType") in listOf("dumbbell", "barbell", "kettlebell", "machine")) item {
                                    Metric("Weight (${current.getString("unit")})", editor.weight, 0.5, enabled) { editor.weight = it }
                                }
                                item { Chip(enabled = enabled, onClick = {
                                    val id = current.getString("setId")
                                    action({ WorkStore(applicationContext).use { it.logSet(id, JSONObject(editor.expected), editor.changes(), SystemClock.elapsedRealtime(), System.currentTimeMillis(), RestRuntime.boot(applicationContext)) } }, { selected = null })
                                }, label = { Text("Complete set") }) }
                            }
                        } else item { Text(if (snapshot == null) "Open a workout on your phone and choose Send workout to watch." else "All sets completed. Finish on your phone.", textAlign = TextAlign.Center) }
                        if (timer?.has("recovery") == true) item { Text(timer.getString("recovery"), textAlign = TextAlign.Center) }
                        if (blocked) {
                            item { Text("Some watch actions could not be applied. Review your phone's values before continuing.", textAlign = TextAlign.Center) }
                            item { Chip(enabled = !busy && pending == 0, onClick = { action({ WorkStore(applicationContext).use { it.acceptPhoneValues() } }, { selected = null }) }, label = { Text("Use phone values") }) }
                        }
                        if (!paused && report?.optBoolean("canUndo") == true) item { Chip(onClick = { action({ WorkStore(applicationContext).use { it.undoLast() } }, { selected = null; screen = "set" }) }, enabled = !busy && !blocked, label = { Text("Undo last set") }) }
                        if (snapshot != null) {
                            item { Chip(onClick = { screen = if (screen == "list") "set" else "list"; selected = null }, label = { Text(if (screen == "list") "Current set" else "Exercises") }) }
                            item { Chip(onClick = { screen = if (screen == "progress") "set" else "progress" }, label = { Text(if (screen == "progress") "Current set" else "Progress & sync") }) }
                        }
                        if (pending > 0) item { Text("$pending pending · open phone to sync", textAlign = TextAlign.Center) }
                        if (!notifications) item { Chip(onClick = {
                            if (Build.VERSION.SDK_INT >= 33) requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                            else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                        }, label = { Text("Enable wrist alerts") }) }
                        if (!precise && Build.VERSION.SDK_INT >= 31) item { Chip(onClick = {
                            try { startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))) }
                            catch (_: Exception) { message = "Could not open precise-alert settings. Keep Ironpath open for accurate rests." }
                        }, label = { Text("Allow precise rest alerts") }) }
                        item { Chip(enabled = !busy && !resting, onClick = { action({ WorkStore(applicationContext).use { it.testRest(SystemClock.elapsedRealtime(), System.currentTimeMillis(), RestRuntime.boot(applicationContext)) } }) }, label = { Text("Test wrist alert") }) }
                        item { Chip(enabled = !busy, onClick = {
                            if (!busy) {
                                busy = true
                                scope.launch {
                                    try {
                                        val id = withContext(Dispatchers.IO) { LinkClient.ping(applicationContext, LinkProtocol.PHONE) }
                                        var confirmed = false
                                        repeat(10) {
                                            if (!confirmed) {
                                                delay(1000)
                                                val info = withContext(Dispatchers.IO) { LinkClient.inspect(applicationContext, LinkProtocol.PHONE) }
                                                val receipts = info.getJSONArray("receipts")
                                                confirmed = (0 until receipts.length()).any { receipts.getJSONObject(it).let { row -> row.getString("id") == id && row.getString("type") == "pong" } }
                                            }
                                        }
                                        message = if (confirmed) "Phone connection verified." else "No reply yet. Check phone pairing."
                                    } catch (error: Exception) { if (error is CancellationException) throw error; message = "Connection test failed. Check phone pairing." }
                                    finally { busy = false }
                                }
                            }
                        }, label = { Text("Test phone connection") }) }
                    }
                }
            }
        }
    }
}

private fun JSONObject.numberOrNull(key: String): Double? = if (isNull(key)) null else getDouble(key)
private fun number(value: Double): String = if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

private class SetInputs(step: JSONObject) {
    val expected = step.getJSONObject("actual").toString()
    private val state = JSONObject(expected)
    var reps by mutableStateOf(state.numberOrNull("reps"))
    var left by mutableStateOf(state.numberOrNull("repsLeft"))
    var right by mutableStateOf(state.numberOrNull("repsRight"))
    var weight by mutableStateOf(state.numberOrNull("weight"))
    fun changes(): JSONObject = JSONObject(expected).put("reps", reps ?: JSONObject.NULL)
        .put("repsLeft", left ?: JSONObject.NULL).put("repsRight", right ?: JSONObject.NULL).put("weight", weight ?: JSONObject.NULL)
}

@Composable private fun Metric(label: String, value: Double?, step: Double, enabled: Boolean, change: (Double?) -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
        Text("$label: ${value?.let(::number) ?: "not logged"}", textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { change(maxOf(0.0, (value ?: step) - step)) }, enabled = enabled) { Text("−") }
            Button(onClick = { change(minOf(100000.0, (value ?: 0.0) + step)) }, enabled = enabled) { Text("+") }
        }
    }
}
