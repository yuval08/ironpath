package com.ironpath.wearlink;

import org.json.JSONObject;

/**
 * Pure rest-timer rules shared by the phone coordinator and the watch (design §3.1). Every change bumps
 * {@code localRev}, so alarms and claims keyed by (id, localRev) can never act on a newer revision.
 * Timer record: {id, revision, localRev, sessionId, epoch, state, active, origin, originDevice, sourceOp,
 * durationMs, startElapsed, endsElapsed, endsWall, boot, next, vibrate, alert, uncertain, recovery, test}.
 */
public final class RestRules {
    public static final long MAX_MS = 86_400_000L;

    /** Outcome of one rule: the timer that is now current (may be null) and what happened to the op. */
    public static final class Result {
        public final JSONObject current;   // the current timer after the rule
        public final JSONObject replaced;  // a timer that left "current" (replaced/superseded), or null
        public final String outcome;       // applied | stale | superseded | expired | rejected
        public Result(JSONObject current, JSONObject replaced, String outcome) {
            this.current = current; this.replaced = replaced; this.outcome = outcome;
        }
        public boolean changed() { return !outcome.equals("stale") && !outcome.equals("rejected"); }
    }

    private RestRules() { }

    public static JSONObject create(String id, String sessionId, String epoch, String origin, String originDevice,
                                    String sourceOp, long durationMs, long startElapsed, Clock now, JSONObject next,
                                    boolean vibrate) throws Exception {
        if (durationMs < 0 || durationMs > MAX_MS) throw new IllegalArgumentException("Invalid rest duration");
        long ends = startElapsed + durationMs;
        return new JSONObject().put("id", id).put("revision", JSONObject.NULL).put("localRev", 1)
            .put("sessionId", nullable(sessionId)).put("epoch", nullable(epoch)).put("state", "running").put("active", true)
            .put("origin", origin).put("originDevice", nullable(originDevice)).put("sourceOp", nullable(sourceOp))
            .put("durationMs", durationMs).put("startElapsed", startElapsed).put("endsElapsed", ends)
            .put("endsWall", now.wall + (ends - now.elapsed)).put("boot", now.boot)
            .put("next", next == null ? JSONObject.NULL : next).put("vibrate", vibrate)
            .put("uncertain", false).put("recovery", JSONObject.NULL).put("test", false);
    }

    /** Running in the stored sense (not ended/skipped/...); a running timer may still have 0 ms left. */
    public static boolean running(JSONObject timer) {
        return timer != null && "running".equals(state(timer));
    }
    /** v1 records only carry {@code active}. */
    static String state(JSONObject timer) {
        return timer.has("state") ? timer.optString("state") : timer.optBoolean("active") ? "running" : "ended";
    }
    public static long remaining(JSONObject timer, long elapsed) throws Exception {
        return running(timer) ? Math.max(0, timer.getLong("endsElapsed") - elapsed) : 0;
    }
    static long duration(JSONObject timer) {
        return timer.has("durationMs") ? timer.optLong("durationMs") : timer.optLong("duration");
    }

    public static Result start(JSONObject current, JSONObject candidate, long nowElapsed) throws Exception {
        if (running(current) && !current.getString("id").equals(candidate.getString("id"))
            && current.getLong("startElapsed") > candidate.getLong("startElapsed"))
            return new Result(current, end(candidate, "replaced"), "superseded");
        JSONObject replaced = running(current) && !current.getString("id").equals(candidate.getString("id"))
            ? end(current, "replaced") : null;
        if (candidate.getLong("endsElapsed") <= nowElapsed) return new Result(end(candidate, "ended"), replaced, "expired");
        return new Result(candidate, replaced, "applied");
    }

