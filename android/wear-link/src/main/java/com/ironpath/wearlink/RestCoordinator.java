package com.ironpath.wearlink;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Phone: the canonical shared rest timer, committed natively so it never waits for the WebView
 * (design §3.2/3.3). Watch: applies authoritative restState packets over its pending rest ops (§3.4).
 * Public methods block; call them on a worker thread. Each phone method returns a RestView (§6.4).
 * Every entry point commits one transaction, then applies RestEffects, then flushes the outbox.
 */
public final class RestCoordinator {
    private static final Object LOCK = new Object();
    static final long REANCHOR_DRIFT_MS = 1500;
    private RestCoordinator() { }

    // ---------------- public (Context) API ----------------
    public static JSONObject view(Context c) { return phone(c, false, store -> view(store, store.now())); }
    public static JSONObject start(Context c, String sessionId, long durationMs, String sourceOp, JSONObject next) {
        return phone(c, true, store -> start(store, sessionId, durationMs, sourceOp, next));
    }
    public static JSONObject adjust(Context c, String timerId, long deltaMs) { return phone(c, true, store -> adjust(store, timerId, deltaMs)); }
    public static JSONObject skip(Context c, String timerId) { return phone(c, true, store -> skip(store, timerId)); }
    /** A finished/removed workout: cancels its rest and refuses later rest starts for it. */
    public static JSONObject closeSession(Context c, String sessionIdOrNull) { return closeSession(c, sessionIdOrNull, true); }
    /** {@code finished=false} (workout switch) only cancels the running rest; the session stays usable. */
    public static JSONObject closeSession(Context c, String sessionIdOrNull, boolean finished) {
        return phone(c, true, store -> closeSession(store, sessionIdOrNull, finished));
    }
    public static void configure(Context c, boolean notify, boolean vibrate) { phone(c, true, store -> configure(store, notify, vibrate)); }
    /** Transactional claim for the phone backup alarm; null if stale or suppressed. */
    public static JSONObject claimBackup(Context c, String timerId, long revision) {
        return phone(c, false, store -> claimBackup(store, timerId, revision));
    }
    /** Boot / process start: re-anchor the phone timer after a reboot, then re-arm its effects. */
    public static JSONObject recover(Context c) { return phone(c, true, RestCoordinator::recover); }
    /** Listener entry: restOp/restArmed on the phone, restState on the watch. Sends the ACK itself. */
    public static void receive(Context c, String peer, WorkProtocol restPacket) {
        WorkProtocol ack;
        boolean watch = WorkClient.isWatch(c);
        synchronized (LOCK) {
            try (WorkStore store = new WorkStore(c)) {
                ack = watch ? receiveWatch(store, peer, restPacket) : receivePhone(store, peer, restPacket);
            } catch (Exception error) {
                Log.w("IronpathRest", "Rest packet rejected", error);
                return;
            }
            applyEffects(c);
        }
        try {
            if (ack != null) WorkClient.send(c, peer, ack);
            WorkClient.flush(c);
        } catch (Exception error) { Log.d("IronpathRest", "Rest reply awaits reconnect"); }
    }

    interface PhoneWork { JSONObject run(WorkStore store) throws Exception; }
    private static JSONObject phone(Context c, boolean apply, PhoneWork work) {
        JSONObject view;
        synchronized (LOCK) {
            try (WorkStore store = new WorkStore(c)) { view = work.run(store); }
            catch (RuntimeException error) { throw error; }
            catch (Exception error) { throw new SyncError("storage", error.getMessage() == null ? "Rest storage failed" : error.getMessage()); }
            if (apply) applyEffects(c);
        }
        if (apply) {
            try { WorkClient.flush(c); } catch (Exception error) { Log.d("IronpathRest", "Rest state awaits reconnect"); }
        }
        return view;
    }
    /**
     * Applies RestEffects for the state as stored right now, under the coordinator lock. A view captured
     * earlier could be older than another thread's commit and re-arm a stale backup alarm.
     */
    public static void applyEffects(Context c) {
        synchronized (LOCK) {
            JSONObject view;
            try (WorkStore store = new WorkStore(c)) {
                view = WorkClient.isWatch(c) ? store.inspect().optJSONObject("rest") : view(store, store.now());
            } catch (Exception error) {
                Log.w("IronpathRest", "Rest view unavailable", error);
                return;
            }
            effects(c, view);
        }
    }
    /** Tests replace the Application's effects. */
    static RestEffects effectsOverride;
    private static void effects(Context c, JSONObject view) {
        try { (effectsOverride != null ? effectsOverride : RestEffects.of(c)).apply(c, view); }
        catch (Exception error) {
            Log.w("IronpathRest", "Rest effects failed", error);
            Diagnostics.record(c, "rest.failure", diagData("stage", "effects", "message", String.valueOf(error.getMessage())));
        }
    }

