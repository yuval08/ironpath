package com.ironpath.wearlink;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Build;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Durable transport queues and sync state for both roles. User commands are never stored in, or pruned
 * like, diagnostics. Schema 2 adds {@code packets.meta}; v1 rows keep draining on /work/v1.
 */
public final class WorkStore implements AutoCloseable {
    public static final int MAX_QUEUED = 200;
    public static final int MAX_REST_OPS = 50;
    static final int SCHEMA = 2;
    static final int MAX_CLOSED_SESSIONS = 20;
    static final String[] FEATURES = {"mutations2", "rest2", "diag1", "resolve1"};
    private final Context context;
    private final Helper helper;
    /** Tests pin the clock; production reads the device clocks. */
    Clock fixedClock;

    /**
     * One open database per file per process. The listener service, the plugins and the watch UI all share
     * it, so SQLite sees a single connection and Android serializes every transaction on it (no
     * SQLITE_BUSY races between separately opened connections).
     */
    private static final java.util.WeakHashMap<Context, java.util.Map<String, Helper>> HELPERS = new java.util.WeakHashMap<>();
    private static synchronized Helper helper(Context app, String name) {
        return HELPERS.computeIfAbsent(app, k -> new java.util.HashMap<>()).computeIfAbsent(name, n -> new Helper(app, n));
    }

