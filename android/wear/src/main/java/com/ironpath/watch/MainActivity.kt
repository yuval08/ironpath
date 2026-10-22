package com.ironpath.watch

import android.Manifest
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.ambient.AmbientLifecycleObserver
import com.ironpath.watch.ui.IronpathWatchApp
import com.ironpath.watch.ui.PlatformActions
import com.ironpath.watch.ui.preview.DebugSeed
import com.ironpath.watch.ui.preview.Samples
import com.ironpath.watch.ui.theme.AmbientState
import com.ironpath.watch.ui.theme.IronpathTheme
import kotlinx.coroutines.launch

/** Hosts the Compose app, ambient mode and permission launchers. Everything else lives in the ViewModel. */
class MainActivity : ComponentActivity() {
    private val vm: WatchViewModel by viewModels()
    private var ambient by mutableStateOf(AmbientState())

    private val ambientObserver = AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            ambient = AmbientState(true, ambientDetails.burnInProtectionRequired, ambient.tick + 1)
        }
        override fun onUpdateAmbient() { ambient = ambient.copy(tick = ambient.tick + 1) }
        override fun onExitAmbient() { ambient = AmbientState(tick = ambient.tick + 1) }
    })

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        // Debug-only screenshot hook: `am start -n …/.MainActivity --es demo rest [--ei page 1] [--es route sync] [--ez ambient true]`.
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        val demo = intent.getStringExtra("demo")?.takeIf { debuggable }
        // Debug-only: `--ez seed true` loads a v2 snapshot into the real store (no phone needed).
        if (debuggable && intent.getBooleanExtra("seed", false)) runCatching { DebugSeed.seed(this) }
            .onFailure { android.util.Log.e("IronpathWatch", "Debug seed failed", it) }
        if (demo != null) {
            vm.useDemo(Samples.state(demo))
            if (intent.getBooleanExtra("ambient", false)) ambient = AmbientState(isAmbient = true)
        }
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        setContent {
            val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
            val platform = PlatformActions(
                versionName = versionName,
                requestNotifications = { requestNotifications { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) } },
                openExactAlarmSettings = ::openExactAlarmSettings,
                allowPrompts = demo == null,
            )
            IronpathTheme(ambient) {
                IronpathWatchApp(vm, platform, startPage = intent.getIntExtra("page", 0), startRoute = intent.getStringExtra("route"))
            }
        }
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { vm.poll() } }
    }

    override fun onResume() { super.onResume(); RestRuntime.foreground = true }
    override fun onPause() { RestRuntime.foreground = false; super.onPause() }

    private fun requestNotifications(launchPermission: () -> Unit) {
        if (Build.VERSION.SDK_INT >= 33) launchPermission()
        else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) return
        try { startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, "package:$packageName".toUri())) }
        catch (error: Exception) { android.util.Log.w("IronpathWatch", "Exact alarm settings unavailable", error) }
    }
}
