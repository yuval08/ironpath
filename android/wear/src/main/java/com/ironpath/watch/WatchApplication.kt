package com.ironpath.watch

import android.app.Application
import com.ironpath.wearlink.RestEffects

/** Supplies the watch's rest side effects to wear-link: re-arm from stored state after every commit. */
class WatchApplication : Application(), RestEffects.Provider {
    private val effects = RestEffects { context, _ ->
        try { RestRuntime.arm(context) }
        catch (error: Exception) { android.util.Log.e("IronpathTimer", "Could not re-arm rest", error) }
    }

    override fun restEffects(): RestEffects = effects
}
