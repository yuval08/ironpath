package com.ironpath.wearlink;

import java.util.UUID;
import org.json.JSONObject;

/**
 * v1 local timers (legacy mode and the watch test alert). Arithmetic is RestRules'; this wrapper keeps the
 * v1 record keys ({@code source}, {@code duration}, {@code revision == localRev}).
 */
public final class RestState {
    public static JSONObject start(String command, String session, int seconds, long elapsed, long wall, int boot, boolean vibrate) throws Exception {
        if (seconds <= 0 || seconds > 86400) throw new IllegalArgumentException("Invalid rest duration");
        JSONObject timer = RestRules.create(UUID.randomUUID().toString(), session, null, "watch", null, command,
            seconds * 1000L, elapsed, new Clock(elapsed, wall, boot), null, vibrate);
        return v1(timer.put("source", command).put("duration", seconds * 1000L).put("test", "test".equals(command)));
    }
    public static long remaining(JSONObject timer, long elapsed) throws Exception {
        return RestRules.remaining(timer, elapsed);
    }
    public static JSONObject stop(JSONObject timer) throws Exception {
        return v1(RestRules.end(timer, "ended"));
    }
    public static JSONObject extend(JSONObject timer, long elapsed) throws Exception {
        return adjust(timer, 15000, elapsed);
    }
    /** ± adjustment; throws when the rest already ended (never restarts an expired rest). */
    public static JSONObject adjust(JSONObject timer, long deltaMs, long elapsed) throws Exception {
        if (timer == null || RestRules.remaining(timer, elapsed) == 0) throw new SyncError("noRest", "Rest has already ended");
        if (RestRules.duration(timer) + deltaMs > RestRules.MAX_MS) throw new SyncError("invalid", "Rest is too long");
        long wallOffset = timer.getLong("endsWall") - timer.getLong("endsElapsed");
        RestRules.Result result = RestRules.adjust(timer, timer.getString("id"), deltaMs, new Clock(elapsed, elapsed + wallOffset, timer.optInt("boot")));
        return v1(result.current);
    }
    public static JSONObject recover(JSONObject timer, long elapsed, long wall, int boot) throws Exception {
        JSONObject next = RestRules.recover(timer, new Clock(elapsed, wall, boot));
        return next == timer || next == null ? next : v1(next);
    }
    /** v1 readers key alarms by {@code revision}. */
    private static JSONObject v1(JSONObject timer) throws Exception {
        return timer.put("revision", timer.getLong("localRev"));
    }
}