    // ---------------- phone role ----------------
    static JSONObject config(WorkStore store, SQLiteDatabase db) throws Exception {
        JSONObject config = store.object(db, "restConfig");
        return config != null ? config : new JSONObject().put("notify", true).put("vibrate", true);
    }
    static JSONObject timer(WorkStore store, SQLiteDatabase db) throws Exception { return store.object(db, "rest"); }

    static JSONObject start(WorkStore store, String sessionId, long durationMs, String sourceOp, JSONObject next) throws Exception {
        if (durationMs < 1000 || durationMs > RestRules.MAX_MS) throw new SyncError("invalid", "Rest must be between 1 second and 24 hours.");
        Clock now = store.now();
        return store.write(db -> {
            if (sessionId != null && contains(closedSessions(store, db), sessionId)) throw new SyncError("closed", "This workout is closed.");
            JSONObject candidate = RestRules.create(UUID.randomUUID().toString(), sessionId, publishedEpoch(store, db), "phone",
                store.installId(db), sourceOp, durationMs, now.elapsed, now, label(next), config(store, db).getBoolean("vibrate"));
            RestRules.Result result = RestRules.start(timer(store, db), candidate, now.elapsed);
            commit(store, db, result.current, now);
            recordOp(store, "start", "phone", result.outcome, null, result.current, null);
            return view(store, db, now);
        });
    }
    static JSONObject adjust(WorkStore store, String timerId, long deltaMs) throws Exception {
        if (deltaMs == 0 || Math.abs(deltaMs) > 3_600_000) throw new SyncError("invalid", "Invalid rest change");
        Clock now = store.now();
        return store.write(db -> {
            RestRules.Result result = RestRules.adjust(timer(store, db), timerId, deltaMs, now);
            if (!changed(result)) throw new SyncError("stale", "That rest has already ended.");
            commit(store, db, result.current, now);
            recordOp(store, "adjust", "phone", result.outcome, deltaMs, result.current, null);
            return view(store, db, now);
        });
    }
    static JSONObject skip(WorkStore store, String timerId) throws Exception {
        Clock now = store.now();
        return store.write(db -> {
            RestRules.Result result = RestRules.skip(timer(store, db), timerId);
            if (!changed(result)) throw new SyncError("stale", "That rest has already ended.");
            commit(store, db, result.current, now);
            recordOp(store, "skip", "phone", result.outcome, null, result.current, null);
            return view(store, db, now);
        });
    }
    /** Closes a workout's rest; {@code null} closes any (backup restore). Closed sessions refuse later starts. */
    static JSONObject closeSession(WorkStore store, String sessionIdOrNull) throws Exception { return closeSession(store, sessionIdOrNull, true); }
    static JSONObject closeSession(WorkStore store, String sessionIdOrNull, boolean finished) throws Exception {
        Clock now = store.now();
        return store.write(db -> {
            if (sessionIdOrNull != null && finished) {
                JSONArray closed = closedSessions(store, db), next = new JSONArray();
                for (int i = Math.max(0, closed.length() - (WorkStore.MAX_CLOSED_SESSIONS - 1)); i < closed.length(); i++)
                    if (!closed.getString(i).equals(sessionIdOrNull)) next.put(closed.getString(i));
                store.set(db, "restClosedSessions", next.put(sessionIdOrNull).toString());
            }
            RestRules.Result result = RestRules.closeSession(timer(store, db), sessionIdOrNull);
            if (changed(result)) {
                commit(store, db, result.current, now);
                recordOp(store, "cancel", "phone", result.outcome, null, result.current, null);
            }
            return view(store, db, now);
        });
    }
    static JSONObject configure(WorkStore store, boolean notify, boolean vibrate) throws Exception {
        Clock now = store.now();
        return store.write(db -> {
            store.set(db, "restConfig", new JSONObject().put("notify", notify).put("vibrate", vibrate).toString());
            JSONObject timer = timer(store, db);
            if (RestRules.running(timer)) store.set(db, "rest", withAlert(store, db, timer.put("vibrate", vibrate)).toString());
            return view(store, db, now);
        });
    }
    static JSONObject claimBackup(WorkStore store, String timerId, long revision) throws Exception {
        Clock now = store.now();
        return store.write(db -> {
            JSONObject timer = timer(store, db);
            String reason = null;
            if (!RestRules.running(timer) || !timer.getString("id").equals(timerId) || timer.optLong("revision", -1) != revision
                || RestRules.remaining(timer, now.elapsed) > 1000) reason = "stale";
            else {
                String backup = timer.getJSONObject("alert").getString("phoneBackup");
                if (backup.equals("suppressed")) reason = "watchArmed";
                else if (backup.equals("off")) reason = "notificationsOff";
                else if (!backup.equals("scheduled")) reason = "stale";
            }
            if (reason != null) {
                Diagnostics.record(store.context(), "rest.suppressed", new JSONObject().put("timerId", timerId).put("revision", revision)
                    .put("data", new JSONObject().put("reason", reason)));
                return null;
            }
            // Natural expiry is not a revision change: no restState, so the wrist alert is never cancelled by it.
            timer.getJSONObject("alert").put("phoneBackup", "delivered");
            store.set(db, "rest", timer.put("state", "ended").put("active", false).toString());
            return view(store, db, now);
        });
    }
    static JSONObject recover(WorkStore store) throws Exception {
        Clock now = store.now();
        return store.write(db -> {
            JSONObject timer = timer(store, db), next = RestRules.recover(timer, now);
            if (next != null && next != timer) {
                store.set(db, "rest", next.toString());
                Diagnostics.record(store.context(), "rest.recovered", new JSONObject().put("timerId", next.getString("id"))
                    .put("data", new JSONObject().put("uncertain", next.optBoolean("uncertain")).put("remainingMs", RestRules.remaining(next, now.elapsed))));
            }
            return view(store, db, now);
        });
    }