    /** ends = max(now, ends + delta); a deduction to zero expires the timer at once (alerts once). */
    public static Result adjust(JSONObject current, String timerId, long deltaMs, Clock now) throws Exception {
        if (current == null || !current.optString("id").equals(timerId)) return new Result(current, null, "stale");
        String state = state(current);
        if (remaining(current, now.elapsed) == 0) {
            // Adding time to a rest that just ran out restarts it with that much time; skipped/cancelled stay closed.
            if (deltaMs <= 0 || !(state.equals("running") || state.equals("ended"))) return new Result(current, null, "stale");
            long duration = clamp(deltaMs), ends = now.elapsed + duration;
            JSONObject next = bump(current).put("state", "running").put("active", true).put("startElapsed", now.elapsed)
                .put("endsElapsed", ends).put("endsWall", now.wall + duration).put("uncertain", false).put("recovery", JSONObject.NULL);
            next.remove("reason");
            putDuration(next, duration);
            return new Result(next, null, "applied");
        }
        long ends = Math.max(now.elapsed, current.getLong("endsElapsed") + deltaMs);
        long duration = clamp(duration(current) + (ends - current.getLong("endsElapsed")));
        ends = Math.min(ends, current.optLong("startElapsed", ends - duration) + duration);
        JSONObject next = bump(current).put("endsElapsed", ends).put("endsWall", now.wall + (ends - now.elapsed));
        putDuration(next, duration);
        return new Result(next, null, "applied");
    }
    public static Result skip(JSONObject current, String timerId) throws Exception {
        if (!isCurrent(current, timerId)) return new Result(current, null, "stale");
        return new Result(end(current, "skipped"), null, "applied");
    }
    /** Cancels only the rest started by {@code sourceOp} (undo). */
    public static Result cancel(JSONObject current, String sourceOp) throws Exception {
        if (!running(current) || sourceOp == null || !sourceOp.equals(current.optString("sourceOp", current.optString("source"))))
            return new Result(current, null, "stale");
        return new Result(end(current, "cancelled"), null, "applied");
    }
    /** {@code null} closes any session. */
    public static Result closeSession(JSONObject current, String sessionIdOrNull) throws Exception {
        if (!running(current) || (sessionIdOrNull != null && !sessionIdOrNull.equals(current.optString("sessionId", null))))
            return new Result(current, null, "stale");
        return new Result(end(current, "cancelled").put("reason", "closed"), null, "applied");
    }
    public static JSONObject end(JSONObject timer, String state) throws Exception {
        return bump(timer).put("state", state).put("active", false);
    }
    /**
     * Reboot recovery: re-anchor from endsWall when plausible, otherwise end with recovery text and
     * uncertain:true. Expired rests are never replayed.
     */
    public static JSONObject recover(JSONObject timer, Clock now) throws Exception {
        if (!running(timer) || timer.getInt("boot") == now.boot) return timer;
        long left = timer.getLong("endsWall") - now.wall;
        JSONObject next = bump(timer).put("boot", now.boot);
        if (left <= 0 || left > duration(timer))
            return next.put("state", "ended").put("active", false).put("uncertain", true)
                .put("recovery", "Rest ended while the device restarted or its clock changed.");
        return next.put("endsElapsed", now.elapsed + left).put("startElapsed", now.elapsed + left - duration(timer));
    }

    static boolean isCurrent(JSONObject timer, String timerId) {
        return running(timer) && timer.optString("id").equals(timerId);
    }
    static JSONObject bump(JSONObject timer) throws Exception {
        long localRev = timer.has("localRev") ? timer.getLong("localRev") : timer.optLong("revision", 0);
        return new JSONObject(timer.toString()).put("localRev", localRev + 1);
    }
    private static void putDuration(JSONObject timer, long duration) throws Exception {
        timer.put("durationMs", duration);
        if (timer.has("duration")) timer.put("duration", duration);
    }
    private static long clamp(long value) { return Math.max(0, Math.min(MAX_MS, value)); }
    private static Object nullable(Object value) { return value == null ? JSONObject.NULL : value; }
}
