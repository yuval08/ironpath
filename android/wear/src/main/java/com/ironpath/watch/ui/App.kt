package com.ironpath.watch.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.wear.compose.foundation.LocalReduceMotion
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.PagerState
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.AnimatedPage
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.FailureConfirmationDialog
import androidx.wear.compose.material3.HorizontalPagerScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.curvedText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.ironpath.watch.UiEvent
import com.ironpath.watch.WatchViewModel
import com.ironpath.watch.state.Field
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.Phase
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.components.rememberNow
import com.ironpath.watch.ui.now.CurrentSetActions
import com.ironpath.watch.ui.now.CurrentSetScreen
import com.ironpath.watch.ui.now.RestActions
import com.ironpath.watch.ui.now.RestScreen
import com.ironpath.watch.ui.now.ValueAdjustScreen
import com.ironpath.watch.ui.pages.ExercisesPage
import com.ironpath.watch.ui.pages.ProgressPage
import com.ironpath.watch.ui.phase.ClosedScreen
import com.ironpath.watch.ui.phase.ErrorScreen
import com.ironpath.watch.ui.phase.FinishingScreen
import com.ironpath.watch.ui.phase.IdleScreen
import com.ironpath.watch.ui.phase.UpdateNeededScreen
import com.ironpath.watch.ui.settings.DiagnosticsScreen
import com.ironpath.watch.ui.settings.SettingsActions
import com.ironpath.watch.ui.settings.SettingsPrefs
import com.ironpath.watch.ui.settings.SettingsScreen
import com.ironpath.watch.ui.sync.ConflictReviewScreen
import com.ironpath.watch.ui.sync.SyncSheet
import com.ironpath.watch.ui.sync.WatchTimeText
import com.ironpath.watch.ui.theme.LocalAmbient
import kotlinx.coroutines.launch

/** Things only the Activity can do (permission requests, system settings). */
data class PlatformActions(
    val versionName: String,
    val requestNotifications: () -> Unit,
    val openExactAlarmSettings: () -> Unit,
    /** False in the debug demo so the one-time permission dialog stays out of screenshots. */
    val allowPrompts: Boolean = true,
)

private object Routes {
    const val WORKOUT = "workout"
    const val ADJUST = "adjust/{field}"
    const val SYNC = "sync"
    const val REVIEW = "review"
    const val SETTINGS = "settings"
    const val DIAGNOSTICS = "diagnostics"
    fun adjust(field: Field) = "adjust/${field.key}"
    /** Routes that edit the live workout and must close when the phase leaves Active. */
    val WORKOUT_ONLY = setOf(ADJUST, REVIEW)
}

/** Root: AppScaffold (shared TimeText) → SwipeDismissableNavHost. The start route renders by phase. */
@Composable
fun IronpathWatchApp(vm: WatchViewModel, platform: PlatformActions, startPage: Int = 0, startRoute: String? = null) {
    val state by vm.state.collectAsStateWithLifecycle()
    val nav = rememberSwipeDismissableNavController()
    val pager = rememberPagerState(initialPage = startPage) { 3 }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val route = nav.currentBackStackEntryFlow.collectAsStateWithLifecycle(null).value?.destination?.route

    LaunchedEffect(vm) {
        vm.events.collect { event ->
            when (event) {
                UiEvent.Confirm -> haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                UiEvent.Reject -> haptics.performHapticFeedback(HapticFeedbackType.Reject)
                is UiEvent.Adjust -> nav.navigate(Routes.adjust(event.field))
                UiEvent.ShowNow -> pager.animateScrollToPage(0)
            }
        }
    }
    // Phase changes never stack: a freeze/close while on S3/S8 pops back to the phase screen.
    LaunchedEffect(state.phase, route) {
        if (state.phase != Phase.Active && route in Routes.WORKOUT_ONLY) nav.popBackStack(Routes.WORKOUT, inclusive = false)
    }
    LaunchedEffect(startRoute) { startRoute?.let { nav.navigate(it) } }

    Box {
        AppScaffold(timeText = { TimeTextFor(state, route, pager, nav, onRest = {
            nav.popBackStack(Routes.WORKOUT, inclusive = false)
            vm.showRest()
            scope.launch { pager.animateScrollToPage(0) }
        }) }) {
            SwipeDismissableNavHost(nav, startDestination = Routes.WORKOUT) {
                composable(Routes.WORKOUT) { WorkoutRoute(state, vm, nav, pager, platform) }
                composable(Routes.ADJUST) { entry ->
                    val field = Field.of(entry.arguments?.getString("field").orEmpty()) ?: Field.Reps
                    ValueAdjustScreen(state, field) { values ->
                        state.currentStep?.let { vm.setValues(it, values) }
                        nav.popBackStack()
                    }
                }
                composable(Routes.SYNC) {
                    SyncSheet(state.snapshot, state.notificationsOn, state.busy, onRetry = vm::refresh, onReview = { nav.navigate(Routes.REVIEW) })
                }
                composable(Routes.REVIEW) {
                    ConflictReviewScreen(state.snapshot.conflicts, state.busy, onResolve = vm::resolve, onDone = { nav.popBackStack() })
                }
                composable(Routes.SETTINGS) {
                    SettingsScreen(state, SettingsPrefs(vm.warnBeforeEnd, vm.alertInDnd, { vm.warnBeforeEnd = it }, { vm.alertInDnd = it }),
                        platform.versionName, SettingsActions(
                            onAllowNotifications = platform.requestNotifications,
                            onAllowPrecise = platform.openExactAlarmSettings,
                            onTestAlert = vm::testAlert,
                            onTestConnection = vm::testConnection,
                            onDiagnostics = { nav.navigate(Routes.DIAGNOSTICS) },
                        ))
                }
                composable(Routes.DIAGNOSTICS) { DiagnosticsScreen(vm::diagnostics) }
            }
            FailureConfirmationDialog(visible = state.saveFailed, onDismissRequest = vm::dismissSaveFailure,
                curvedText = { curvedText("Not saved") })
            if (platform.allowPrompts) PermissionDialog(state, vm, platform)
        }
        if (LocalAmbient.current.isAmbient) AmbientScreen(state)
    }
}