    /** Lifts the closed-session block when a session is published again (it is in progress after all). */
    static void reopenSession(WorkStore store, SQLiteDatabase db, String sessionId) throws Exception {
        if (sessionId == null) return;
        JSONArray closed = closedSessions(store, db), next = new JSONArray();
        for (int i = 0; i < closed.length(); i++) if (!closed.getString(i).equals(sessionId)) next.put(closed.getString(i));
        if (next.length() != closed.length()) store.set(db, "restClosedSessions", next.toString());
    }
    /** applied/expired change the current timer; stale/rejected/superseded do not. */
    static boolean changed(RestRules.Result result) { return result.outcome.equals("applied") || result.outcome.equals("expired"); }

    /** revision++, alert recomputed, stored, and a replaceable restState queued for a v2 watch. */
    private static void commit(WorkStore store, SQLiteDatabase db, JSONObject timer, Clock now) throws Exception {
        long revision = Long.parseLong(or(store.value(db, "restRevision"), "0")) + 1;
        store.set(db, "restRevision", Long.toString(revision));
        JSONObject next = withAlert(store, db, timer.put("revision", revision));
        store.set(db, "rest", next.toString());
        queueRestState(store, db, now);
    }
    /** phoneBackup: off if notify is off; suppressed when the watch armed this revision; delivered after it fired. */
    private static JSONObject withAlert(WorkStore store, SQLiteDatabase db, JSONObject timer) throws Exception {
        JSONObject previous = timer.optJSONObject("alert");
        Object armed = previous == null ? JSONObject.NULL : previous.opt("watchArmedRevision");
        boolean notify = config(store, db).getBoolean("notify");
        String backup = previous != null && "delivered".equals(previous.optString("phoneBackup")) && !RestRules.running(timer) ? "delivered"
            : !notify ? "off"
            : armed instanceof Number && ((Number) armed).longValue() == timer.optLong("revision", -1) ? "suppressed" : "scheduled";
        return timer.put("alert", new JSONObject().put("preferred", preferred(store, db)).put("watchArmedRevision", armed == null ? JSONObject.NULL : armed)
            .put("phoneBackup", backup));
    }
    /** The wrist is preferred while shared mode is on and the watch's hello is fresh. */
    private static String preferred(WorkStore store, SQLiteDatabase db) throws Exception {
        if (!store.phoneShared()) return "phone";
        JSONObject hello = store.peerHello(store.value(db, "phonePeer"));
        long changed = Long.parseLong(or(store.value(db, "peerChangedAt"), "0"));
        return hello != null && hello.getLong("receivedAtWall") >= changed && !"false".equals(store.value(db, "peerReachable")) ? "watch" : "phone";
    }
    private static String publishedEpoch(WorkStore store, SQLiteDatabase db) throws Exception {
        JSONObject published = store.object(db, "published");
        return published == null ? null : published.getJSONObject("body").optString("epoch", null);
    }
    private static JSONArray closedSessions(WorkStore store, SQLiteDatabase db) throws Exception {
        return new JSONArray(or(store.value(db, "restClosedSessions"), "[]"));
    }
    private static boolean contains(JSONArray array, String value) throws Exception {
        for (int i = 0; i < array.length(); i++) if (array.getString(i).equals(value)) return true;
        return false;
    }
    private static JSONObject label(JSONObject next) throws Exception {
        if (next == null) return null;
        String title = next.optString("title", ""), text = next.optString("text", "");
        return new JSONObject().put("title", title.length() > 120 ? title.substring(0, 120) : title)
            .put("text", text.length() > 200 ? text.substring(0, 200) : text);
    }
    private static void queueRestState(WorkStore store, SQLiteDatabase db, Clock now) throws Exception {
        String peer = store.value(db, "phonePeer"), epoch = publishedEpoch(store, db);
        JSONObject hello = store.peerHello(peer);
        if (peer == null || epoch == null || hello == null || !WorkStore.sharedHello(hello.getJSONObject("hello"))) return;
        JSONObject timer = timer(store, db), wire = null, meta = null;
        if (timer != null && timer.has("origin")) {
            JSONObject alert = timer.getJSONObject("alert");
            wire = new JSONObject().put("timerId", timer.getString("id")).put("state", RestRules.state(timer))
                .put("startedAgoMs", 0).put("remainingMs", 0).put("durationMs", RestRules.duration(timer))
                .put("origin", timer.getString("origin")).put("originDevice", timer.optString("originDevice", store.installId(db)))
                .put("sourceOp", timer.opt("sourceOp")).put("next", timer.opt("next"))
                .put("alert", new JSONObject().put("preferred", alert.getString("preferred"))
                    .put("watchArmedRevision", alert.get("watchArmedRevision")).put("phoneBackup", alert.getString("phoneBackup")));
            meta = new JSONObject().put("startElapsed", timer.getLong("startElapsed")).put("endsElapsed", timer.getLong("endsElapsed"))
                .put("boot", timer.getInt("boot")).put("running", RestRules.running(timer));
        }
        JSONObject body = new JSONObject().put("protocolVersion", 2).put("epoch", epoch)
            .put("sessionId", timer == null || timer.isNull("sessionId") ? JSONObject.NULL : timer.getString("sessionId"))
            .put("revision", Long.parseLong(or(store.value(db, "restRevision"), "0")))
            .put("watermarks", watermarks(store, db)).put("timer", wire == null ? JSONObject.NULL : wire)
            .put("outcomes", new JSONArray(or(store.value(db, "restOutcomes"), "[]")));
        store.replace(db, peer, new WorkProtocol(2, UUID.randomUUID().toString(), "restState", body),
            meta == null ? new JSONObject().put("startElapsed", now.elapsed).put("endsElapsed", now.elapsed).put("boot", now.boot).put("running", false) : meta);
    }
    private static JSONObject watermarks(WorkStore store, SQLiteDatabase db) throws Exception {
        return new JSONObject(or(store.value(db, "restWatermarks"), "{}"));
    }

