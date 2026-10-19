package com.ironpath.wearlink;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** User commands are never stored in, or pruned like, diagnostic receipts. */
public final class WorkStore extends SQLiteOpenHelper {
    public static final int MAX_QUEUED = 200;
    private final Context context;
    public WorkStore(Context context) { this(context, "wear-workouts.db"); }
    WorkStore(Context context, String name) { super(context, name, null, 1); this.context = context.getApplicationContext(); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE packets (direction TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, "
            + "peer TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(direction,type,id))");
        db.execSQL("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int from, int to) { throw new IllegalStateException("Missing migration"); }
    private String value(SQLiteDatabase db, String key) {
        try (Cursor c = db.rawQuery("SELECT value FROM state WHERE key=?", new String[]{key})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }
    private void set(SQLiteDatabase db, String key, String value) {
        ContentValues row = new ContentValues(); row.put("key", key); row.put("value", value);
        db.insertWithOnConflict("state", null, row, SQLiteDatabase.CONFLICT_REPLACE);
    }
    private JSONObject savedSnapshot(SQLiteDatabase db) throws Exception {
        String text = value(db, "snapshot"); return text == null ? null : new JSONObject(text);
    }
    private JSONObject baseSnapshot(SQLiteDatabase db) throws Exception {
        String text = value(db, "baseSnapshot");
        return text == null ? savedSnapshot(db) : new JSONObject(text);
    }
    private JSONArray effects(SQLiteDatabase db) throws Exception {
        String text = value(db, "effects"); return text == null ? new JSONArray() : new JSONArray(text);
    }
    private void project(SQLiteDatabase db) throws Exception {
        JSONObject base = baseSnapshot(db);
        if (base == null) return;
        JSONObject projected = WatchProjection.project(base, effects(db), packets("out", "command"));
        set(db, "snapshot", projected.getJSONObject("snapshot").toString());
        set(db, "blocked", Boolean.toString(projected.getBoolean("blocked")));
    }
    private boolean blocked(SQLiteDatabase db) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM packets WHERE direction='in' AND type='result' AND state IN ('rejected','conflict')", null)) {
            c.moveToFirst(); return c.getInt(0) > 0 || "true".equals(value(db, "blocked"));
        }
    }
    public JSONObject rest() throws Exception {
        String text = value(getReadableDatabase(), "rest"); return text == null ? null : new JSONObject(text);
    }
    public void testRest(long elapsed, long wall, int boot) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (rest() != null && rest().optBoolean("active")) throw new IllegalStateException("Finish or skip the current rest before testing alerts.");
            set(db, "rest", RestState.start("test", "test", 3, elapsed, wall, boot, true).toString());
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public JSONObject recoverRest(long elapsed, long wall, int boot) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONObject timer = RestState.recover(rest(), elapsed, wall, boot);
            if (timer != null) set(db, "rest", timer.toString());
            db.setTransactionSuccessful(); return timer;
        } finally { db.endTransaction(); }
    }
    public void editRest(boolean extend, long elapsed) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONObject timer = rest();
            if (timer != null) set(db, "rest", (extend ? RestState.extend(timer, elapsed) : RestState.stop(timer)).toString());
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public JSONObject claimRest(String id, long revision, long elapsed) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONObject timer = rest();
            if (timer == null || !timer.optBoolean("active") || !timer.getString("id").equals(id)
                || timer.getLong("revision") != revision || RestState.remaining(timer, elapsed) > 0) return null;
            set(db, "rest", RestState.stop(timer).toString());
            db.setTransactionSuccessful(); return timer;
        } finally { db.endTransaction(); }
    }
    public WorkProtocol logSet(String id, JSONObject expected, JSONObject changes, long elapsed, long wall, int boot) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (blocked(db)) throw new IllegalStateException("Review the pending watch actions on your phone first.");
            JSONObject snapshot = savedSnapshot(db);
            if (snapshot == null) throw new IllegalStateException("Send a workout from your phone first.");
            if (!snapshot.has("sequences")) throw new IllegalStateException("Update the phone app and send this workout again to enable set logging.");
            if (effects(db).length() >= MAX_QUEUED) throw new IllegalStateException("Open your phone to refresh the workout before logging more sets.");
            JSONObject step = WatchProjection.step(snapshot, id);
            if (!WatchProjection.equal(step.getJSONObject("actual"), expected)) throw new IllegalStateException("This set changed. Select it again to review the latest values.");
            if (!step.getBoolean("supported")) throw new IllegalStateException("Log this exercise on your phone.");
            if (step.getJSONObject("actual").getBoolean("completed")) throw new IllegalStateException("This set is already completed.");
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
    public void undoLast() throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (blocked(db)) throw new IllegalStateException("Review failed actions before undoing.");
            String text = value(db, "lastAction");
            if (text == null) throw new IllegalStateException("No watch set to undo.");
            JSONObject last = new JSONObject(text), original = last.getJSONObject("body"), snapshot = savedSnapshot(db);
            if (!original.getString("sessionId").equals(snapshot.getString("sessionId")) || !original.getString("epoch").equals(snapshot.getString("epoch")))
                throw new IllegalStateException("That action belongs to another workout.");
            JSONObject step = WatchProjection.step(snapshot, original.getString("setId"));
            JSONObject expected = new JSONObject(original.getJSONObject("expected").toString());
            for (var keys = original.getJSONObject("changes").keys(); keys.hasNext();) {
                String key = keys.next(); expected.put(key, original.getJSONObject("changes").get(key));
            }
            if (!WatchProjection.equal(step.getJSONObject("actual"), expected)) throw new IllegalStateException("This set changed. Review it on your phone.");
            JSONObject draft = new JSONObject().put("baseRevision", snapshot.getLong("revision")).put("action", "set")
                .put("prescriptionId", original.getString("prescriptionId")).put("exerciseId", original.getString("exerciseId"))
                .put("setId", original.getString("setId")).put("expected", expected).put("changes", original.getJSONObject("expected"));
            enqueueCommand(draft);
            JSONObject timer = rest();
            if (timer != null && last.getString("id").equals(timer.getString("source"))) set(db, "rest", RestState.stop(timer).toString());
            db.delete("state", "key='lastAction'", null); project(db);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public void acceptPhoneValues() throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (count(db, "out", "command") > 0) throw new IllegalStateException("Open your phone and wait for pending actions to sync first.");
            ContentValues row = new ContentValues(); row.put("state", "reviewed");
            db.update("packets", row, "direction='in' AND type='result' AND state IN ('rejected','conflict')", null);
            project(db); db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    private String existing(SQLiteDatabase db, String direction, String type, String id) {
        try (Cursor c = db.rawQuery("SELECT data FROM packets WHERE direction=? AND type=? AND id=?", new String[]{direction,type,id})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }
    private int count(SQLiteDatabase db, String direction, String type) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM packets WHERE direction=? AND type=?", new String[]{direction,type})) {
            c.moveToFirst(); return c.getInt(0);
        }
    }
    private void put(SQLiteDatabase db, String direction, String peer, WorkProtocol packet, String state) throws Exception {
        String text = new String(packet.encode(), StandardCharsets.UTF_8);
        String old = existing(db, direction, packet.type, packet.id);
        if (old != null) {
            if (!old.equals(text)) throw new IllegalArgumentException("Packet ID reused with different content");
            return;
        }
        if (count(db, direction, packet.type) >= MAX_QUEUED) throw new IllegalStateException("Pending work storage is full. Open the phone to sync.");
        ContentValues row = new ContentValues(); row.put("direction", direction); row.put("type", packet.type);
        row.put("id", packet.id); row.put("peer", peer); row.put("data", text); row.put("state", state);
        db.insertOrThrow("packets", null, row);
    }
    private void remove(SQLiteDatabase db, String direction, String type, String id) {
        db.delete("packets", "direction=? AND type=? AND id=?", new String[]{direction,type,id});
    }
    private boolean peerMatches(SQLiteDatabase db, String direction, String type, String id, String peer) {
        try (Cursor c = db.rawQuery("SELECT peer FROM packets WHERE direction=? AND type=? AND id=?", new String[]{direction,type,id})) {
            return c.moveToFirst() && c.getString(0).equals(peer);
        }
    }
    private boolean paused(SQLiteDatabase db) { return value(db, "control") != null; }
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
            set(db, "phonePeer", peer);
            set(db, "confirmation", "{}");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    /** Used by the later watch UI; identity and sequence allocation are atomic with the outbox write. */
    public WorkProtocol enqueueCommand(JSONObject draft) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONObject snapshot = savedSnapshot(db);
            String peer = value(db, "watchPeer");
            if (paused(db)) throw new IllegalStateException("Phone has control. Send the workout from your phone to resume on watch.");
            if (snapshot == null || peer == null) throw new IllegalStateException("No saved workout");
            String epoch = snapshot.getString("epoch");
            String sequenceKey = "sequence:" + epoch;
            String old = value(db, sequenceKey);
            long sequence = old == null ? 1 : Long.parseLong(old) + 1;
            String device = value(db, "device");
            if (device == null) { device = UUID.randomUUID().toString(); set(db, "device", device); }
            JSONObject body = new JSONObject(draft.toString()).put("protocolVersion", 1)
                .put("epoch", epoch).put("sessionId", snapshot.getString("sessionId"))
                .put("deviceId", device).put("sequence", sequence);
            WorkProtocol packet = new WorkProtocol(UUID.randomUUID().toString(), "command", body);
            put(db, "out", peer, packet, "pending");
            set(db, sequenceKey, Long.toString(sequence));
            db.setTransactionSuccessful(); return packet;
        } finally { db.endTransaction(); }
    }
    public void complete(String peer, WorkProtocol result) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            if (!result.type.equals("result") || !peerMatches(db, "in", "command", result.id, peer))
                throw new IllegalArgumentException("Unknown received command");
            put(db, "out", peer, result, "pending");
            remove(db, "in", "command", result.id);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public WorkProtocol receive(String peer, WorkProtocol packet, boolean watch) throws Exception {
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
                if (count(db, "out", "command") > 0 && (!same || !peer.equals(value(db, "watchPeer"))))
                    return packet.acknowledgement("rejected", "Sync pending watch actions before switching workouts.");
                if (previous != null && same && packet.body.getLong("revision") < previous.getLong("revision"))
                    return packet.acknowledgement("rejected", "Snapshot is older than the saved workout.");
                db.delete("state", "key='control'", null);
                set(db, "baseSnapshot", packet.body.toString()); set(db, "watchPeer", peer);
                JSONArray kept = new JSONArray(), oldEffects = effects(db);
                if (same) for (int i = 0; i < oldEffects.length(); i++) if (oldEffects.getJSONObject(i).getLong("revision") > packet.body.getLong("revision")) kept.put(oldEffects.getJSONObject(i));
                set(db, "effects", kept.toString());
                if (!same) {
                    if (rest() != null) set(db, "rest", RestState.stop(rest()).toString());
                    db.delete("state", "key='lastAction'", null);
                }
                project(db);
                set(db, "snapshotId", packet.id);
            } else if (packet.type.equals("control") && watch) {
                if (!peer.equals(value(db, "watchPeer"))) throw new IllegalArgumentException("Unknown phone control");
                String prior = value(db, "controlPacket");
                if (prior != null) {
                    WorkProtocol previousControl = WorkProtocol.decode(prior.getBytes(StandardCharsets.UTF_8));
                    if (packet.id.equals(previousControl.id)) {
                        if (!packet.body.toString().equals(previousControl.body.toString())) throw new IllegalArgumentException("Changed control packet");
                        db.setTransactionSuccessful(); return WorkProtocol.decode(value(db, "controlAck").getBytes(StandardCharsets.UTF_8));
                    }
                }
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
                int boot = android.provider.Settings.Global.getInt(context.getContentResolver(), android.provider.Settings.Global.BOOT_COUNT, 0);
                long restRemaining = currentRest == null || currentRest.optInt("boot", -1) != boot ? 0
                    : RestState.remaining(currentRest, android.os.SystemClock.elapsedRealtime());
                if (rest() != null) set(db, "rest", RestState.stop(rest()).toString());
                String device = value(db, "device");
                if (device == null) { device = UUID.randomUUID().toString(); set(db, "device", device); }
                String sequence = value(db, "sequence:" + snapshot.getString("epoch"));
                WorkProtocol ack = new WorkProtocol(packet.id, "ack", new JSONObject().put("type", "control")
                    .put("state", "received").put("reason", "").put("deviceId", device)
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
                    JSONObject base = baseSnapshot(db);
                    if (packet.body.getString("state").equals("committed") && base != null
                        && base.getString("sessionId").equals(command.body.getString("sessionId"))
                        && packet.body.getLong("revision") > base.getLong("revision")) {
                        JSONArray local = effects(db);
                        if (local.length() >= MAX_QUEUED) throw new IllegalStateException("Refresh the workout from your phone.");
                        local.put(new JSONObject().put("body", command.body).put("revision", packet.body.getLong("revision")));
                        set(db, "effects", local.toString());
                    }
                    if (!packet.body.getString("state").equals("committed") && rest() != null && rest().getString("source").equals(packet.id))
                        set(db, "rest", RestState.stop(rest()).toString());
                    String last = value(db, "lastAction");
                    if (!packet.body.getString("state").equals("committed") && last != null && new JSONObject(last).getString("id").equals(packet.id))
                        db.delete("state", "key='lastAction'", null);
                }
                // Only final committed results may be compacted. Rejected/conflicting work remains reviewable.
                db.execSQL("DELETE FROM packets WHERE rowid IN (SELECT rowid FROM packets WHERE direction='in' AND type='result' AND state IN ('committed','reviewed') ORDER BY rowid DESC LIMIT -1 OFFSET 50)");
                put(db, "in", peer, packet, packet.body.getString("state"));
                remove(db, "out", "command", packet.id);
                project(db);
            } else if (packet.type.equals("ack")) {
                String type = packet.body.getString("type");
                if (!peerMatches(db, "out", type, packet.id, peer)) return null;
                if (type.equals("snapshot")) set(db, "confirmation", packet.json().toString());
                if (type.equals("control")) set(db, "controlConfirmation", packet.json().toString());
                if (packet.body.getString("state").equals("received")) {
                    if (type.equals("command")) {
                        ContentValues row = new ContentValues(); row.put("state", "received");
                        db.update("packets", row, "direction='out' AND type='command' AND id=?", new String[]{packet.id});
                    } else remove(db, "out", type, packet.id);
                } else {
                    ContentValues row = new ContentValues(); row.put("state", "rejected");
                    db.update("packets", row, "direction='out' AND type=? AND id=?", new String[]{type, packet.id});
                }
                db.setTransactionSuccessful(); return null;
            } else throw new IllegalArgumentException("Unexpected packet for this device");
            db.setTransactionSuccessful();
            return packet.acknowledgement("received", "");
        } finally { db.endTransaction(); }
    }
    public JSONArray packets(String direction, String type) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT peer,data,state FROM packets WHERE direction=? AND type=? ORDER BY rowid", new String[]{direction,type})) {
            while (c.moveToNext()) rows.put(new JSONObject().put("peer", c.getString(0))
                .put("packet", new JSONObject(c.getString(1))).put("state", c.getString(2)));
        }
        return rows;
    }
    public JSONArray outgoing() throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT peer,data FROM packets WHERE direction='out' AND state='pending' ORDER BY rowid LIMIT 16", null)) {
            while (c.moveToNext()) rows.put(new JSONObject().put("peer", c.getString(0)).put("packet", new JSONObject(c.getString(1))));
        }
        return rows;
    }
    public void retryReceivedCommands() {
        ContentValues row = new ContentValues(); row.put("state", "pending");
        getWritableDatabase().update("packets", row, "direction='out' AND type='command' AND state='received'", null);
    }
    public JSONObject inspect() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        String confirmation = value(db, "confirmation");
        return new JSONObject().put("snapshot", savedSnapshot(db) == null ? JSONObject.NULL : savedSnapshot(db))
            .put("snapshotId", value(db, "snapshotId") == null ? JSONObject.NULL : value(db, "snapshotId"))
            .put("confirmation", confirmation == null ? JSONObject.NULL : new JSONObject(confirmation))
            .put("rest", rest() == null ? JSONObject.NULL : rest())
            .put("control", value(db, "control") == null ? JSONObject.NULL : new JSONObject(value(db, "control")))
            .put("published", value(db, "published") == null ? JSONObject.NULL : new JSONObject(value(db, "published")))
            .put("controlConfirmation", value(db, "controlConfirmation") == null ? JSONObject.NULL : new JSONObject(value(db, "controlConfirmation")))
            .put("canUndo", !paused(db) && value(db, "lastAction") != null).put("blocked", blocked(db))
            .put("inbox", packets("in", "command")).put("pending", packets("out", "command"))
            .put("results", packets("in", "result"));
    }
}
