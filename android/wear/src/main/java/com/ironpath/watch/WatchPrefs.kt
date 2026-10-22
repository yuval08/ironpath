package com.ironpath.watch

import android.content.Context
import androidx.core.content.edit

/** Watch-only UI preferences (never synced). */
class WatchPrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("ironpath-watch-ui", Context.MODE_PRIVATE)

    /** One SegmentTick 10 s before rest ends, foreground only (§5.5, default off). */
    var warnBeforeEnd: Boolean
        get() = prefs.getBoolean("warnBeforeEnd", false)
        set(value) = prefs.edit { putBoolean("warnBeforeEnd", value) }

    /** Rest-end buzz uses alarm usage so Bedtime/DND does not silence it (§5.5, user's call). */
    var alertInDnd: Boolean
        get() = prefs.getBoolean("alertInDnd", true)
        set(value) = prefs.edit { putBoolean("alertInDnd", value) }

    /** The one-time "Allow wrist alerts?" dialog has been answered. */
    var permissionAsked: Boolean
        get() = prefs.getBoolean("permissionAsked", false)
        set(value) = prefs.edit { putBoolean("permissionAsked", value) }
}
