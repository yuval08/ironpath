package com.ironpath.wearlink;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.SystemClock;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Bounded diagnostic history (design §5): at most 500 events per device and 14 days. It is its own
 * database file, so pruning can never touch pending work. Recording never throws.
 */
public final class Diagnostics extends SQLiteOpenHelper {
    public static final int MAX_PER_DEVICE = 500;
    public static final long MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000;
    static final int MAX_DATA_BYTES = 2048;
    public static final List<String> TYPES = Collections.unmodifiableList(Arrays.asList(
        "app.start", "perm.snapshot", "sync.peer", "sync.hello", "sync.snapshot", "sync.mutation", "sync.review",
        "sync.queueFull", "sync.storageFailure", "sync.freeze", "sync.unfreeze", "sync.closed", "sync.migration",
        "rest.op", "rest.scheduled", "rest.armed", "rest.callback", "rest.delivered", "rest.suppressed", "rest.fallback",
        "rest.recovered", "rest.failure", "rest.feedback", "diag.request", "diag.import"));
    private static Diagnostics instance;
    private static Context owner;
    /** Tests force the device role; null means "ask the package manager". */
    static String deviceOverride;

    private Diagnostics(Context context) { super(context, "wear-link-events.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, device TEXT NOT NULL, "
            + "type TEXT NOT NULL, at INTEGER NOT NULL, elapsed INTEGER NOT NULL, boot INTEGER NOT NULL, "
            + "session TEXT, timer TEXT, rev INTEGER, op TEXT, data TEXT NOT NULL, UNIQUE(device,id))");
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int from, int to) { throw new IllegalStateException("Missing migration"); }

    static synchronized Diagnostics store(Context c) {
        Context app = c.getApplicationContext() != null ? c.getApplicationContext() : c;
        if (instance == null || owner != app) { instance = new Diagnostics(app); owner = app; }
        return instance;
    }
    public static String device(Context c) {
        if (deviceOverride != null) return deviceOverride;
        return c.getPackageManager().hasSystemFeature("android.hardware.type.watch") ? "watch" : "phone";
    }
    public static boolean known(String type) { return TYPES.contains(type) || (type != null && type.startsWith("js.") && type.length() <= 40); }

    /** fields may include sessionId, timerId, revision, opId and data (object). Never throws. */
    public static void record(Context c, String type, JSONObject fields) {
        try {
            if (!known(type)) throw new IllegalArgumentException("Unknown diagnostic type " + type);
            JSONObject f = fields == null ? new JSONObject() : fields;
            JSONObject data = f.optJSONObject("data") == null ? new JSONObject() : f.optJSONObject("data");
            if (data.toString().getBytes(StandardCharsets.UTF_8).length > MAX_DATA_BYTES) data = new JSONObject().put("truncated", true);
            JSONObject event = new JSONObject().put("id", UUID.randomUUID().toString()).put("seq", 0)
                .put("device", device(c)).put("type", type).put("at", System.currentTimeMillis())
                .put("elapsed", SystemClock.elapsedRealtime()).put("boot", Math.max(0, Clock.boot(c)))
                .put("sessionId", text(f.opt("sessionId"), 512)).put("timerId", uuid(f.opt("timerId")))
                .put("revision", f.opt("revision") instanceof Number ? f.get("revision") : JSONObject.NULL)
                .put("opId", uuid(f.opt("opId"))).put("data", data);
            store(c).insert(event);
        } catch (Throwable error) {
            Log.w("IronpathDiag", "Diagnostic event dropped", error);
        }
    }
    /**
     * Records {@code type} with {@code data} only when data differs from the last one recorded this way
     * (e.g. perm.snapshot on resume). Returns whether it recorded. Never throws.
     */
    public static boolean recordIfChanged(Context c, String type, JSONObject data) {
        try {
            Diagnostics store = store(c);
            String key = "last:" + type, text = data.toString();
            synchronized (store) {
                if (text.equals(meta(store.getReadableDatabase(), key))) return false;
                ContentValues row = new ContentValues(); row.put("key", key); row.put("value", text);
                store.getWritableDatabase().insertWithOnConflict("meta", null, row, SQLiteDatabase.CONFLICT_REPLACE);
            }
            record(c, type, new JSONObject().put("data", data));
            return true;
        } catch (Throwable error) {
            Log.w("IronpathDiag", "Diagnostic event dropped", error);
            return false;
        }
    }
    /** Convenience: record with a data object only. */
    public static void record(Context c, String type, JSONObject data, String sessionId, String timerId, Long revision, String opId) {
        try {
            record(c, type, new JSONObject().put("data", data == null ? new JSONObject() : data)
                .put("sessionId", sessionId == null ? JSONObject.NULL : sessionId).put("timerId", timerId == null ? JSONObject.NULL : timerId)
                .put("revision", revision == null ? JSONObject.NULL : revision).put("opId", opId == null ? JSONObject.NULL : opId));
        } catch (Throwable error) { Log.w("IronpathDiag", "Diagnostic event dropped", error); }
    }
    private static Object text(Object value, int max) {
        return value instanceof String && ((String) value).length() <= max ? value : JSONObject.NULL;
    }
    private static Object uuid(Object value) {
        try { return value instanceof String && UUID.fromString((String) value).toString().equals(value) ? value : JSONObject.NULL; }
        catch (IllegalArgumentException error) { return JSONObject.NULL; }
    }

