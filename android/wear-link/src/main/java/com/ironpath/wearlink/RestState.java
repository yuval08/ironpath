package com.ironpath.wearlink;

import java.util.UUID;
import org.json.JSONObject;

/** Clock math is independent of Android lifecycle and never counts timer ticks. */
public final class RestState {
    public static JSONObject start(String command, String session, int seconds, long elapsed, long wall, int boot, boolean vibrate) throws Exception {
        if (seconds <= 0 || seconds > 86400) throw new IllegalArgumentException("Invalid rest duration");
        return new JSONObject().put("id", UUID.randomUUID().toString()).put("revision", 1)
            .put("source", command).put("sessionId", session).put("duration", seconds * 1000L)
            .put("endsElapsed", elapsed + seconds * 1000L).put("endsWall", wall + seconds * 1000L)
            .put("boot", boot).put("active", true).put("vibrate", vibrate);
    }
    public static long remaining(JSONObject timer, long elapsed) throws Exception {
        return timer != null && timer.optBoolean("active") ? Math.max(0, timer.getLong("endsElapsed") - elapsed) : 0;
    }
    public static JSONObject stop(JSONObject timer) throws Exception {
        return new JSONObject(timer.toString()).put("active", false).put("revision", timer.getLong("revision") + 1);
    }
    public static JSONObject extend(JSONObject timer, long elapsed) throws Exception {
        if (timer == null || !timer.optBoolean("active") || remaining(timer, elapsed) == 0)
            throw new IllegalStateException("Rest has already ended");
        if (timer.getLong("duration") + 15000 > 86400000) throw new IllegalStateException("Rest is too long");
        return new JSONObject(timer.toString()).put("revision", timer.getLong("revision") + 1)
            .put("duration", timer.getLong("duration") + 15000)
            .put("endsElapsed", timer.getLong("endsElapsed") + 15000).put("endsWall", timer.getLong("endsWall") + 15000);
    }
    public static JSONObject recover(JSONObject timer, long elapsed, long wall, int boot) throws Exception {
        if (timer == null || !timer.optBoolean("active") || timer.getInt("boot") == boot) return timer;
        long left = timer.getLong("endsWall") - wall;
        JSONObject next = new JSONObject(timer.toString()).put("boot", boot).put("revision", timer.getLong("revision") + 1);
        if (left <= 0 || left > timer.getLong("duration"))
            return next.put("active", false).put("recovery", "Rest ended while the watch restarted or its clock changed.");
        return next.put("endsElapsed", elapsed + left);
    }
}
