package com.ironpath.wearlink;

import android.content.Context;
import android.os.SystemClock;
import android.provider.Settings;

/** One reading of the device clocks. Elapsed/boot values never cross devices. */
public final class Clock {
    public final long elapsed, wall;
    public final int boot;

    public Clock(long elapsed, long wall, int boot) { this.elapsed = elapsed; this.wall = wall; this.boot = boot; }
    public static Clock now(Context c) { return new Clock(SystemClock.elapsedRealtime(), System.currentTimeMillis(), boot(c)); }
    public static int boot(Context c) {
        return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, 0);
    }
}