    /** Inserts one validated event and prunes in the same transaction. False when it was a duplicate. */
    synchronized boolean insert(JSONObject event) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            ContentValues row = new ContentValues();
            row.put("id", event.getString("id")); row.put("device", event.getString("device")); row.put("type", event.getString("type"));
            row.put("at", event.getLong("at")); row.put("elapsed", event.getLong("elapsed")); row.put("boot", event.getLong("boot"));
            if (!event.isNull("sessionId")) row.put("session", event.getString("sessionId"));
            if (!event.isNull("timerId")) row.put("timer", event.getString("timerId"));
            if (!event.isNull("revision")) row.put("rev", event.getLong("revision"));
            if (!event.isNull("opId")) row.put("op", event.getString("opId"));
            row.put("data", event.getJSONObject("data").toString());
            boolean inserted = db.insertWithOnConflict("events", null, row, SQLiteDatabase.CONFLICT_IGNORE) != -1;
            prune(db, event.getString("device"), System.currentTimeMillis());
            db.setTransactionSuccessful();
            return inserted;
        } finally { db.endTransaction(); }
    }
    private static void prune(SQLiteDatabase db, String device, long now) {
        db.execSQL("DELETE FROM events WHERE at < ?", new Object[]{now - MAX_AGE_MS});
        db.execSQL("DELETE FROM events WHERE device = ? AND seq NOT IN (SELECT seq FROM events WHERE device = ? ORDER BY seq DESC LIMIT "
            + MAX_PER_DEVICE + ")", new Object[]{device, device});
    }
    private static JSONObject event(Cursor c) throws Exception {
        return new JSONObject().put("id", c.getString(1)).put("seq", c.getLong(0)).put("device", c.getString(2))
            .put("type", c.getString(3)).put("at", c.getLong(4)).put("elapsed", c.getLong(5)).put("boot", c.getLong(6))
            .put("sessionId", c.isNull(7) ? JSONObject.NULL : c.getString(7)).put("timerId", c.isNull(8) ? JSONObject.NULL : c.getString(8))
            .put("revision", c.isNull(9) ? JSONObject.NULL : c.getLong(9)).put("opId", c.isNull(10) ? JSONObject.NULL : c.getString(10))
            .put("data", new JSONObject(c.getString(11)));
    }
    private static final String COLUMNS = "seq,id,device,type,at,elapsed,boot,session,timer,rev,op,data";

    /** Newest first; deviceOrNull filters to "phone" or "watch". */
    public static JSONArray recent(Context c, String deviceOrNull, int limit) {
        JSONArray events = new JSONArray();
        try (Cursor cursor = store(c).getReadableDatabase().rawQuery("SELECT " + COLUMNS + " FROM events"
            + (deviceOrNull == null ? "" : " WHERE device=?") + " ORDER BY at DESC, seq DESC LIMIT " + Math.max(0, Math.min(limit, 1000)),
            deviceOrNull == null ? null : new String[]{deviceOrNull})) {
            while (cursor.moveToNext()) events.put(event(cursor));
        } catch (Exception error) { Log.w("IronpathDiag", "Diagnostics unavailable", error); }
        return events;
    }
    /** {phone:{count,oldestAt}, watch:{count,oldestAt,lastRetrievedAt}} */
    public static JSONObject summary(Context c) {
        JSONObject summary = new JSONObject();
        try {
            SQLiteDatabase db = store(c).getReadableDatabase();
            for (String device : new String[]{"phone", "watch"}) {
                try (Cursor cursor = db.rawQuery("SELECT COUNT(*), MIN(at) FROM events WHERE device=?", new String[]{device})) {
                    cursor.moveToFirst();
                    summary.put(device, new JSONObject().put("count", cursor.getLong(0)).put("oldestAt", cursor.isNull(1) ? JSONObject.NULL : cursor.getLong(1)));
                }
            }
            String retrieved = meta(db, "lastRetrievedAt");
            summary.getJSONObject("watch").put("lastRetrievedAt", retrieved == null ? JSONObject.NULL : Long.parseLong(retrieved));
        } catch (Exception error) { Log.w("IronpathDiag", "Diagnostics unavailable", error); }
        return summary;
    }
    /** Highest local sequence of this device's own events (watch status / diag cursor). */
    public static long lastSeq(Context c) {
        try (Cursor cursor = store(c).getReadableDatabase().rawQuery("SELECT MAX(seq) FROM events WHERE device=?", new String[]{device(c)})) {
            return cursor.moveToFirst() && !cursor.isNull(0) ? cursor.getLong(0) : 0;
        } catch (Exception error) { return 0; }
    }
    /** Watch side of diagRequest: own events after {@code afterSeq}, oldest first, within {@code maxBytes}. */
    public static JSONObject chunk(Context c, long afterSeq, int max, int maxBytes) throws Exception {
        JSONArray events = new JSONArray();
        long last = afterSeq; boolean more = false; int bytes = 64;
        try (Cursor cursor = store(c).getReadableDatabase().rawQuery("SELECT " + COLUMNS + " FROM events WHERE device=? AND seq>? ORDER BY seq LIMIT "
            + (Math.min(max, 150) + 1), new String[]{device(c), Long.toString(afterSeq)})) {
            while (cursor.moveToNext()) {
                JSONObject event = event(cursor);
                int size = event.toString().getBytes(StandardCharsets.UTF_8).length + 1;
                if (events.length() >= Math.min(max, 150) || bytes + size > maxBytes) { more = true; break; }
                events.put(event); bytes += size; last = event.getLong("seq");
            }
        }
        return new JSONObject().put("events", events).put("lastSeq", last).put("more", more);
    }
    /** Phone side of diagChunk: imports watch events, deduplicated by (device,id). Returns the number added. */
    public static int importEvents(Context c, JSONArray events) {
        int added = 0;
        try {
            Diagnostics store = store(c);
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                WorkProtocol.validateEvent(event);
                if (!"watch".equals(event.getString("device"))) continue;
                if (store.insert(event)) added++;
            }
            ContentValues row = new ContentValues(); row.put("key", "lastRetrievedAt"); row.put("value", Long.toString(System.currentTimeMillis()));
            store.getWritableDatabase().insertWithOnConflict("meta", null, row, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception error) { Log.w("IronpathDiag", "Diagnostic import stopped", error); }
        return added;
    }
    private static String meta(SQLiteDatabase db, String key) {
        try (Cursor cursor = db.rawQuery("SELECT value FROM meta WHERE key=?", new String[]{key})) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }
}