    /** restOp: ordered per device by restSequence; gaps are held with their receive anchor. restArmed: suppress the backup. */
    static WorkProtocol receivePhone(WorkStore store, String peer, WorkProtocol packet) throws Exception {
        Clock now = store.now();
        return store.write(db -> {
            if (!peer.equals(store.value(db, "phonePeer"))) throw new IllegalArgumentException("Unknown watch");
            JSONObject body = packet.body;
            if (packet.type.equals("restArmed")) { restArmed(store, db, body); return packet.acknowledgement("received", "ok", ""); }
            if (!packet.type.equals("restOp")) throw new IllegalArgumentException("Unexpected rest packet for the phone");
            String old = existing(db, packet.id);
            if (old != null) return old.equals(WorkStore.stored(packet)) ? packet.acknowledgement("received", "ok", "")
                : packet.acknowledgement("rejected", "idReused", "Rest op ID reused with different content.");
            String device = body.getString("deviceId");
            JSONObject marks = watermarks(store, db);
            if (body.getLong("restSequence") <= marks.optLong(device, 0)) {
                outcome(store, db, body, "rejected");
                queueRestState(store, db, now);
                return packet.acknowledgement("received", "sequenceReused", "Rest op sequence already consumed.");
            }
            // The stored row zeroes the fresh clock (replay fingerprint), so the measured age lives in meta.
            JSONObject clock = body.getJSONObject("clock");
            store.put(db, "in", peer, packet, "held", new JSONObject().put("recvElapsed", now.elapsed).put("recvBoot", now.boot)
                .put("ageMs", clock.getLong("ageMs")).put("uncertain", clock.getBoolean("uncertain")));
            drain(store, db, device, now);
            db.execSQL("DELETE FROM packets WHERE rowid IN (SELECT rowid FROM packets WHERE direction='in' AND type='restOp' AND state='done' ORDER BY rowid DESC LIMIT -1 OFFSET 50)");
            return packet.acknowledgement("received", "ok", "");
        });
    }
    private static String existing(SQLiteDatabase db, String id) {
        try (Cursor c = db.rawQuery("SELECT data FROM packets WHERE direction='in' AND type='restOp' AND id=?", new String[]{id})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }
    /** Processes held ops for one device while the next sequence is present. */
    private static void drain(WorkStore store, SQLiteDatabase db, String device, Clock now) throws Exception {
        boolean processed = false;
        while (true) {
            JSONObject marks = watermarks(store, db);
            long next = marks.optLong(device, 0) + 1;
            String id = null, data = null, meta = null;
            try (Cursor c = db.rawQuery("SELECT id, data, meta FROM packets WHERE direction='in' AND type='restOp' AND state='held'", null)) {
                while (c.moveToNext()) {
                    JSONObject body = new JSONObject(c.getString(1)).getJSONObject("body");
                    if (body.getString("deviceId").equals(device) && body.getLong("restSequence") == next) {
                        id = c.getString(0); data = c.getString(1); meta = c.getString(2);
                    }
                }
            }
            if (id == null) break;
            apply(store, db, new JSONObject(data).getJSONObject("body"), new JSONObject(meta), now);
            store.mark(db, "in", "restOp", id, "done");
            marks.put(device, next);
            store.set(db, "restWatermarks", trimMarks(marks).toString());
            processed = true;
        }
        if (processed) queueRestState(store, db, now);
    }
    private static JSONObject trimMarks(JSONObject marks) throws Exception {
        if (marks.length() <= 8) return marks;
        JSONObject trimmed = new JSONObject(); int skip = marks.length() - 8;
        for (var it = marks.keys(); it.hasNext();) { String key = it.next(); if (skip-- > 0) continue; trimmed.put(key, marks.get(key)); }
        return trimmed;
    }
    /** One watch rest op against the canonical timer, anchored on the phone's own receive time. */
    private static void apply(WorkStore store, SQLiteDatabase db, JSONObject op, JSONObject meta, Clock now) throws Exception {
        boolean sameBoot = meta.getInt("recvBoot") == now.boot;
        long recv = sameBoot ? meta.getLong("recvElapsed") : now.elapsed;
        JSONObject current = timer(store, db);
        RestRules.Result result;
        String epoch = publishedEpoch(store, db);
        if (epoch == null || !epoch.equals(op.getString("epoch"))) result = new RestRules.Result(current, null, "rejected");
        else switch (op.getString("op")) {
            case "start":
                if (contains(closedSessions(store, db), op.getString("sessionId")) || (current != null && current.getString("id").equals(op.getString("timerId")))) {
                    result = new RestRules.Result(current, null, "rejected"); break;
                }
                long age = sameBoot ? meta.getLong("ageMs") : op.getLong("durationMs");
                JSONObject candidate = RestRules.create(op.getString("timerId"), op.getString("sessionId"), op.getString("epoch"), "watch",
                    op.getString("deviceId"), op.isNull("sourceOp") ? null : op.getString("sourceOp"), op.getLong("durationMs"),
                    recv - age, now, op.isNull("next") ? null : op.getJSONObject("next"), config(store, db).getBoolean("vibrate"));
                result = RestRules.start(current, candidate, now.elapsed);
                break;
            case "adjust": result = RestRules.adjust(current, op.getString("timerId"), op.getLong("deltaMs"), now); break;
            case "skip": result = RestRules.skip(current, op.getString("timerId")); break;
            default: result = RestRules.cancel(current, op.getString("sourceOp"));
        }
        if (changed(result)) commit(store, db, result.current, now);
        outcome(store, db, op, result.outcome);
    }
    private static void outcome(WorkStore store, SQLiteDatabase db, JSONObject op, String outcome) throws Exception {
        JSONArray outcomes = new JSONArray(or(store.value(db, "restOutcomes"), "[]")), next = new JSONArray();
        for (int i = Math.max(0, outcomes.length() - 15); i < outcomes.length(); i++) next.put(outcomes.get(i));
        store.set(db, "restOutcomes", next.put(new JSONObject().put("opId", op.getString("opId")).put("outcome", outcome)).toString());
        recordOp(store, op.getString("op"), "watch", outcome, op.isNull("deltaMs") ? null : op.getLong("deltaMs"), timer(store, db), op.getString("opId"));
    }
    private static void restArmed(WorkStore store, SQLiteDatabase db, JSONObject body) throws Exception {
        JSONObject timer = timer(store, db);
        boolean current = RestRules.running(timer) && timer.getString("id").equals(body.getString("timerId"))
            && timer.optLong("revision", -1) == body.getLong("revision");
        Diagnostics.record(store.context(), "rest.armed", new JSONObject().put("timerId", body.getString("timerId")).put("revision", body.getLong("revision"))
            .put("data", new JSONObject().put("armed", body.getBoolean("armed")).put("reason", body.getString("reason"))
                .put("exact", body.getBoolean("exact")).put("current", current)));
        if (!current) return; // an older revision's confirmation never suppresses a newer backup
        if (!body.getBoolean("armed")) {
            Diagnostics.record(store.context(), "rest.fallback", new JSONObject().put("timerId", body.getString("timerId"))
                .put("revision", body.getLong("revision")).put("data", new JSONObject()
                    .put("reason", body.getString("reason").equals("pendingOps") ? "notArmed" : "armFailed").put("watchReason", body.getString("reason"))));
            return;
        }
        timer.getJSONObject("alert").put("watchArmedRevision", body.getLong("revision"));
        store.set(db, "rest", withAlert(store, db, timer).toString());
    }
    private static void recordOp(WorkStore store, String op, String origin, String outcome, Long deltaMs, JSONObject timer, String opId) {
        try {
            Diagnostics.record(store.context(), "rest.op", new JSONObject().put("timerId", timer == null ? JSONObject.NULL : timer.optString("id"))
                .put("revision", timer == null ? JSONObject.NULL : timer.opt("revision")).put("opId", opId == null ? JSONObject.NULL : opId)
                .put("data", new JSONObject().put("op", op).put("origin", origin).put("outcome", outcome).put("deltaMs", deltaMs == null ? JSONObject.NULL : deltaMs)));
        } catch (Exception ignored) { /* diagnostics only */ }
    }

    /** RestView (§6.4). A running timer with no time left reads as ended. */
    static JSONObject view(WorkStore store, Clock now) throws Exception {
        return view(store, store.getReadableDatabase(), now);
    }
    static JSONObject view(WorkStore store, SQLiteDatabase db, Clock now) throws Exception {
        JSONObject timer = timer(store, db), view = new JSONObject().put("measuredAtWall", now.wall);
        if (timer == null || !timer.has("origin") || !timer.has("alert")) return view.put("timer", JSONObject.NULL);
        long remaining = RestRules.remaining(timer, now.elapsed);
        String state = RestRules.state(timer);
        if (state.equals("running") && remaining == 0) state = "ended";
        JSONObject alert = timer.getJSONObject("alert");
        return view.put("timer", new JSONObject().put("timerId", timer.getString("id")).put("revision", timer.getLong("revision"))
            .put("sessionId", timer.opt("sessionId")).put("state", state).put("remainingMs", remaining)
            .put("durationMs", RestRules.duration(timer)).put("origin", timer.getString("origin")).put("sourceOp", timer.opt("sourceOp"))
            .put("next", timer.opt("next"))
            .put("alert", new JSONObject().put("preferred", alert.getString("preferred")).put("destination", destination(timer, alert, config(store, db).getBoolean("notify")))
                .put("watchArmedRevision", alert.get("watchArmedRevision")).put("phoneBackup", alert.getString("phoneBackup"))));
    }
    /** §3.3: watch | phone | both | none. */
    static String destination(JSONObject timer, JSONObject alert, boolean notify) {
        Object armed = alert.opt("watchArmedRevision");
        boolean armedNow = armed instanceof Number && ((Number) armed).longValue() == timer.optLong("revision", -1);
        if (armedNow) return "watch";
        if (!notify) return "none";
        if (alert.optString("preferred").equals("phone") || !(armed instanceof Number)) return "phone";
        return "both";
    }

    // ---------------- watch role ----------------
    /**
     * Applies an authoritative restState: watermarks always (monotonic); the timer only for a newer revision,
     * as authoritative + pending local ops. The local deadline moves only when it drifts more than 1.5 s.
     */
    static WorkProtocol receiveWatch(WorkStore store, String peer, WorkProtocol packet) throws Exception {
        if (!packet.type.equals("restState")) throw new IllegalArgumentException("Unexpected rest packet for the watch");
        Clock now = store.now();
        return store.write(db -> {
            if (!peer.equals(store.value(db, "watchPeer"))) throw new IllegalArgumentException("Unknown phone");
            JSONObject snapshot = store.saved(db), body = packet.body;
            if (snapshot == null || snapshot.optInt("protocolVersion") != 2) return packet.acknowledgement("rejected", "stale", "Not in shared mode.");
            String device = store.device(db);
            long mark = Math.max(Long.parseLong(or(store.value(db, "restWatermark"), "0")), body.getJSONObject("watermarks").optLong(device, 0));
            store.set(db, "restWatermark", Long.toString(mark));
            JSONArray consumed = new JSONArray();
            JSONArray outbox = store.packets("out", "restOp");
            for (int i = 0; i < outbox.length(); i++) {
                JSONObject op = outbox.getJSONObject(i).getJSONObject("packet").getJSONObject("body");
                if (op.getLong("restSequence") <= mark) { store.remove(db, "out", "restOp", op.getString("opId")); consumed.put(op.getString("opId")); }
            }
            JSONArray outcomes = body.getJSONArray("outcomes");
            for (int i = 0; i < outcomes.length(); i++) {
                JSONObject outcome = outcomes.getJSONObject(i);
                for (int j = 0; j < consumed.length(); j++) if (consumed.getString(j).equals(outcome.getString("opId")))
                    Diagnostics.record(store.context(), "rest.op", new JSONObject().put("opId", outcome.getString("opId"))
                        .put("revision", body.getLong("revision")).put("data", new JSONObject().put("origin", "watch").put("outcome", outcome.getString("outcome"))));
            }
            long last = Long.parseLong(or(store.value(db, "restLastRevision"), "-1"));
            if (body.getLong("revision") > last) {
                store.set(db, "restLastRevision", Long.toString(body.getLong("revision")));
                JSONObject authoritative = anchor(body, now);
                JSONObject merged = merge(store.rest(), project(store, authoritative, now));
                if (merged == null) store.delete(db, "rest"); else store.set(db, "rest", merged.toString());
            }
            store.queueStatusNow(db);
            return packet.acknowledgement("received", "ok", "");
        });
    }
    /** Wire timer → local record anchored on this device's receive time. */
    private static JSONObject anchor(JSONObject body, Clock now) throws Exception {
        if (body.isNull("timer")) return null;
        JSONObject wire = body.getJSONObject("timer");
        long start = now.elapsed - wire.getLong("startedAgoMs");
        boolean running = wire.getString("state").equals("running");
        JSONObject record = RestRules.create(wire.getString("timerId"), body.isNull("sessionId") ? null : body.getString("sessionId"),
            body.getString("epoch"), wire.getString("origin"), wire.getString("originDevice"),
            wire.isNull("sourceOp") ? null : wire.getString("sourceOp"), wire.getLong("durationMs"), start, now,
            wire.isNull("next") ? null : wire.getJSONObject("next"), true);
        long ends = now.elapsed + (running ? wire.getLong("remainingMs") : 0);
        record.put("endsElapsed", ends).put("endsWall", now.wall + (ends - now.elapsed)).put("revision", body.getLong("revision"))
            .put("alert", wire.getJSONObject("alert"));
        // A rest that is already over on arrival ends without an alert.
        if (!running || wire.getLong("remainingMs") == 0) record.put("state", running ? "ended" : wire.getString("state")).put("active", false);
        return record;
    }
    /** authoritative + pending local rest ops (restSequence above the watermark), replayed through RestRules. */
    private static JSONObject project(WorkStore store, JSONObject authoritative, Clock now) throws Exception {
        JSONObject timer = authoritative;
        JSONArray outbox = store.packets("out", "restOp");
        SQLiteDatabase db = store.getReadableDatabase();
        java.util.List<JSONObject> ops = new java.util.ArrayList<>();
        for (int i = 0; i < outbox.length(); i++) ops.add(outbox.getJSONObject(i).getJSONObject("packet").getJSONObject("body"));
        ops.sort((a, b) -> Long.compare(a.optLong("restSequence"), b.optLong("restSequence")));
        for (JSONObject op : ops) {
            String metaText = store.meta(db, "out", "restOp", op.getString("opId"));
            JSONObject meta = metaText == null ? null : new JSONObject(metaText);
            long created = meta != null && meta.getInt("boot") == now.boot ? meta.getLong("createdElapsed") : now.elapsed;
            Clock at = new Clock(created, now.wall - (now.elapsed - created), now.boot);
            switch (op.getString("op")) {
                case "start":
                    JSONObject candidate = RestRules.create(op.getString("timerId"), op.getString("sessionId"), op.getString("epoch"), "watch",
                        op.getString("deviceId"), op.isNull("sourceOp") ? null : op.getString("sourceOp"), op.getLong("durationMs"), created, at,
                        op.isNull("next") ? null : op.getJSONObject("next"), true);
                    timer = RestRules.start(timer, candidate, now.elapsed).current; break;
                case "adjust": timer = RestRules.adjust(timer, op.getString("timerId"), op.getLong("deltaMs"), at).current; break;
                case "skip": timer = RestRules.skip(timer, op.getString("timerId")).current; break;
                default: timer = RestRules.cancel(timer, op.getString("sourceOp")).current;
            }
        }
        return timer;
    }
    /** Keeps localRev (no alarm churn) when nothing the alarm depends on changed. */
    private static JSONObject merge(JSONObject local, JSONObject projected) throws Exception {
        if (projected == null) {
            if (RestRules.running(local) && local.has("epoch") && !local.isNull("epoch")) return RestRules.end(local, "cancelled");
            return local;
        }
        boolean vibrate = local == null || local.optBoolean("vibrate", true);
        JSONObject next = new JSONObject(projected.toString()).put("vibrate", vibrate);
        long localRev = local == null ? 0 : local.optLong("localRev", local.optLong("revision"));
        boolean sameTimer = local != null && local.optString("id").equals(next.getString("id"));
        if (sameTimer && RestRules.running(local) && RestRules.running(next)
            && Math.abs(next.getLong("endsElapsed") - local.getLong("endsElapsed")) <= REANCHOR_DRIFT_MS) {
            next.put("endsElapsed", local.getLong("endsElapsed")).put("endsWall", local.getLong("endsWall"))
                .put("startElapsed", local.optLong("startElapsed", next.getLong("startElapsed")));
        }
        boolean unchanged = sameTimer && RestRules.state(local).equals(RestRules.state(next))
            && local.getLong("endsElapsed") == next.getLong("endsElapsed");
        return next.put("localRev", unchanged ? localRev : localRev + 1);
    }

    private static String or(String value, String fallback) { return value == null ? fallback : value; }
    private static JSONObject diagData(String... pairs) {
        try {
            JSONObject data = new JSONObject();
            for (int i = 0; i + 1 < pairs.length; i += 2) data.put(pairs[i], pairs[i + 1]);
            return new JSONObject().put("data", data);
        } catch (Exception error) { return new JSONObject(); }
    }
}
