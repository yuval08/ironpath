package com.ironpath.watch.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.ui.tooling.preview.WearPreviewDevices
import androidx.wear.compose.ui.tooling.preview.WearPreviewFontScales
import com.ironpath.watch.state.Field
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.now.CurrentSetActions
import com.ironpath.watch.ui.now.CurrentSetScreen
import com.ironpath.watch.ui.now.RestActions
import com.ironpath.watch.ui.now.RestScreen
import com.ironpath.watch.ui.now.ValueAdjustScreen
import com.ironpath.watch.ui.pages.ExercisesPage
import com.ironpath.watch.ui.pages.ProgressPage
import com.ironpath.watch.ui.phase.ClosedScreen
import com.ironpath.watch.ui.phase.FinishingScreen
import com.ironpath.watch.ui.phase.IdleScreen
import com.ironpath.watch.ui.phase.UpdateNeededScreen
import com.ironpath.watch.ui.preview.Samples
import com.ironpath.watch.ui.settings.SettingsPrefs
import com.ironpath.watch.ui.settings.SettingsScreen
import com.ironpath.watch.ui.settings.SettingsActions
import com.ironpath.watch.ui.sync.ConflictReviewScreen
import com.ironpath.watch.ui.sync.SyncSheet
import com.ironpath.watch.ui.sync.WatchTimeText
import com.ironpath.watch.ui.theme.AmbientState
import com.ironpath.watch.ui.theme.IronpathTheme

/** Wraps a screen in the real theme + TimeText with the sample's sync state. */
@Composable
private fun Frame(state: WatchUiState, rest: Boolean = false, content: @Composable () -> Unit) {
    IronpathTheme {
        AppScaffold(timeText = { WatchTimeText(state.snapshot.syncState, if (rest) "1:24" else null, {}, {}) }) { content() }
    }
}

@WearPreviewDevices @WearPreviewFontScales @Composable
fun CurrentSetPreview() = Samples.state("set").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @Composable
fun CurrentSetEditedPreview() = Samples.state("edited").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @Composable
fun CurrentSetPerSidePreview() = Samples.state("perside").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @Composable
fun CurrentSetBandPreview() = Samples.state("band").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @Composable
fun CurrentSetReviewPreview() = Samples.state("review").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @Composable
fun UnsupportedPreview() = Samples.state("unsupported").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @Composable
fun AllDonePreview() = Samples.state("done").let { Frame(it) { CurrentSetScreen(it, CurrentSetActions()) } }

@WearPreviewDevices @WearPreviewFontScales @Composable
fun RestPreview() = Samples.state("rest").let { Frame(it) { RestScreen(it, it.snapshot.runningRest!!, false, RestActions()) } }

@WearPreviewDevices @Composable
fun AdjustWeightPreview() = Samples.state("set").let { Frame(it) { ValueAdjustScreen(it, Field.Weight) {} } }

@WearPreviewDevices @Composable
fun AdjustPerSidePreview() = Samples.state("perside").let { Frame(it) { ValueAdjustScreen(it, Field.RepsLeft) {} } }

@WearPreviewDevices @Composable
fun ExercisesPreview() = Samples.state("set").let { Frame(it) { ExercisesPage(it) {} } }

@WearPreviewDevices @Composable
fun ProgressPreview() = Samples.state("rest").let { Frame(it) { ProgressPage(it, {}, {}, {}) } }

/** All five sync states (§6 acceptance check). */
@Preview(device = "id:wearos_small_round", showSystemUi = true) @Composable
fun SyncSyncedPreview() = SyncPreview("synced")
@Preview(device = "id:wearos_small_round", showSystemUi = true) @Composable
fun SyncSavedPreview() = SyncPreview("saved")
@Preview(device = "id:wearos_small_round", showSystemUi = true) @Composable
fun SyncWaitingPreview() = SyncPreview("waiting")
@Preview(device = "id:wearos_small_round", showSystemUi = true) @Composable
fun SyncReviewPreview() = SyncPreview("review")
@Preview(device = "id:wearos_small_round", showSystemUi = true) @Composable
fun SyncUpdatePreview() = SyncPreview("update")

@Composable
private fun SyncPreview(name: String) = Samples.state(name).let { Frame(it) { SyncSheet(it.snapshot, true, false, {}, {}) } }

@WearPreviewDevices @Composable
fun ConflictPreview() = Samples.state("review").let { Frame(it) { ConflictReviewScreen(it.snapshot.conflicts, false, { _, _ -> }, {}) } }

@WearPreviewDevices @Composable
fun IdlePreview() = Samples.state("idle").let { Frame(it) { IdleScreen(false, {}, {}) } }

@WearPreviewDevices @Composable
fun FinishingPreview() = Samples.state("finishing").let { Frame(it) { FinishingScreen() } }

@WearPreviewDevices @Composable
fun ClosedPreview() = Samples.state("closed").let { Frame(it) { ClosedScreen(it.snapshot.closed, false) {} } }

@WearPreviewDevices @Composable
fun ClosedWarningPreview() = Samples.state("closedWarn").let { Frame(it) { ClosedScreen(it.snapshot.closed, false) {} } }

@WearPreviewDevices @Composable
fun UpdateNeededPreview() = Samples.state("update").let { Frame(it) { UpdateNeededScreen(it.snapshot.peer, false) {} } }

@WearPreviewDevices @WearPreviewFontScales @Composable
fun SettingsPreview() = Samples.state("set").let {
    Frame(it) { SettingsScreen(it.copy(notificationsOn = false), SettingsPrefs(false, true, {}, {}), "0.5.0", SettingsActions()) }
}

@WearPreviewDevices @Composable
fun AmbientRestPreview() = Samples.state("rest").let { IronpathTheme(AmbientState(isAmbient = true)) { AmbientScreen(it) } }

@WearPreviewDevices @Composable
fun AmbientSetPreview() = Samples.state("set").let { IronpathTheme(AmbientState(isAmbient = true)) { AmbientScreen(it) } }