    public WorkStore(Context context) { this(context, "wear-workouts.db"); }
    WorkStore(Context context, String name) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        this.helper = helper(this.context, name);
    }
    /** Releases this handle only; the shared database stays open for the process. */
    @Override public void close() { }
    SQLiteDatabase getReadableDatabase() { return helper.getReadableDatabase(); }
    SQLiteDatabase getWritableDatabase() { return helper.getWritableDatabase(); }

    private static final class Helper extends SQLiteOpenHelper {
        private final Context context;
        Helper(Context context, String name) { super(context, name, null, SCHEMA); this.context = context; }
        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE packets (direction TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, "
                + "peer TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, meta TEXT, PRIMARY KEY(direction,type,id))");
            db.execSQL("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
            set(db, "schema", Integer.toString(SCHEMA));
        }
        /** 1 → 2: add packets.meta. Nothing is dropped: device identity and sequences carry over. */
        @Override public void onUpgrade(SQLiteDatabase db, int from, int to) {
            if (from != 1 || to != 2) throw new IllegalStateException("Missing migration");
            db.execSQL("ALTER TABLE packets ADD COLUMN meta TEXT");
            set(db, "schema", "2");
            try {
                Diagnostics.record(context, "sync.migration", new JSONObject().put("data", new JSONObject().put("from", from).put("to", to)
                    .put("pendingV1", countAll(db, "out", "command") + countAll(db, "in", "command") + countAll(db, "out", "control"))));
            } catch (Exception ignored) { /* diagnostics are best effort */ }
        }
    }
    Clock now() { return fixedClock != null ? fixedClock : Clock.now(context); }

    // ---- state helpers ----
    String value(SQLiteDatabase db, String key) {
        try (Cursor c = db.rawQuery("SELECT value FROM state WHERE key=?", new String[]{key})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }
    static void set(SQLiteDatabase db, String key, String value) {
        ContentValues row = new ContentValues(); row.put("key", key); row.put("value", value);
        db.insertWithOnConflict("state", null, row, SQLiteDatabase.CONFLICT_REPLACE);
    }
    void delete(SQLiteDatabase db, String key) { db.delete("state", "key=?", new String[]{key}); }
    JSONObject object(SQLiteDatabase db, String key) throws Exception {
        String text = value(db, key); return text == null ? null : new JSONObject(text);
    }
    private JSONObject savedSnapshot(SQLiteDatabase db) throws Exception { return object(db, "snapshot"); }
    private JSONObject baseSnapshot(SQLiteDatabase db) throws Exception {
        String text = value(db, "baseSnapshot");
        return text == null ? savedSnapshot(db) : new JSONObject(text);
    }
    private JSONArray effects(SQLiteDatabase db) throws Exception {
        String text = value(db, "effects"); return text == null ? new JSONArray() : new JSONArray(text);
    }
    private static boolean v2(JSONObject snapshot) { return snapshot != null && snapshot.optInt("protocolVersion") == 2; }
    private boolean shared(SQLiteDatabase db) throws Exception { return v2(savedSnapshot(db)); }
    /** Watch identity (shared by v1 and v2 sequences). */
    String device(SQLiteDatabase db) {
        String device = value(db, "device");
        if (device == null) { device = UUID.randomUUID().toString(); set(db, "device", device); }
        return device;
    }
    /** Phone identity sent in hello. */
    String installId(SQLiteDatabase db) {
        String id = value(db, "installId");
        if (id == null) { id = UUID.randomUUID().toString(); set(db, "installId", id); }
        return id;
    }
    private JSONArray pendingActions() throws Exception {
        JSONArray rows = packets("out", "command");
        JSONArray mutations = packets("out", "mutation");
        for (int i = 0; i < mutations.length(); i++) rows.put(mutations.get(i));
        return rows;
    }
    private void project(SQLiteDatabase db) throws Exception {
        JSONObject base = baseSnapshot(db);
        if (base == null) return;
        JSONObject projected = WatchProjection.project(base, effects(db), pendingActions());
        set(db, "snapshot", projected.getJSONObject("snapshot").toString());
        set(db, "blocked", Boolean.toString(projected.getBoolean("blocked")));
    }
    private boolean blocked(SQLiteDatabase db) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM packets WHERE direction='in' AND type='result' AND state IN ('rejected','conflict')", null)) {
            c.moveToFirst(); return c.getInt(0) > 0 || "true".equals(value(db, "blocked"));
        }
    }
    /** Runs {@code work} in one transaction (nested calls join the outer one). */
    <T> T write(Work<T> work) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try { T result = work.run(db); db.setTransactionSuccessful(); return result; }
        finally { db.endTransaction(); }
    }
    interface Work<T> { T run(SQLiteDatabase db) throws Exception; }

    // ---- rest (watch) ----
    /** The raw stored timer record (design §3.1); see inspect().rest for the UI view. */
    public JSONObject rest() throws Exception {
        String text = value(getReadableDatabase(), "rest"); return text == null ? null : new JSONObject(text);
    }
    public void testRest(long elapsed, long wall, int boot) throws Exception {
        write(db -> {
            JSONObject timer = rest();
            if (timer != null && RestRules.running(timer) && RestRules.remaining(timer, elapsed) > 0)
                throw new SyncError("test", "Finish or skip the current rest before testing alerts.");
            set(db, "rest", RestState.start("test", "test", 3, elapsed, wall, boot, true).toString());
            return null;
        });
    }
    public JSONObject recoverRest(long elapsed, long wall, int boot) throws Exception {
        return write(db -> {
            JSONObject before = rest();
            // Shared timers keep their authoritative revision; only v1/test timers mirror revision = localRev.
            JSONObject timer = sharedTimer(before) ? RestRules.recover(before, new Clock(elapsed, wall, boot)) : RestState.recover(before, elapsed, wall, boot);
            if (timer != null && timer != before) {
                set(db, "rest", timer.toString());
                Diagnostics.record(context, "rest.recovered", new JSONObject().put("timerId", timer.optString("id"))
                    .put("data", new JSONObject().put("uncertain", timer.optBoolean("uncertain")).put("remainingMs", RestRules.remaining(timer, elapsed))));
            }
            return timer;
        });
    }
    /** Shared-mode timers carry the workout epoch; v1/test timers do not. */
    private static boolean sharedTimer(JSONObject timer) { return timer != null && timer.has("epoch") && !timer.isNull("epoch"); }
    public void editRest(int deltaSeconds, long elapsed) throws Exception {
        if (deltaSeconds == 0 || Math.abs(deltaSeconds) > 3600) throw new SyncError("invalid", "Invalid rest change");
        write(db -> {
            JSONObject timer = rest();
            if (timer == null) throw new SyncError("noRest", "No rest to change");
            if (!sharedTimer(timer)) { set(db, "rest", RestState.adjust(timer, deltaSeconds * 1000L, elapsed).toString()); return null; }
            Clock clock = clockAt(elapsed);
            RestRules.Result result = RestRules.adjust(timer, timer.getString("id"), deltaSeconds * 1000L, clock);
            if (!result.changed()) throw new SyncError("noRest", "Rest has already ended");
            JSONObject op = restOp(db, "adjust", timer, null, deltaSeconds * 1000L, null, "user", null, clock, true);
            set(db, "rest", result.current.toString());
            recordRestOp(op, "applied");
            queueStatus(db);
            return null;
        });
    }
    public void skipRest(long elapsed) throws Exception {
        write(db -> {
            JSONObject timer = rest();
            if (!sharedTimer(timer)) {
                if (timer == null) throw new SyncError("noRest", "No rest to skip");
                set(db, "rest", RestState.stop(timer).toString()); return null;
            }
            if (!RestRules.running(timer)) throw new SyncError("noRest", "Rest has already ended");
            JSONObject op = restOp(db, "skip", timer, null, null, null, "user", null, clockAt(elapsed), true);
            set(db, "rest", RestRules.skip(timer, timer.getString("id")).current.toString());
            recordRestOp(op, "applied");
            queueStatus(db);
            return null;
        });
    }
    /** Ends the timer exactly once for its (id, localRev); stale callbacks get null. */
    public JSONObject claimRest(String id, long localRev, long elapsed) throws Exception {
        return write(db -> {
            JSONObject timer = rest();
            if (!RestRules.running(timer) || !timer.getString("id").equals(id)
                || timer.optLong("localRev", timer.optLong("revision")) != localRev || RestRules.remaining(timer, elapsed) > 0) return null;
            set(db, "rest", (sharedTimer(timer) ? RestRules.end(timer, "ended") : RestState.stop(timer)).toString());
            return timer;
        });
    }
    /** After RestRuntime.arm(): tell the phone whether the wrist alert for this revision is armed. */
    public void reportArmed(String timerId, long localRev, boolean armed, String reason, boolean exact) throws Exception {
        write(db -> {
            JSONObject timer = rest();
            if (timer == null || !timer.getString("id").equals(timerId) || timer.optLong("localRev", timer.optLong("revision")) != localRev) return null;
            set(db, "restArmedLocal", new JSONObject().put("timerId", timerId).put("localRev", localRev).put("armed", armed)
                .put("reason", reason == null ? "ok" : reason).put("exact", exact).toString());
            Diagnostics.record(context, "rest.armed", new JSONObject().put("timerId", timerId)
                .put("revision", timer.opt("revision") instanceof Number ? timer.get("revision") : JSONObject.NULL)
                .put("data", new JSONObject().put("armed", armed).put("reason", reason).put("exact", exact)));
            String peer = value(db, "watchPeer");
            if (!sharedTimer(timer) || peer == null || !(timer.opt("revision") instanceof Number)) return null;
            boolean pendingOps = countState(db, "out", "restOp", null) > 0;
            String wireReason = pendingOps ? "pendingOps" : reason == null ? "ok" : reason;
            if (!java.util.Arrays.asList("ok", "notificationsOff", "channelOff", "exactDenied", "serviceFailed", "pendingOps").contains(wireReason))
                wireReason = "serviceFailed";
            JSONObject body = new JSONObject().put("deviceId", device(db)).put("timerId", timerId).put("revision", timer.getLong("revision"))
                .put("armed", armed && !pendingOps).put("reason", wireReason).put("exact", exact);
            replace(db, peer, new WorkProtocol(2, UUID.randomUUID().toString(), "restArmed", body), null);
            return null;
        });
    }
    public void recordFeedback(String timerId, boolean felt) {
        try { Diagnostics.record(context, "rest.feedback", new JSONObject().put("timerId", timerId).put("data", new JSONObject().put("felt", felt))); }
        catch (Exception ignored) { /* diagnostics only */ }
    }
    private Clock clockAt(long elapsed) { Clock clock = now(); return new Clock(elapsed, clock.wall + (elapsed - clock.elapsed), clock.boot); }

    /**
     * Queues a restOp (watch→phone). The wire clock is a placeholder; WorkClient.flush rebuilds it from the
     * meta anchor at every send. Returns the body, or null when the queue is full and {@code required} is false.
     */
    private JSONObject restOp(SQLiteDatabase db, String op, JSONObject timer, Long durationMs, Long deltaMs, String sourceOp,
                              String reason, JSONObject next, Clock clock, boolean required) throws Exception {
        String peer = value(db, "watchPeer");
        JSONObject snapshot = savedSnapshot(db);
        if (peer == null || snapshot == null) throw new SyncError("noWorkout", "Send a workout from your phone first.");
        if (countAll(db, "out", "restOp") >= MAX_REST_OPS) {
            Diagnostics.record(context, "sync.queueFull", new JSONObject().put("data", new JSONObject().put("type", "restOp").put("count", MAX_REST_OPS)));
            if (required) throw new SyncError("queueFull", "Open your phone to sync before changing the rest.");
            return null;
        }
        long sequence = Long.parseLong(valueOr(db, "restSequence", "0")) + 1;
        String last = value(db, "restLastRevision");
        JSONObject body = new JSONObject().put("protocolVersion", 2).put("opId", UUID.randomUUID().toString())
            .put("deviceId", device(db)).put("restSequence", sequence).put("epoch", snapshot.getString("epoch"))
            .put("sessionId", snapshot.getString("sessionId")).put("op", op).put("timerId", timer.getString("id"))
            .put("baseRevision", last == null ? JSONObject.NULL : Long.parseLong(last))
            .put("durationMs", durationMs == null ? JSONObject.NULL : durationMs).put("deltaMs", deltaMs == null ? JSONObject.NULL : deltaMs)
            .put("sourceOp", sourceOp == null ? JSONObject.NULL : sourceOp).put("reason", reason)
            .put("next", next == null ? JSONObject.NULL : next).put("clock", new JSONObject().put("ageMs", 0).put("uncertain", false));
        WorkProtocol packet = new WorkProtocol(2, body.getString("opId"), "restOp", body);
        put(db, "out", peer, packet, "pending", new JSONObject().put("createdElapsed", clock.elapsed).put("createdWall", clock.wall).put("boot", clock.boot));
        set(db, "restSequence", Long.toString(sequence));
        return body;
    }
    private void recordRestOp(JSONObject op, String outcome) {
        if (op == null) return;
        try {
            Diagnostics.record(context, "rest.op", new JSONObject().put("timerId", op.getString("timerId")).put("opId", op.getString("opId"))
                .put("sessionId", op.getString("sessionId")).put("data", new JSONObject().put("op", op.getString("op")).put("origin", "watch")
                    .put("outcome", outcome).put("deltaMs", op.get("deltaMs"))));
        } catch (Exception ignored) { /* diagnostics only */ }
    }
    private String valueOr(SQLiteDatabase db, String key, String fallback) { String v = value(db, key); return v == null ? fallback : v; }

    // ---- watch actions ----
    /** v2: a 'complete' mutation plus the local rest start, in one transaction. Legacy: the v1 command. */
    public WorkProtocol logSet(String id, JSONObject expected, JSONObject changes, long elapsed, long wall, int boot) throws Exception {
        if (!shared(getReadableDatabase())) return logSetV1(id, expected, changes, elapsed, wall, boot);
        return write(db -> {
            JSONObject snapshot = activeSnapshot(db);
            JSONObject step = editable(db, snapshot, id);
            if (step.getJSONObject("actual").getBoolean("completed")) throw new SyncError("alreadyCompleted", "This set is already completed.");
            JSONObject[] sparse = sparse(step.getJSONObject("actual"), expected, changes, true);
            WorkProtocol packet = enqueueMutation(db, snapshot, step, "complete", sparse[0], sparse[1], null, null, null);
            set(db, "lastAction", new JSONObject().put("id", packet.id).put("body", packet.body).toString());
            project(db);
            int seconds = step.getInt("restAfter");
            JSONObject timer = rest();
            Clock clock = new Clock(elapsed, wall, boot);
            if (seconds > 0) {
                JSONObject next = NextUp.compute(savedSnapshot(db), id);
                JSONObject label = next == null ? null : new JSONObject().put("title", trim(next.getString("title"), 120)).put("text", trim(next.getString("text"), 200));
                JSONObject candidate = RestRules.create(UUID.randomUUID().toString(), snapshot.getString("sessionId"), snapshot.getString("epoch"),
                    "watch", device(db), packet.id, seconds * 1000L, elapsed, clock, label, snapshot.optBoolean("vibrate", true));
                RestRules.Result started = RestRules.start(timer, candidate, elapsed);
                set(db, "rest", started.current.toString());
                recordRestOp(restOp(db, "start", candidate, seconds * 1000L, null, packet.id, "user", label, clock, false), started.outcome);
            } else if (RestRules.running(timer)) {
                if (sharedTimer(timer)) recordRestOp(restOp(db, "skip", timer, null, null, null, "zeroRest", null, clock, false), "applied");
                set(db, "rest", (sharedTimer(timer) ? RestRules.end(timer, "skipped") : RestState.stop(timer)).toString());
            }
            queueStatus(db);
            return packet;
        });
    }
    private static String trim(String text, int max) { return text.length() > max ? text.substring(0, max) : text; }
    /** v2 'edit' of an already logged (or not yet logged) set. */
    public WorkProtocol updateSet(String setId, JSONObject expected, JSONObject changes) throws Exception {
        return write(db -> {
            if (!shared(db)) throw new SyncError("legacy", "Update the phone app to edit sets from the watch.");
            JSONObject snapshot = activeSnapshot(db);
            JSONObject step = editable(db, snapshot, setId);
            JSONObject[] sparse = sparse(step.getJSONObject("actual"), expected, changes, false);
            WorkProtocol packet = enqueueMutation(db, snapshot, step, "edit", sparse[0], sparse[1], null, null, null);
            set(db, "lastAction", new JSONObject().put("id", packet.id).put("body", packet.body).toString());
            project(db); queueStatus(db);
            return packet;
        });
    }
    public void undoLast() throws Exception {
        if (!shared(getReadableDatabase())) { undoLastV1(); return; }
        write(db -> {
            JSONObject snapshot = activeSnapshot(db);
            JSONObject last = object(db, "lastAction");
            if (last == null) throw new SyncError("noUndo", "No watch set to undo.");
            JSONObject original = last.getJSONObject("body");
            if (!original.getString("sessionId").equals(snapshot.getString("sessionId")) || !original.getString("epoch").equals(snapshot.getString("epoch")))
                throw new SyncError("noUndo", "That action belongs to another workout.");
            JSONObject step = WatchProjection.step(snapshot, original.getJSONObject("target").getString("setId"));
            if (reviewSets(db, snapshot).contains(step.getString("setId"))) throw new SyncError("review", "Review this set first.");
            JSONObject inverse = MutationRules.undoOf(original);
            if (MutationRules.merge(step.getJSONObject("actual"), inverse.getJSONObject("expected"), inverse.getJSONObject("changes"))
                .getString("outcome").equals("conflict")) throw new SyncError("stale", "This set changed. Review it on your phone.");
            enqueueMutation(db, snapshot, step, "undo", inverse.getJSONObject("expected"), inverse.getJSONObject("changes"), last.getString("id"), null, null);
            JSONObject timer = rest();
            if (RestRules.running(timer) && last.getString("id").equals(timer.optString("sourceOp"))) {
                recordRestOp(restOp(db, "cancel", timer, null, null, last.getString("id"), "undo", null, now(), false), "applied");
                set(db, "rest", RestRules.cancel(timer, last.getString("id")).current.toString());
            }
            delete(db, "lastAction"); project(db); queueStatus(db);
            return null;
        });
    }
    /** Conditional 'resolve' mutation for a review; keepPhone=true keeps the canonical values. */
    public WorkProtocol resolveConflict(String conflictId, boolean keepPhone) throws Exception {
        return write(db -> {
            if (!shared(db)) throw new SyncError("legacy", "Review this on your phone.");
            JSONObject snapshot = activeSnapshot(db);
            JSONObject conflict = null;
            JSONArray conflicts = conflicts(db, snapshot);
            for (int i = 0; i < conflicts.length(); i++) if (conflicts.getJSONObject(i).getString("id").equals(conflictId)) conflict = conflicts.getJSONObject(i);
            if (conflict == null) throw new SyncError("stale", "This review is already resolved.");
            if (!conflict.isNull("queuedResolution")) throw new SyncError("pending", "This review is already being resolved.");
            JSONObject step = WatchProjection.step(snapshot, conflict.getString("setId"));
            JSONObject expected = new JSONObject(), changes = new JSONObject();
            if (!keepPhone) {
                // All of the op's fields, not only the conflicting ones: a conflicting complete wrote nothing,
                // so applying the watch values must also re-send completed:true (and any other field).
                JSONArray fields = conflict.getJSONArray("fields");
                for (int i = 0; i < fields.length(); i++) {
                    JSONObject f = fields.getJSONObject(i);
                    expected.put(f.getString("field"), f.get("phone")); changes.put(f.getString("field"), f.get("watch"));
                }
                if (changes.length() == 0) throw new SyncError("invalid", "Nothing to apply from the watch.");
            }
            WorkProtocol packet = enqueueMutation(db, snapshot, step, "resolve", expected, changes, null, conflictId, keepPhone ? "phone" : "watch");
            project(db); queueStatus(db);
            return packet;
        });
    }
    public void acknowledgeUpdate(String pairKey) throws Exception {
        write(db -> { set(db, "updateAck", pairKey == null ? "" : pairKey); return null; });
    }
    /** S10 Done: back to idle. The closed-session list and the outbox are kept. */
    public void clearClosed() throws Exception { write(db -> { delete(db, "closed"); return null; }); }

    /** Snapshot that can take actions: shared, not closed, not frozen. */
    private JSONObject activeSnapshot(SQLiteDatabase db) throws Exception {
        JSONObject snapshot = savedSnapshot(db);
        if (snapshot == null) throw new SyncError("noWorkout", "Send a workout from your phone first.");
        if (closedSessions(db).contains(closedKey(snapshot))) throw new SyncError("closed", "This workout was finished on the phone.");
        if (value(db, "freeze") != null) throw new SyncError("frozen", "The phone is finishing this workout.");
        return snapshot;
    }
    /** The projected step, refusing sets the watch must not change. */
    private JSONObject editable(SQLiteDatabase db, JSONObject snapshot, String setId) throws Exception {
        JSONObject step = WatchProjection.step(snapshot, setId);
        if (!step.getBoolean("supported")) throw new SyncError("unsupported", "Log this exercise on your phone.");
        if (reviewSets(db, snapshot).contains(setId)) throw new SyncError("review", "Review this set first.");
        return step;
    }
    /**
     * Sparse expected/changes from editor values: only fields whose new value differs from what the user saw.
     * Fields the user saw are checked against the projection; a difference is a stale editor.
     */
    private static JSONObject[] sparse(JSONObject actual, JSONObject expected, JSONObject changes, boolean complete) throws Exception {
        JSONObject outExpected = new JSONObject(), outChanges = new JSONObject();
        for (String field : MutationRules.ordered(changes)) {
            if (field.equals("completed")) continue;
            if (!MutationRules.WATCH_SET_FIELDS.contains(field)) throw new SyncError("invalid", "Unknown field " + field);
            Object seen = expected != null && expected.has(field) ? expected.get(field) : actual.opt(field);
            if (MutationRules.same(changes.get(field), seen)) continue;
            if (!MutationRules.same(actual.opt(field), seen)) throw new SyncError("stale", "This set changed. Select it again to review the latest values.");
            outExpected.put(field, seen == null ? JSONObject.NULL : seen); outChanges.put(field, changes.get(field));
        }
        if (complete) { outExpected.put("completed", false); outChanges.put("completed", true); }
        else if (outChanges.length() == 0) throw new SyncError("invalid", "Nothing to update.");
        return new JSONObject[]{outExpected, outChanges};
    }
    private WorkProtocol enqueueMutation(SQLiteDatabase db, JSONObject snapshot, JSONObject step, String op, JSONObject expected,
                                         JSONObject changes, String undoOf, String resolves, String keep) throws Exception {
        String peer = value(db, "watchPeer");
        if (peer == null) throw new SyncError("noWorkout", "No saved workout");
        if (countAll(db, "out", "mutation") + countAll(db, "out", "command") >= MAX_QUEUED || effects(db).length() >= MAX_QUEUED) {
            Diagnostics.record(context, "sync.queueFull", new JSONObject().put("data", new JSONObject().put("type", "mutation").put("count", MAX_QUEUED)));
            throw new SyncError("queueFull", "Open your phone to sync before logging more sets.");
        }
        String epoch = snapshot.getString("epoch"), sequenceKey = "sequence:" + epoch;
        long sequence = Long.parseLong(valueOr(db, sequenceKey, "0")) + 1;
        String opId = UUID.randomUUID().toString();
        JSONObject body = new JSONObject().put("protocolVersion", 2).put("opId", opId).put("epoch", epoch)
            .put("sessionId", snapshot.getString("sessionId")).put("deviceId", device(db)).put("sequence", sequence)
            .put("baseRevision", snapshot.getLong("revision")).put("controlRevision", snapshot.optLong("controlRevision"))
            .put("op", op).put("target", new JSONObject().put("prescriptionId", step.getString("prescriptionId"))
                .put("exerciseId", step.getString("exerciseId")).put("setId", step.getString("setId")))
            .put("expected", expected).put("changes", changes)
            .put("undoOf", undoOf == null ? JSONObject.NULL : undoOf).put("resolves", resolves == null ? JSONObject.NULL : resolves)
            .put("keep", keep == null ? JSONObject.NULL : keep).put("createdAtWall", Math.max(0, now().wall));
        WorkProtocol packet;
        try { packet = new WorkProtocol(2, opId, "mutation", body); }
        catch (IllegalArgumentException error) { throw new SyncError("invalid", error.getMessage()); }
        put(db, "out", peer, packet, "pending", null);
        set(db, sequenceKey, Long.toString(sequence));
        Diagnostics.record(context, "sync.mutation", new JSONObject().put("opId", opId).put("sessionId", snapshot.getString("sessionId"))
            .put("data", new JSONObject().put("op", op).put("sequence", sequence).put("outcome", "queued").put("code", "ok")));
        return packet;
    }

    // ---- v1 watch actions (legacy mode, unchanged behaviour) ----
    private WorkProtocol logSetV1(String id, JSONObject expected, JSONObject changes, long elapsed, long wall, int boot) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (blocked(db)) throw new IllegalStateException("Review the pending watch actions on your phone first.");
            JSONObject snapshot = savedSnapshot(db);
            if (snapshot == null) throw new SyncError("noWorkout", "Send a workout from your phone first.");
            if (!snapshot.has("sequences")) throw new IllegalStateException("Update the phone app and send this workout again to enable set logging.");
            if (effects(db).length() >= MAX_QUEUED) throw new SyncError("queueFull", "Open your phone to refresh the workout before logging more sets.");
            JSONObject step = WatchProjection.step(snapshot, id);
            if (!WatchProjection.equal(step.getJSONObject("actual"), expected)) throw new SyncError("stale", "This set changed. Select it again to review the latest values.");
            if (!step.getBoolean("supported")) throw new SyncError("unsupported", "Log this exercise on your phone.");
            if (step.getJSONObject("actual").getBoolean("completed")) throw new SyncError("alreadyCompleted", "This set is already completed.");
            set(db, "baseSnapshot", baseSnapshot(db).toString());
            JSONObject body = new JSONObject().put("baseRevision", snapshot.getLong("revision"))
                .put("action", "set").put("prescriptionId", step.getString("prescriptionId"))
                .put("exerciseId", step.getString("exerciseId")).put("setId", id)
                .put("expected", new JSONObject(step.getJSONObject("actual").toString()))
                .put("changes", new JSONObject(changes.toString()).put("completed", true));
            WorkProtocol command = enqueueCommand(body);
            set(db, "lastAction", new JSONObject().put("id", command.id).put("body", command.body).toString());
            int seconds = step.getInt("restAfter");
            if (seconds > 0) set(db, "rest", RestState.start(command.id, snapshot.getString("sessionId"), seconds,
                elapsed, wall, boot, snapshot.optBoolean("vibrate", true)).toString());
            else if (rest() != null) set(db, "rest", RestState.stop(rest()).toString());
            project(db);
            db.setTransactionSuccessful(); return command;
        } finally { db.endTransaction(); }
    }
    private void undoLastV1() throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (blocked(db)) throw new SyncError("review", "Review failed actions before undoing.");
            String text = value(db, "lastAction");
            if (text == null) throw new SyncError("noUndo", "No watch set to undo.");
            JSONObject last = new JSONObject(text), original = last.getJSONObject("body"), snapshot = savedSnapshot(db);
            if (!original.getString("sessionId").equals(snapshot.getString("sessionId")) || !original.getString("epoch").equals(snapshot.getString("epoch")))
                throw new SyncError("noUndo", "That action belongs to another workout.");
            JSONObject step = WatchProjection.step(snapshot, original.getString("setId"));
            JSONObject expected = new JSONObject(original.getJSONObject("expected").toString());
            for (var keys = original.getJSONObject("changes").keys(); keys.hasNext();) {
                String key = keys.next(); expected.put(key, original.getJSONObject("changes").get(key));
            }
            if (!WatchProjection.equal(step.getJSONObject("actual"), expected)) throw new SyncError("stale", "This set changed. Review it on your phone.");
            JSONObject draft = new JSONObject().put("baseRevision", snapshot.getLong("revision")).put("action", "set")
                .put("prescriptionId", original.getString("prescriptionId")).put("exerciseId", original.getString("exerciseId"))
                .put("setId", original.getString("setId")).put("expected", expected).put("changes", original.getJSONObject("expected"));
            enqueueCommand(draft);
            JSONObject timer = rest();
            if (timer != null && last.getString("id").equals(timer.optString("source"))) set(db, "rest", RestState.stop(timer).toString());
            db.delete("state", "key='lastAction'", null); project(db);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    /** Legacy mode only: clears v1 rejected/conflicting results after the user accepted the phone values. */
    public void acceptPhoneValues() throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (count(db, "out", "command") > 0) throw new SyncError("pending", "Open your phone and wait for pending actions to sync first.");
            ContentValues row = new ContentValues(); row.put("state", "reviewed");
            db.update("packets", row, "direction='in' AND type='result' AND state IN ('rejected','conflict')", null);
            project(db); db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    // ---- packet storage ----
    private String existing(SQLiteDatabase db, String direction, String type, String id) {
        try (Cursor c = db.rawQuery("SELECT data FROM packets WHERE direction=? AND type=? AND id=?", new String[]{direction,type,id})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }
    String meta(SQLiteDatabase db, String direction, String type, String id) {
        try (Cursor c = db.rawQuery("SELECT meta FROM packets WHERE direction=? AND type=? AND id=?", new String[]{direction,type,id})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }
    private int count(SQLiteDatabase db, String direction, String type) { return countAll(db, direction, type); }
    static int countAll(SQLiteDatabase db, String direction, String type) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM packets WHERE direction=? AND type=?", new String[]{direction,type})) {
            c.moveToFirst(); return c.getInt(0);
        }
    }
    static int countState(SQLiteDatabase db, String direction, String type, String state) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM packets WHERE direction=? AND type=?" + (state == null ? "" : " AND state=?"),
            state == null ? new String[]{direction, type} : new String[]{direction, type, state})) {
            c.moveToFirst(); return c.getInt(0);
        }
    }
    /**
     * Stored form used for replay fingerprints: the fresh clock fields of rest packets are zeroed, so
     * re-sends with new measurements are not "ID reused with different content".
     */
    static String stored(WorkProtocol packet) throws Exception {
        JSONObject json = packet.json();
        JSONObject body = json.getJSONObject("body");
        if (packet.type.equals("restOp")) body.put("clock", new JSONObject().put("ageMs", 0).put("uncertain", false));
        if (packet.type.equals("restState") && body.optJSONObject("timer") != null)
            body.getJSONObject("timer").put("startedAgoMs", 0).put("remainingMs", 0);
        return json.toString();
    }
    private void put(SQLiteDatabase db, String direction, String peer, WorkProtocol packet, String state) throws Exception {
        put(db, direction, peer, packet, state, null);
    }
    void put(SQLiteDatabase db, String direction, String peer, WorkProtocol packet, String state, JSONObject meta) throws Exception {
        packet.encode(); // size limits
        String text = stored(packet);
        String old = existing(db, direction, packet.type, packet.id);
        if (old != null) {
            if (!old.equals(text)) throw new IllegalArgumentException("Packet ID reused with different content");
            return;
        }
        if (count(db, direction, packet.type) >= MAX_QUEUED) throw new SyncError("queueFull", "Pending work storage is full. Open the phone to sync.");
        ContentValues row = new ContentValues(); row.put("direction", direction); row.put("type", packet.type);
        row.put("id", packet.id); row.put("peer", peer); row.put("data", text); row.put("state", state);
        if (meta != null) row.put("meta", meta.toString());
        db.insertOrThrow("packets", null, row);
    }
    /** Replaceable outbox row: a new one deletes any pending row of the same type. */
    void replace(SQLiteDatabase db, String peer, WorkProtocol packet, JSONObject meta) throws Exception {
        db.delete("packets", "direction='out' AND type=?", new String[]{packet.type});
        put(db, "out", peer, packet, "pending", meta);
    }
    void remove(SQLiteDatabase db, String direction, String type, String id) {
        db.delete("packets", "direction=? AND type=? AND id=?", new String[]{direction,type,id});
    }
    void mark(SQLiteDatabase db, String direction, String type, String id, String state) {
        ContentValues row = new ContentValues(); row.put("state", state);
        db.update("packets", row, "direction=? AND type=? AND id=?", new String[]{direction, type, id});
    }
    private boolean peerMatches(SQLiteDatabase db, String direction, String type, String id, String peer) {
        try (Cursor c = db.rawQuery("SELECT peer FROM packets WHERE direction=? AND type=? AND id=?", new String[]{direction,type,id})) {
            return c.moveToFirst() && c.getString(0).equals(peer);
        }
    }
    private boolean paused(SQLiteDatabase db) { return value(db, "control") != null; }

    // ---- phone outbox entry points ----
    public void control(WorkProtocol packet) throws Exception {
        if (!packet.type.equals("control")) throw new IllegalArgumentException("Expected control packet");
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            String peer = value(db, "phonePeer");
            if (peer == null) throw new IllegalStateException("No watch handoff to pause.");
            db.delete("packets", "direction='out' AND type='control'", null);
            put(db, "out", peer, packet, "pending");
            set(db, "controlConfirmation", "{}");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public void publish(String peer, WorkProtocol packet) throws Exception {
        if (!packet.type.equals("snapshot")) throw new IllegalArgumentException("Expected snapshot");
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            db.delete("packets", "direction='out' AND type='snapshot'", null);
            put(db, "out", peer, packet, "pending");
            set(db, "published", packet.json().toString());
            // A session that is selected/published again is live: rests may start for it again.
            RestCoordinator.reopenSession(this, db, packet.body.optString("sessionId", null));
            set(db, "phonePeer", peer);
            set(db, "confirmation", "{}");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    /** v1 command (legacy mode); identity and sequence allocation are atomic with the outbox write. */
    public WorkProtocol enqueueCommand(JSONObject draft) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONObject snapshot = savedSnapshot(db);
            String peer = value(db, "watchPeer");
            if (paused(db)) throw new IllegalStateException("Phone has control. Send the workout from your phone to resume on watch.");
            if (snapshot == null || peer == null) throw new SyncError("noWorkout", "No saved workout");
            String epoch = snapshot.getString("epoch");
            String sequenceKey = "sequence:" + epoch;
            String old = value(db, sequenceKey);
            long sequence = old == null ? 1 : Long.parseLong(old) + 1;
            JSONObject body = new JSONObject(draft.toString()).put("protocolVersion", 1)
                .put("epoch", epoch).put("sessionId", snapshot.getString("sessionId"))
                .put("deviceId", device(db)).put("sequence", sequence);
            WorkProtocol packet = new WorkProtocol(UUID.randomUUID().toString(), "command", body);
            put(db, "out", peer, packet, "pending");
            set(db, sequenceKey, Long.toString(sequence));
            db.setTransactionSuccessful(); return packet;
        } finally { db.endTransaction(); }
    }
    /** Phone: queue the final result for a received v1 command or v2 mutation. */
    public void complete(String peer, WorkProtocol result) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            String inType = result.version == 2 ? "mutation" : "command";
            if (!result.type.equals("result") || !peerMatches(db, "in", inType, result.id, peer))
                throw new IllegalArgumentException("Unknown received command");
            put(db, "out", peer, result, "pending");
            remove(db, "in", inType, result.id);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    // ---- receive ----
    public WorkProtocol receive(String peer, WorkProtocol packet, boolean watch) throws Exception {
        if (packet.version == 2) return receiveV2(peer, packet, watch);
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (packet.type.equals("snapshot") && watch) {
                JSONObject previous = savedSnapshot(db);
                String controlText = value(db, "control");
                JSONObject control = controlText == null ? null : new JSONObject(controlText);
                long generation = packet.body.optLong("controlRevision", 0);
                if (previous != null && previous.getString("epoch").equals(packet.body.getString("epoch"))
                    && generation < previous.optLong("controlRevision", 0))
                    return packet.acknowledgement("rejected", "A newer handoff already replaced this workout.");
                if (control != null && control.getString("epoch").equals(packet.body.getString("epoch"))
                    && generation <= control.getLong("controlRevision"))
                    return packet.acknowledgement("rejected", "Phone has control. Start a fresh handoff.");
                boolean same = previous != null && previous.getString("epoch").equals(packet.body.getString("epoch"))
                    && previous.getString("sessionId").equals(packet.body.getString("sessionId"));
                if (pendingCount(db) > 0 && (!same || !peer.equals(value(db, "watchPeer"))))
                    return packet.acknowledgement("rejected", "Sync pending watch actions before switching workouts.");
                if (previous != null && same && packet.body.getLong("revision") < previous.getLong("revision"))
                    return packet.acknowledgement("rejected", "Snapshot is older than the saved workout.");
                db.delete("state", "key='control'", null);
                acceptSnapshot(db, peer, packet, previous, same);
                set(db, "mode", "legacy");
            } else if (packet.type.equals("control") && watch) {
                if (!peer.equals(value(db, "watchPeer"))) throw new IllegalArgumentException("Unknown phone control");
                WorkProtocol cached = cachedControl(db, packet);
                if (cached != null) { db.setTransactionSuccessful(); return cached; }
                JSONObject snapshot = savedSnapshot(db);
                if (snapshot == null || !snapshot.getString("epoch").equals(packet.body.getString("epoch"))
                    || !snapshot.getString("sessionId").equals(packet.body.getString("sessionId")))
                    return packet.acknowledgement("rejected", "Different workout or database epoch.");
                String oldControl = value(db, "control");
                long generation = oldControl == null ? snapshot.optLong("controlRevision", 0) : new JSONObject(oldControl).getLong("controlRevision");
                if (packet.body.getLong("controlRevision") <= generation)
                    return packet.acknowledgement("rejected", "Stale control request.");
                set(db, "control", packet.body.toString());
                JSONObject currentRest = rest();
                Clock clock = now();
                long restRemaining = currentRest == null || currentRest.optInt("boot", -1) != clock.boot ? 0
                    : RestState.remaining(currentRest, clock.elapsed);
                if (rest() != null) set(db, "rest", RestState.stop(rest()).toString());
                String sequence = value(db, "sequence:" + snapshot.getString("epoch"));
                WorkProtocol ack = new WorkProtocol(packet.id, "ack", new JSONObject().put("type", "control")
                    .put("state", "received").put("reason", "").put("deviceId", device(db))
                    .put("sequence", sequence == null ? 0 : Long.parseLong(sequence)).put("restRemainingMs", restRemaining));
                set(db, "controlPacket", packet.json().toString()); set(db, "controlAck", ack.json().toString());
                retryReceivedCommands();
                db.setTransactionSuccessful(); return ack;
            } else if (packet.type.equals("command") && !watch) {
                String published = value(db, "published");
                if (published == null || !peer.equals(value(db, "phonePeer"))) throw new IllegalArgumentException("No handoff to this watch");
                // Stale session/epoch commands are admitted for explicit canonical rejection, never silently dropped.
                put(db, "in", peer, packet, "pending");
            } else if (packet.type.equals("result") && watch) {
                String old = existing(db, "in", "result", packet.id);
                if (old == null) {
                    if (!peerMatches(db, "out", "command", packet.id, peer)) throw new IllegalArgumentException("Unknown command result");
                    WorkProtocol command = WorkProtocol.decode(existing(db, "out", "command", packet.id).getBytes(StandardCharsets.UTF_8));
                    if (!command.body.getString("epoch").equals(packet.body.getString("epoch"))
                        || !command.body.getString("sessionId").equals(packet.body.getString("sessionId")))
                        throw new IllegalArgumentException("Result identity mismatch");
                    addEffect(db, command.body, packet.body);
                    if (!packet.body.getString("state").equals("committed") && rest() != null && packet.id.equals(rest().optString("source")))
                        set(db, "rest", RestState.stop(rest()).toString());
                    clearLastActionIfFailed(db, packet);
                }
                compactResults(db);
                put(db, "in", peer, packet, packet.body.getString("state"));
                remove(db, "out", "command", packet.id);
                project(db);
            } else if (packet.type.equals("ack")) {
                db.setTransactionSuccessful(); return receiveAck(db, peer, packet);
            } else throw new IllegalArgumentException("Unexpected packet for this device");
            db.setTransactionSuccessful();
            return packet.acknowledgement("received", "");
        } finally { db.endTransaction(); }
    }
    private int pendingCount(SQLiteDatabase db) { return countAll(db, "out", "command") + countAll(db, "out", "mutation"); }
    private WorkProtocol cachedControl(SQLiteDatabase db, WorkProtocol packet) throws Exception {
        String prior = value(db, "controlPacket");
        if (prior == null) return null;
        WorkProtocol previous = WorkProtocol.decode(prior.getBytes(StandardCharsets.UTF_8));
        if (!packet.id.equals(previous.id)) return null;
        if (!packet.body.toString().equals(previous.body.toString())) throw new IllegalArgumentException("Changed control packet");
        return WorkProtocol.decode(value(db, "controlAck").getBytes(StandardCharsets.UTF_8));
    }
    /** Shared by v1 and v2 snapshot acceptance. */
    private void acceptSnapshot(SQLiteDatabase db, String peer, WorkProtocol packet, JSONObject previous, boolean same) throws Exception {
        set(db, "baseSnapshot", packet.body.toString()); set(db, "watchPeer", peer);
        JSONArray kept = new JSONArray(), oldEffects = effects(db);
        if (same) for (int i = 0; i < oldEffects.length(); i++) if (oldEffects.getJSONObject(i).getLong("revision") > packet.body.getLong("revision")) kept.put(oldEffects.getJSONObject(i));
        set(db, "effects", kept.toString());
        if (!same) {
            JSONObject timer = rest();
            if (RestRules.running(timer)) set(db, "rest", (sharedTimer(timer) ? RestRules.end(timer, "cancelled") : RestState.stop(timer)).toString());
            delete(db, "lastAction"); delete(db, "closed");
        }
        Clock clock = now();
        set(db, "snapshotReceived", new JSONObject().put("elapsed", clock.elapsed).put("boot", clock.boot).put("wall", clock.wall).toString());
        set(db, "lastSyncedWall", Long.toString(clock.wall));
        project(db);
        set(db, "snapshotId", packet.id);
    }
    private void addEffect(SQLiteDatabase db, JSONObject action, JSONObject result) throws Exception {
        JSONObject base = baseSnapshot(db);
        if (result.getString("state").equals("committed") && base != null
            && base.getString("sessionId").equals(action.getString("sessionId")) && result.getLong("revision") > base.getLong("revision")) {
            JSONArray local = effects(db);
            if (local.length() >= MAX_QUEUED) throw new SyncError("queueFull", "Refresh the workout from your phone.");
            local.put(new JSONObject().put("body", action).put("revision", result.getLong("revision")));
            set(db, "effects", local.toString());
        }
        if (result.getString("state").equals("committed")) set(db, "lastSyncedWall", Long.toString(now().wall));
    }
    private void clearLastActionIfFailed(SQLiteDatabase db, WorkProtocol result) throws Exception {
        JSONObject last = object(db, "lastAction");
        if (!result.body.getString("state").equals("committed") && last != null && last.getString("id").equals(result.id)) delete(db, "lastAction");
    }
    /** Only final committed results may be compacted. Rejected/conflicting work remains reviewable. */
    private static void compactResults(SQLiteDatabase db) {
        db.execSQL("DELETE FROM packets WHERE rowid IN (SELECT rowid FROM packets WHERE direction='in' AND type='result' AND state IN ('committed','reviewed') ORDER BY rowid DESC LIMIT -1 OFFSET 50)");
    }
    private WorkProtocol receiveAck(SQLiteDatabase db, String peer, WorkProtocol packet) throws Exception {
        String type = packet.body.getString("type");
        if (!peerMatches(db, "out", type, packet.id, peer)) return null;
        if (type.equals("snapshot")) set(db, "confirmation", packet.json().toString());
        if (type.equals("control")) set(db, "controlConfirmation", packet.json().toString());
        if (packet.body.getString("state").equals("received")) {
            if (type.equals("command") || type.equals("mutation") || type.equals("restOp")) mark(db, "out", type, packet.id, "received");
            else {
                if (type.equals("restArmed")) set(db, "restArmedAcked", existing(db, "out", "restArmed", packet.id));
                remove(db, "out", type, packet.id);
            }
        } else mark(db, "out", type, packet.id, "rejected");
        if (type.equals("mutation")) queueStatus(db);
        return null;
    }

    // ---- v2 receive ----
    private WorkProtocol receiveV2(String peer, WorkProtocol packet, boolean watch) throws Exception {
        return write(db -> {
            switch (packet.type) {
                case "ack": return receiveAck(db, peer, packet);
                case "hello":
                    set(db, "peerHello:" + peer, new JSONObject().put("hello", packet.body).put("receivedAtWall", now().wall).toString());
                    delete(db, "compat"); // a new hello can change compatibility: refresh on the next read
                    Diagnostics.record(context, "sync.hello", new JSONObject().put("data", new JSONObject().put("peerProtocols", packet.body.getJSONArray("protocols"))
                        .put("peerVersion", packet.body.getString("versionName")).put("sharedMode", sharedHello(packet.body))));
                    if (watch) queueStatus(db);
                    return null;
                case "snapshot": if (watch) return receiveSnapshotV2(db, peer, packet); break;
                case "control": if (watch) return receiveControlV2(db, peer, packet); break;
                case "result": if (watch) return receiveResultV2(db, peer, packet); break;
                case "mutation":
                    if (watch) break;
                    if (value(db, "published") == null || !peer.equals(value(db, "phonePeer"))) throw new IllegalArgumentException("No handoff to this watch");
                    put(db, "in", peer, packet, "pending");
                    return packet.acknowledgement("received", "ok", "");
                case "status":
                    if (watch) break;
                    if (!peer.equals(value(db, "phonePeer"))) throw new IllegalArgumentException("Unknown watch");
                    set(db, "watchStatus", new JSONObject().put("status", packet.body).put("receivedAtWall", now().wall).put("peer", peer).toString());
                    return packet.acknowledgement("received", "ok", "");
                default: break;
            }
            throw new IllegalArgumentException("Unexpected packet for this device");
        });
    }
    static boolean sharedHello(JSONObject hello) {
        if (hello == null) return false;
        JSONArray protocols = hello.optJSONArray("protocols"), features = hello.optJSONArray("features");
        boolean two = false, mutations = false, rest = false;
        for (int i = 0; protocols != null && i < protocols.length(); i++) two |= protocols.optInt(i) == 2;
        for (int i = 0; features != null && i < features.length(); i++) {
            mutations |= "mutations2".equals(features.optString(i)); rest |= "rest2".equals(features.optString(i));
        }
        return two && mutations && rest;
    }
    private JSONObject controlHigh(SQLiteDatabase db, String epoch) throws Exception {
        JSONObject high = object(db, "controlHigh");
        return high != null && high.getString("epoch").equals(epoch) ? high : null;
    }
    private void raiseControl(SQLiteDatabase db, String epoch, long generation) throws Exception {
        JSONObject high = controlHigh(db, epoch);
        if (high == null || high.getLong("value") < generation)
            set(db, "controlHigh", new JSONObject().put("epoch", epoch).put("value", generation).toString());
    }
    private WorkProtocol receiveSnapshotV2(SQLiteDatabase db, String peer, WorkProtocol packet) throws Exception {
        JSONObject body = packet.body, previous = savedSnapshot(db);
        String epoch = body.getString("epoch"), session = body.getString("sessionId");
        long generation = body.getLong("controlRevision");
        if (closedSessions(db).contains(closedKey(epoch, session))) return reject(packet, "closed", "This workout was already closed.");
        boolean sameEpoch = previous != null && previous.getString("epoch").equals(epoch);
        JSONObject high = controlHigh(db, epoch);
        if ((sameEpoch && generation < previous.optLong("controlRevision", 0)) || (high != null && generation < high.getLong("value")))
            return reject(packet, "stale", "A newer handoff already replaced this workout.");
        JSONObject control = object(db, "control");
        if (control != null && control.getString("epoch").equals(epoch) && generation <= control.getLong("controlRevision"))
            return reject(packet, "stale", "Phone has control. Start a fresh handoff.");
        boolean same = sameEpoch && previous.getString("sessionId").equals(session);
        if ((!same || !peer.equals(value(db, "watchPeer"))) && !imported(db, body))
            return reject(packet, "pending", "Sync pending watch actions before switching workouts.");
        if (same && body.getLong("revision") < previous.getLong("revision"))
            return reject(packet, "stale", "Snapshot is older than the saved workout.");
        delete(db, "control");
        acceptSnapshot(db, peer, packet, previous, same);
        set(db, "mode", "shared");
        JSONObject freeze = object(db, "freeze");
        boolean releasedFreeze = !body.isNull("freeze")
            && valueOr(db, "releasedFreezes", "[]").contains("\"" + body.getJSONObject("freeze").getString("id") + "\"");
        if (!body.isNull("freeze") && !releasedFreeze) {
            JSONObject wire = body.getJSONObject("freeze");
            boolean known = freeze != null && freeze.getString("id").equals(wire.getString("id"));
            set(db, "freeze", new JSONObject().put("id", wire.getString("id")).put("reason", wire.getString("reason"))
                .put("controlRevision", generation).put("sessionId", session)
                .put("sinceWall", known ? freeze.getLong("sinceWall") : now().wall).toString());
        } else if (freeze != null && (generation > freeze.getLong("controlRevision") || !session.equals(freeze.optString("sessionId")))) delete(db, "freeze");
        raiseControl(db, epoch, generation);
        dropResolvedReviews(db, body);
        project(db); queueStatus(db);
        Diagnostics.record(context, "sync.snapshot", new JSONObject().put("sessionId", session).put("data", new JSONObject()
            .put("revision", body.getLong("revision")).put("controlRevision", generation).put("bytes", packet.encode().length)
            .put("outcome", "received").put("code", "ok")));
        return packet.acknowledgement("received", "ok", "");
    }
    private WorkProtocol reject(WorkProtocol packet, String code, String reason) throws Exception {
        Diagnostics.record(context, "sync.snapshot", new JSONObject().put("data", new JSONObject().put("outcome", "rejected").put("code", code)));
        return packet.acknowledgement("rejected", code, reason);
    }
    /** Every pending watch action is covered by the snapshot's sequence watermark (§1.4 switch rule). */
    private boolean imported(SQLiteDatabase db, JSONObject snapshot) throws Exception {
        JSONArray pending = pendingActions();
        JSONObject sequences = snapshot.getJSONObject("sequences");
        for (int i = 0; i < pending.length(); i++) {
            JSONObject body = pending.getJSONObject(i).getJSONObject("packet").getJSONObject("body");
            if (!body.getString("epoch").equals(snapshot.getString("epoch"))
                || body.getLong("sequence") > sequences.optLong(body.getString("deviceId"), 0)) return false;
        }
        return true;
    }
    /** Local conflict results disappear once a snapshot that already imported them no longer lists their review. */
    private void dropResolvedReviews(SQLiteDatabase db, JSONObject snapshot) throws Exception {
        Set<String> listed = new HashSet<>();
        JSONArray reviews = snapshot.getJSONArray("reviews");
        for (int i = 0; i < reviews.length(); i++) listed.add(reviews.getJSONObject(i).getString("id"));
        JSONObject sequences = snapshot.getJSONObject("sequences");
        try (Cursor c = db.rawQuery("SELECT id, meta FROM packets WHERE direction='in' AND type='result' AND state IN ('rejected','conflict') AND meta IS NOT NULL", null)) {
            while (c.moveToNext()) {
                JSONObject action = new JSONObject(c.getString(1));
                if (!listed.contains(c.getString(0)) && action.getString("epoch").equals(snapshot.getString("epoch"))
                    && action.getLong("sequence") <= sequences.optLong(action.getString("deviceId"), 0))
                    mark(db, "in", "result", c.getString(0), "reviewed");
            }
        }
    }
    private WorkProtocol receiveControlV2(SQLiteDatabase db, String peer, WorkProtocol packet) throws Exception {
        if (!peer.equals(value(db, "watchPeer"))) throw new IllegalArgumentException("Unknown phone control");
        WorkProtocol cached = cachedControl(db, packet);
        if (cached != null) return cached;
        JSONObject body = packet.body, snapshot = savedSnapshot(db);
        if (snapshot == null || !snapshot.getString("epoch").equals(body.getString("epoch")))
            return controlAck(db, packet, packet.acknowledgement("rejected", "epochMismatch", "Different database epoch."));
        String action = body.getString("action"), session = body.getString("sessionId");
        boolean current = snapshot.getString("sessionId").equals(session);
        JSONObject freeze = object(db, "freeze");
        JSONObject high = controlHigh(db, body.getString("epoch"));
        long generation = body.getLong("controlRevision");
        WorkProtocol ack;
        switch (action) {
            case "freeze":
                boolean known = freeze != null && freeze.getString("id").equals(body.getString("freezeId"));
                boolean released = valueOr(db, "releasedFreezes", "[]").contains("\"" + body.getString("freezeId") + "\"");
                if (!current || released || (!known && (generation < snapshot.optLong("controlRevision") || (high != null && generation < high.getLong("value")))))
                    return controlAck(db, packet, packet.acknowledgement("rejected", "stale", "Stale control request."));
                if (!known) {
                    set(db, "freeze", new JSONObject().put("id", body.getString("freezeId")).put("reason", body.getString("reason"))
                        .put("controlRevision", generation).put("sessionId", session).put("sinceWall", now().wall).toString());
                    raiseControl(db, body.getString("epoch"), generation);
                    Diagnostics.record(context, "sync.freeze", new JSONObject().put("sessionId", session).put("data", new JSONObject()
                        .put("freezeId", body.getString("freezeId")).put("reason", body.getString("reason")).put("checkpoint", lastSequence(db, snapshot))));
                }
                ack = packet.acknowledgement("received", "ok", "");
                ack.body.put("deviceId", device(db)).put("sequence", lastSequence(db, snapshot)).put("freezeId", body.getString("freezeId"));
                retryReceivedCommands();
                break;
            case "unfreeze":
                if (freeze == null || !freeze.getString("id").equals(body.getString("freezeId")))
                    return controlAck(db, packet, packet.acknowledgement("rejected", "stale", "Unknown or older freeze."));
                delete(db, "freeze");
                JSONArray releasedIds = new JSONArray(valueOr(db, "releasedFreezes", "[]")), keep = new JSONArray();
                for (int i = Math.max(0, releasedIds.length() - 7); i < releasedIds.length(); i++) keep.put(releasedIds.get(i));
                set(db, "releasedFreezes", keep.put(body.getString("freezeId")).toString());
                raiseControl(db, body.getString("epoch"), generation);
                Diagnostics.record(context, "sync.unfreeze", new JSONObject().put("sessionId", session).put("data", new JSONObject()
                    .put("freezeId", body.getString("freezeId")).put("reason", body.getString("reason"))));
                ack = packet.acknowledgement("received", "ok", "");
                ack.body.put("freezeId", body.getString("freezeId"));
                break;
            default: // closed
                JSONArray closed = new JSONArray(valueOr(db, "closedSessions", "[]")), next = new JSONArray();
                String key = closedKey(body.getString("epoch"), session);
                for (int i = Math.max(0, closed.length() - (MAX_CLOSED_SESSIONS - 1)); i < closed.length(); i++)
                    if (!closed.getString(i).equals(key)) next.put(closed.getString(i));
                set(db, "closedSessions", next.put(key).toString());
                if (current) {
                    set(db, "closed", new JSONObject().put("sessionId", session).put("reason", closedReason(body.getString("reason")))
                        .put("summary", summary(snapshot, now())).toString());
                    delete(db, "freeze"); delete(db, "lastAction");
                    JSONObject timer = rest();
                    if (RestRules.running(timer) && session.equals(timer.optString("sessionId")))
                        set(db, "rest", (sharedTimer(timer) ? RestRules.closeSession(timer, session).current : RestState.stop(timer)).toString());
                }
                Diagnostics.record(context, "sync.closed", new JSONObject().put("sessionId", session).put("data", new JSONObject()
                    .put("reason", body.getString("reason"))));
                ack = packet.acknowledgement("received", "ok", "");
        }
        queueStatus(db);
        return controlAck(db, packet, ack);
    }
    private WorkProtocol controlAck(SQLiteDatabase db, WorkProtocol packet, WorkProtocol ack) throws Exception {
        if (!ack.body.has("freezeId")) ack.body.put("freezeId", packet.body.get("freezeId"));
        set(db, "controlPacket", packet.json().toString()); set(db, "controlAck", ack.json().toString());
        return ack;
    }
    private static String closedReason(String reason) {
        switch (reason) {
            case "finish": return "completed";
            case "switch": return "replaced";
            default: return reason;
        }
    }
    private JSONObject summary(JSONObject snapshot, Clock clock) throws Exception {
        JSONArray steps = snapshot.getJSONArray("steps");
        int done = 0, total = 0;
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.getJSONObject(i);
            if (step.optBoolean("isWarmUp")) continue;
            total++;
            if (step.getJSONObject("actual").getBoolean("completed")) done++;
        }
        return new JSONObject().put("done", done).put("total", total).put("elapsedSeconds", Math.round(elapsed(snapshot, clock)));
    }
    private double elapsed(JSONObject snapshot, Clock clock) throws Exception {
        JSONObject received = object(getReadableDatabase(), "snapshotReceived");
        double seconds = snapshot.optDouble("elapsedSeconds", 0);
        if (snapshot.optBoolean("elapsedRunning") && received != null && received.getInt("boot") == clock.boot)
            seconds += Math.max(0, clock.elapsed - received.getLong("elapsed")) / 1000.0;
        return seconds;
    }
    private long lastSequence(SQLiteDatabase db, JSONObject snapshot) throws Exception {
        return Long.parseLong(valueOr(db, "sequence:" + snapshot.getString("epoch"), "0"));
    }
    private WorkProtocol receiveResultV2(SQLiteDatabase db, String peer, WorkProtocol packet) throws Exception {
        if (existing(db, "in", "result", packet.id) == null) {
            if (!peerMatches(db, "out", "mutation", packet.id, peer)) throw new IllegalArgumentException("Unknown mutation result");
            WorkProtocol mutation = WorkProtocol.decode(existing(db, "out", "mutation", packet.id).getBytes(StandardCharsets.UTF_8));
            if (!mutation.body.getString("epoch").equals(packet.body.getString("epoch"))
                || !mutation.body.getString("sessionId").equals(packet.body.getString("sessionId")))
                throw new IllegalArgumentException("Result identity mismatch");
            addEffect(db, mutation.body, packet.body);
            clearLastActionIfFailed(db, packet);
            boolean committed = packet.body.getString("state").equals("committed");
            if (committed && mutation.body.getString("op").equals("resolve")) {
                mark(db, "in", "result", mutation.body.getString("resolves"), "reviewed");
            }
            compactResults(db);
            String state = packet.body.getString("state");
            if (!committed && !packet.body.getBoolean("review")) state = "reviewed"; // never applied, nothing to review
            put(db, "in", peer, packet, state, mutation.body);
            remove(db, "out", "mutation", packet.id);
            project(db); queueStatus(db);
            Diagnostics.record(context, "sync.mutation", new JSONObject().put("opId", packet.id).put("sessionId", packet.body.getString("sessionId"))
                .put("data", new JSONObject().put("op", mutation.body.getString("op")).put("sequence", mutation.body.getLong("sequence"))
                    .put("outcome", packet.body.getString("state")).put("code", packet.body.getString("code"))));
        }
        return packet.acknowledgement("received", "ok", "");
    }

    // ---- reviews ----
    /** Closed sessions are per database epoch: a backup restore (new epoch) may send the same session again. */
    static String closedKey(String epoch, String sessionId) { return epoch + "|" + sessionId; }
    static String closedKey(JSONObject snapshot) throws Exception { return closedKey(snapshot.getString("epoch"), snapshot.getString("sessionId")); }
    JSONArray closedSessionsArray(SQLiteDatabase db) throws Exception { return new JSONArray(valueOr(db, "closedSessions", "[]")); }
    private Set<String> closedSessions(SQLiteDatabase db) throws Exception {
        Set<String> ids = new HashSet<>();
        JSONArray closed = closedSessionsArray(db);
        for (int i = 0; i < closed.length(); i++) ids.add(closed.getString(i));
        return ids;
    }
    private Set<String> reviewSets(SQLiteDatabase db, JSONObject snapshot) throws Exception {
        Set<String> sets = new HashSet<>();
        JSONArray steps = snapshot.getJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) if (steps.getJSONObject(i).optBoolean("review")) sets.add(steps.getJSONObject(i).getString("setId"));
        JSONArray conflicts = conflicts(db, snapshot);
        for (int i = 0; i < conflicts.length(); i++) sets.add(conflicts.getJSONObject(i).getString("setId"));
        return sets;
    }
    /** Open reviews: the snapshot's list plus local conflict results the phone has not listed yet. */
    private JSONArray conflicts(SQLiteDatabase db, JSONObject snapshot) throws Exception {
        JSONArray out = new JSONArray();
        if (!v2(snapshot)) return out;
        Set<String> seen = new HashSet<>();
        JSONObject queued = queuedResolutions();
        JSONArray reviews = snapshot.getJSONArray("reviews");
        for (int i = 0; i < reviews.length(); i++) {
            JSONObject review = reviews.getJSONObject(i);
            seen.add(review.getString("id"));
            out.put(conflict(snapshot, review.getString("id"), review.getString("setId"), review.getString("origin"),
                review.getString("code"), review.getString("reason"), review.getJSONArray("fields"), queued));
        }
        try (Cursor c = db.rawQuery("SELECT id, data, meta FROM packets WHERE direction='in' AND type='result' AND state IN ('rejected','conflict') AND meta IS NOT NULL ORDER BY rowid", null)) {
            while (c.moveToNext()) {
                JSONObject action = new JSONObject(c.getString(2)), result = new JSONObject(c.getString(1)).getJSONObject("body");
                if (seen.contains(c.getString(0)) || !action.getString("sessionId").equals(snapshot.getString("sessionId"))) continue;
                out.put(conflict(snapshot, c.getString(0), action.getJSONObject("target").getString("setId"), "watch",
                    result.getString("code"), result.getString("reason"), result.getJSONArray("fields"), queued));
            }
        }
        return out;
    }
    private JSONObject queuedResolutions() throws Exception {
        JSONObject queued = new JSONObject();
        JSONArray pending = packets("out", "mutation");
        for (int i = 0; i < pending.length(); i++) {
            JSONObject body = pending.getJSONObject(i).getJSONObject("packet").getJSONObject("body");
            if (body.getString("op").equals("resolve")) queued.put(body.getString("resolves"), body.getString("keep"));
        }
        return queued;
    }
    private static JSONObject conflict(JSONObject snapshot, String id, String setId, String origin, String code, String reason,
                                       JSONArray wireFields, JSONObject queued) throws Exception {
        JSONObject step = WatchProjection.stepOrNull(snapshot, setId);
        JSONArray fields = new JSONArray();
        for (int i = 0; i < wireFields.length(); i++) {
            JSONObject f = wireFields.getJSONObject(i);
            fields.put(new JSONObject().put("field", f.getString("field")).put("phone", f.get("phone")).put("watch", f.get("requested"))
                .put("conflict", f.optBoolean("conflict", true)));
        }
        return new JSONObject().put("id", id).put("setId", setId).put("exerciseName", step == null ? "" : step.getString("name"))
            .put("position", step == null ? "" : "Set " + step.getInt("setNumber")).put("origin", origin).put("code", code)
            .put("reason", reason).put("fields", fields).put("queuedResolution", queued.has(id) ? queued.get(id) : JSONObject.NULL);
    }

    // ---- status / hello ----
    /** Replaceable watch→phone status (shared mode only). */
    private void queueStatus(SQLiteDatabase db) throws Exception {
        String peer = value(db, "watchPeer");
        if (peer == null || !shared(db)) return;
        replace(db, peer, new WorkProtocol(2, UUID.randomUUID().toString(), "status", status(db)), null);
    }
    JSONObject status(SQLiteDatabase db) throws Exception {
        JSONObject snapshot = savedSnapshot(db);
        return new JSONObject().put("epoch", snapshot == null ? JSONObject.NULL : snapshot.getString("epoch"))
            .put("sessionId", snapshot == null ? JSONObject.NULL : snapshot.getString("sessionId"))
            .put("pendingMutations", countState(db, "out", "mutation", "pending") + countState(db, "out", "command", "pending"))
            .put("receivedMutations", countState(db, "out", "mutation", "received") + countState(db, "out", "command", "received"))
            .put("pendingRestOps", countState(db, "out", "restOp", "pending"))
            .put("reviewCount", snapshot == null ? 0 : conflicts(db, snapshot).length())
            .put("lastSequence", snapshot == null ? 0 : lastSequence(db, snapshot))
            .put("diagnosticsLastSeq", Diagnostics.lastSeq(context)).put("measuredAtWall", Math.max(0, now().wall));
    }
    /** This device's hello (protocols [1,2]); version values come from the package manager. */
    public WorkProtocol hello(boolean watch, String versionName, long versionCode, boolean reply) throws Exception {
        return write(db -> new WorkProtocol(2, UUID.randomUUID().toString(), "hello", new JSONObject()
            .put("role", watch ? "watch" : "phone").put("protocols", new JSONArray().put(1).put(2))
            .put("versionName", versionName).put("versionCode", Math.max(1, versionCode))
            .put("installId", watch ? device(db) : installId(db)).put("reply", reply).put("features", new JSONArray(FEATURES))));
    }
    /** {hello, receivedAtWall} for a peer, or null. */
    public JSONObject peerHello(String peer) throws Exception { return peer == null ? null : object(getReadableDatabase(), "peerHello:" + peer); }
    /** The phone's view of the watch: latest status packet ({status, receivedAtWall, peer}) or null. */
    public JSONObject watchStatus() throws Exception { return object(getReadableDatabase(), "watchStatus"); }
    public String state(String key) { return value(getReadableDatabase(), key); }
    public void putState(String key, String value) throws Exception { write(db -> { set(db, key, value); return null; }); }
    /** Phone: has the selected watch acknowledged a v2 snapshot, with a v2 hello? */
    public boolean phoneShared() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject published = object(db, "published"), confirmation = object(db, "confirmation");
        String peer = value(db, "phonePeer");
        if (published == null || published.optInt("version") != 2 || peer == null) return false;
        JSONObject hello = peerHello(peer);
        return hello != null && sharedHello(hello.getJSONObject("hello")) && confirmation != null
            && published.getString("id").equals(confirmation.optString("id")) && confirmation.has("body")
            && "received".equals(confirmation.getJSONObject("body").optString("state"));
    }

    // ---- outbox / inspection ----
    public JSONArray packets(String direction, String type) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT peer,data,state FROM packets WHERE direction=? AND type=? ORDER BY rowid", new String[]{direction,type})) {
            while (c.moveToNext()) rows.put(new JSONObject().put("peer", c.getString(0))
                .put("packet", new JSONObject(c.getString(1))).put("state", c.getString(2)));
        }
        return rows;
    }
    public JSONArray outgoing() throws Exception { return outgoing(now()); }
    /** Up to 16 pending packets; rest packets get their clock fields measured fresh against {@code clock}. */
    public JSONArray outgoing(Clock clock) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT peer,data,meta FROM packets WHERE direction='out' AND state='pending' ORDER BY rowid LIMIT 16", null)) {
            while (c.moveToNext()) {
                JSONObject packet = new JSONObject(c.getString(1));
                if (!c.isNull(2)) fresh(packet, new JSONObject(c.getString(2)), clock);
                rows.put(new JSONObject().put("peer", c.getString(0)).put("packet", packet));
            }
        }
        return rows;
    }
    /** Fresh measurement (§1.8): only durations measured now ever cross devices. */
    static void fresh(JSONObject packet, JSONObject meta, Clock clock) throws Exception {
        JSONObject body = packet.getJSONObject("body");
        if (packet.getString("type").equals("restOp") && meta.has("createdElapsed")) {
            long age; boolean uncertain = false;
            if (meta.getInt("boot") == clock.boot) age = Math.max(0, clock.elapsed - meta.getLong("createdElapsed"));
            else {
                uncertain = true;
                long wallAge = clock.wall - meta.getLong("createdWall");
                age = wallAge < 0 || wallAge > RestRules.MAX_MS ? (body.isNull("durationMs") ? RestRules.MAX_MS : body.getLong("durationMs")) : wallAge;
            }
            body.put("clock", new JSONObject().put("ageMs", age).put("uncertain", uncertain));
        } else if (packet.getString("type").equals("restState") && meta.has("startElapsed") && !body.isNull("timer")) {
            JSONObject timer = body.getJSONObject("timer");
            boolean sameBoot = meta.getInt("boot") == clock.boot;
            timer.put("startedAgoMs", sameBoot ? Math.max(0, clock.elapsed - meta.getLong("startElapsed")) : 0);
            timer.put("remainingMs", sameBoot && meta.getBoolean("running") ? Math.max(0, meta.getLong("endsElapsed") - clock.elapsed) : 0);
        }
    }
    /** Re-sends v1 commands and v2 mutations that were only acknowledged as natively received. */
    public void retryReceivedCommands() {
        ContentValues row = new ContentValues(); row.put("state", "pending");
        getWritableDatabase().update("packets", row, "direction='out' AND type IN ('command','mutation') AND state='received'", null);
    }
    public JSONObject inspect() throws Exception { return inspect(now()); }
    /** v1 keys (phone bridge + legacy watch) plus the §6.3 watch view. */
    public JSONObject inspect(Clock clock) throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        String confirmation = value(db, "confirmation");
        JSONObject snapshot = savedSnapshot(db);
        JSONArray inbox = packets("in", "command"), mutations = packets("in", "mutation");
        for (int i = 0; i < mutations.length(); i++) inbox.put(mutations.get(i));
        JSONObject report = new JSONObject().put("snapshot", snapshot == null ? JSONObject.NULL : snapshot)
            .put("snapshotId", value(db, "snapshotId") == null ? JSONObject.NULL : value(db, "snapshotId"))
            .put("confirmation", confirmation == null ? JSONObject.NULL : new JSONObject(confirmation))
            .put("control", value(db, "control") == null ? JSONObject.NULL : new JSONObject(value(db, "control")))
            .put("published", value(db, "published") == null ? JSONObject.NULL : new JSONObject(value(db, "published")))
            .put("controlConfirmation", value(db, "controlConfirmation") == null ? JSONObject.NULL : new JSONObject(value(db, "controlConfirmation")))
            .put("canUndo", !paused(db) && value(db, "lastAction") != null).put("blocked", blocked(db))
            .put("inbox", inbox).put("pending", pendingActions()).put("results", packets("in", "result"));
        return WatchView.build(this, db, report, snapshot, clock);
    }

    // ---- package-private accessors for WatchView / RestCoordinator ----
    JSONArray conflictsFor(SQLiteDatabase db, JSONObject snapshot) throws Exception { return conflicts(db, snapshot); }
    Set<String> closedSessionSet(SQLiteDatabase db) throws Exception { return closedSessions(db); }
    double elapsedSeconds(JSONObject snapshot, Clock clock) throws Exception { return elapsed(snapshot, clock); }
    boolean blockedV1(SQLiteDatabase db) { return blocked(db); }
    boolean pausedV1(SQLiteDatabase db) { return paused(db); }
    void projectNow(SQLiteDatabase db) throws Exception { project(db); }
    void queueStatusNow(SQLiteDatabase db) throws Exception { queueStatus(db); }
    JSONObject saved(SQLiteDatabase db) throws Exception { return savedSnapshot(db); }
    Context context() { return context; }
    /** Notification/exact-alarm permission facts shown in inspect().alerts. */
    JSONObject alertFacts() {
        boolean notifications = true, exact = true;
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) notifications = manager.areNotificationsEnabled();
            AlarmManager alarms = context.getSystemService(AlarmManager.class);
            if (alarms != null && Build.VERSION.SDK_INT >= 31) exact = alarms.canScheduleExactAlarms();
        } catch (Exception error) { Log.w("IronpathWork", "Alert facts unavailable", error); }
        try { return new JSONObject().put("notifications", notifications).put("exact", exact); }
        catch (Exception error) { return new JSONObject(); }
    }
}