/** Clock + sync dot; the rest countdown joins it when rest runs off-screen. */
@Composable
private fun TimeTextFor(state: WatchUiState, route: String?, pager: PagerState, nav: NavHostController, onRest: () -> Unit) {
    val rest = state.snapshot.runningRest
    val onRestScreen = route == Routes.WORKOUT && pager.currentPage == 0 && state.showRest
    val now = rememberNow(periodMs = 1000)
    WatchTimeText(
        sync = state.snapshot.syncState,
        restText = if (rest != null && !onRestScreen && state.phase == Phase.Active) Format.clock(rest.remainingAt(now)) else null,
        onSync = { if (route != Routes.SYNC) nav.navigate(Routes.SYNC) },
        onRest = onRest,
    )
}

/** The `workout` route: one screen per phase, crossfaded and never pushed on the back stack. */
@Composable
private fun WorkoutRoute(state: WatchUiState, vm: WatchViewModel, nav: NavHostController, pager: PagerState, platform: PlatformActions) {
    val spec = if (LocalReduceMotion.current) snap() else tween<Float>(250)
    Crossfade(targetState = if (state.loaded) state.phase else null, animationSpec = spec, label = "phase") { phase ->
        when (phase) {
            null -> Unit
            Phase.Idle -> IdleScreen(state.busy, vm::refresh) { nav.navigate(Routes.SETTINGS) }
            Phase.Active -> ActivePager(state, vm, nav, pager)
            Phase.Finishing -> FinishingScreen()
            Phase.PhoneControl -> FinishingScreen(phoneControl = true, closedOnPhone = state.snapshot.legacy?.controlOwner == "closed")
            Phase.Closed -> ClosedScreen(state.snapshot.closed, state.busy, vm::clearClosed)
            Phase.UpdateNeeded -> UpdateNeededScreen(state.snapshot.peer, state.busy, vm::acknowledgeUpdate)
            Phase.Error -> ErrorScreen(state.busy, vm::refresh)
        }
    }
}

/** Active workout: Now (Current set or Rest) · Exercises · Progress. */
@Composable
private fun ActivePager(state: WatchUiState, vm: WatchViewModel, nav: NavHostController, pager: PagerState) {
    val scope = rememberCoroutineScope()
    val spec = if (LocalReduceMotion.current) snap() else tween<Float>(250)
    HorizontalPagerScaffold(pagerState = pager) {
        HorizontalPager(state = pager) { page ->
            AnimatedPage(page, pager) {
                when (page) {
                    0 -> Crossfade(targetState = state.showRest, animationSpec = spec, label = "now") { resting ->
                        val rest = state.snapshot.runningRest
                        if (resting && rest != null) RestScreen(state, rest, vm.warnBeforeEnd,
                            RestActions(onAdjust = vm::adjustRest, onSkip = vm::skipRest, onPeek = vm::peekNext, onUndo = vm::undo))
                        else CurrentSetScreen(state, CurrentSetActions(
                            onAdjust = { nav.navigate(Routes.adjust(it)) },
                            onDone = vm::submit,
                            onNext = vm::skipUnsupported,
                            onReview = { nav.navigate(Routes.REVIEW) },
                            onExercises = { scope.launch { pager.animateScrollToPage(1) } },
                            onUndo = vm::undo,
                        ))
                    }
                    1 -> ExercisesPage(state, vm::selectExercise)
                    else -> ProgressPage(state, onUndo = vm::undo, onSync = { nav.navigate(Routes.SYNC) },
                        onSettings = { nav.navigate(Routes.SETTINGS) })
                }
            }
        }
    }
}

/** One-time "Allow wrist alerts?" at the first active workout with alerts unavailable. */
@Composable
private fun PermissionDialog(state: WatchUiState, vm: WatchViewModel, platform: PlatformActions) {
    var asked by remember { mutableStateOf(vm.permissionAsked) }
    val visible = !asked && state.phase == Phase.Active && (!state.notificationsOn || !state.preciseOn)
    fun answer(allow: Boolean) {
        asked = true
        vm.permissionAsked = true
        if (allow) { if (!state.notificationsOn) platform.requestNotifications() else platform.openExactAlarmSettings() }
    }
    AlertDialog(
        visible = visible,
        onDismissRequest = { answer(false) },
        confirmButton = { AlertDialogDefaults.ConfirmButton(onClick = { answer(true) }) },
        dismissButton = { AlertDialogDefaults.DismissButton(onClick = { answer(false) }) },
        title = { Text("Allow wrist alerts?") },
        text = { Text("Rest timers buzz your wrist when they end.") },
    )
}
