package com.ironpath.wearlink;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;

/** Builds the watch UI view of WorkStore.inspect() (design §6.3) on top of the v1 report keys. */
final class WatchView {
    private WatchView() { }

    static JSONObject build(WorkStore store, SQLiteDatabase db, JSONObject report, JSONObject snapshot, Clock clock) throws Exception {
        boolean shared = snapshot != null && snapshot.optInt("protocolVersion") == 2;
        String mode = snapshot == null ? "none" : shared ? "shared" : "legacy";
        JSONObject closed = store.object(db, "closed");
        boolean visible = snapshot != null && !store.closedSessionSet(db).contains(WorkStore.closedKey(snapshot));
        JSONObject freeze = store.object(db, "freeze");
        if (freeze != null && (snapshot == null || !snapshot.getString("sessionId").equals(freeze.optString("sessionId")))) freeze = null;

        // Peer compatibility.
        JSONObject helloRow = store.peerHello(store.value(db, "watchPeer"));
        JSONObject hello = helloRow == null ? null : helloRow.getJSONObject("hello");
        String watchVersion = versionName(store.context());
        Object protocol = hello != null ? (Object) maxCommon(hello.getJSONArray("protocols")) : snapshot != null && !shared ? (Object) 1 : JSONObject.NULL;
        Object phoneVersion = hello != null ? hello.getString("versionName")
            : shared ? snapshot.getJSONObject("phone").getString("versionName") : JSONObject.NULL;
        boolean incompatible = "legacy".equals(mode) && !WorkStore.sharedHello(hello);
        String pairKey = incompatible ? watchVersion + "|" + (phoneVersion instanceof String ? phoneVersion : "legacy") : null;
        boolean updatePending = pairKey != null && !pairKey.equals(store.value(db, "updateAck"));

        // Sync.
        JSONObject status = store.status(db);
        JSONArray conflicts = snapshot == null ? new JSONArray() : store.conflictsFor(db, snapshot);
        boolean legacyBlocked = "legacy".equals(mode) && store.blockedV1(db);
        String lastSynced = store.value(db, "lastSyncedWall");
        JSONObject sync = new JSONObject().put("pendingMutations", status.getLong("pendingMutations"))
            .put("receivedMutations", status.getLong("receivedMutations")).put("pendingRestOps", status.getLong("pendingRestOps"))
            .put("reviewCount", conflicts.length()).put("phoneReachable", !"false".equals(store.value(db, "peerReachable")))
            .put("lastSyncedWall", lastSynced == null ? JSONObject.NULL : Long.parseLong(lastSynced));
        String syncState = incompatible ? "updateNeeded" : conflicts.length() > 0 || legacyBlocked ? "needsReview"
            : status.getLong("receivedMutations") > 0 ? "waitingForPhone"
            : status.getLong("pendingMutations") + status.getLong("pendingRestOps") > 0 ? "savedOnWatch" : "synced";

        // Workout, next, rest, undo.
        JSONObject workout = null, next = null;
        JSONObject last = store.object(db, "lastAction");
        if (visible) {
            JSONObject received = store.object(db, "snapshotReceived");
            workout = new JSONObject().put("epoch", snapshot.getString("epoch")).put("sessionId", snapshot.getString("sessionId"))
                .put("title", snapshot.getString("title")).put("revision", snapshot.getLong("revision"))
                .put("controlRevision", snapshot.optLong("controlRevision")).put("elapsedSeconds", snapshot.optDouble("elapsedSeconds", 0))
                .put("elapsedRunning", snapshot.optBoolean("elapsedRunning")).put("elapsedReceivedElapsed", received == null ? JSONObject.NULL : received.getLong("elapsed"))
                .put("elapsedUncertain", received == null || received.getInt("boot") != clock.boot)
                .put("vibrate", snapshot.optBoolean("vibrate", true)).put("steps", snapshot.getJSONArray("steps"));
            next = NextUp.compute(snapshot, last == null ? null : setId(last.getJSONObject("body")));
        }
        JSONObject rest = rest(store, db, clock, sync.getBoolean("phoneReachable"));
        JSONObject undo = null;
        boolean canUndo = last != null && visible && freeze == null && !store.pausedV1(db) && !legacyBlocked;
        if (canUndo) {
            String set = setId(last.getJSONObject("body"));
            JSONObject step = WatchProjection.stepOrNull(snapshot, set);
            boolean review = step == null || step.optBoolean("review");
            for (int i = 0; i < conflicts.length(); i++) review |= conflicts.getJSONObject(i).getString("setId").equals(set);
            if (!review) undo = new JSONObject().put("opId", last.getString("id")).put("setId", set).put("label", "Undo set " + step.getInt("setNumber"));
        }

        JSONObject closedView = null;
        if (closed != null) {
            long unsynced = status.getLong("pendingMutations") + status.getLong("receivedMutations");
            closedView = new JSONObject().put("sessionId", closed.getString("sessionId")).put("reason", closed.getString("reason"))
                .put("summary", closed.getJSONObject("summary")).put("unsynced", unsynced);
        }
        JSONObject control = store.object(db, "control");
        JSONObject legacy = "legacy".equals(mode) ? new JSONObject().put("blocked", legacyBlocked)
            .put("canUndo", last != null && !store.pausedV1(db))
            .put("control", control == null ? JSONObject.NULL : new JSONObject().put("owner", control.optString("owner", "phone"))) : null;

        String phase = updatePending ? "updateNeeded" : closed != null ? "closed" : freeze != null ? "finishing"
            : control != null && "legacy".equals(mode) ? "phoneControl" : !visible ? "idle"
            : rest != null && "running".equals(rest.getString("state")) && rest.getLong("remainingMs") > 0 ? "resting" : "active";

        return report.put("phase", phase).put("mode", mode).put("syncState", syncState).put("sync", sync)
            .put("peer", new JSONObject().put("protocol", protocol).put("phoneVersion", phoneVersion).put("watchVersion", watchVersion)
                .put("updatePairKey", pairKey == null ? JSONObject.NULL : pairKey).put("updateTarget", incompatible ? "phone" : JSONObject.NULL))
            .put("workout", nullable(workout)).put("next", nullable(next)).put("rest", nullable(rest)).put("undo", nullable(undo))
            .put("conflicts", conflicts)
            .put("freeze", freeze == null ? JSONObject.NULL : new JSONObject().put("id", freeze.getString("id"))
                .put("reason", freeze.getString("reason")).put("sinceWall", freeze.getLong("sinceWall")))
            .put("closed", nullable(closedView)).put("alerts", store.alertFacts()).put("legacy", nullable(legacy));
    }

    /** The rest view; also keeps the v1 keys {@code id} and {@code active}. */
    static JSONObject rest(WorkStore store, SQLiteDatabase db, Clock clock, boolean phoneReachable) throws Exception {
        JSONObject timer = store.rest();
        if (timer == null) return null;
        boolean shared = timer.has("epoch") && !timer.isNull("epoch");
        String id = timer.getString("id");
        long localRev = timer.optLong("localRev", timer.optLong("revision"));
        JSONObject armedLocal = store.object(db, "restArmedLocal");
        boolean armedMatches = armedLocal != null && armedLocal.getString("timerId").equals(id) && armedLocal.getLong("localRev") == localRev;
        boolean armed = armedMatches && armedLocal.getBoolean("armed");
        String reason = armedMatches ? armedLocal.optString("reason", "ok") : "pending";
        Object revision = shared && timer.opt("revision") instanceof Number ? timer.get("revision") : JSONObject.NULL;
        JSONObject alert = timer.optJSONObject("alert");
        String backup = alert == null ? "scheduled" : alert.optString("phoneBackup", "scheduled");
        String destination;
        if (!shared) destination = armed ? "watch" : "none";
        else if (!armed) destination = "off".equals(backup) ? "none" : "phone";
        else {
            JSONObject acked = store.object(db, "restArmedAcked");
            JSONObject ackedBody = acked == null ? null : acked.optJSONObject("body");
            boolean confirmed = ackedBody != null && ackedBody.getString("timerId").equals(id) && ackedBody.getBoolean("armed")
                && revision instanceof Number && ackedBody.getLong("revision") == ((Number) revision).longValue();
            destination = confirmed || "suppressed".equals(backup) || "off".equals(backup) || !phoneReachable ? "watch" : "both";
        }
        boolean pendingSync = false;
        JSONArray ops = store.packets("out", "restOp");
        for (int i = 0; i < ops.length(); i++) pendingSync |= ops.getJSONObject(i).getJSONObject("packet").getJSONObject("body").getString("timerId").equals(id);
        boolean test = timer.optBoolean("test") || "test".equals(timer.optString("source"));
        return new JSONObject().put("timerId", id).put("id", id).put("localRev", localRev).put("revision", revision)
            .put("state", RestRules.state(timer)).put("active", RestRules.running(timer))
            .put("endsElapsed", timer.getLong("endsElapsed")).put("remainingMs", RestRules.remaining(timer, clock.elapsed))
            .put("durationMs", RestRules.duration(timer)).put("origin", timer.optString("origin", "watch"))
            .put("sourceOp", timer.opt("sourceOp") == null ? timer.opt("source") == null ? JSONObject.NULL : timer.get("source") : timer.get("sourceOp"))
            .put("next", timer.opt("next") == null ? JSONObject.NULL : timer.get("next")).put("pendingSync", pendingSync)
            .put("uncertain", timer.optBoolean("uncertain")).put("recovery", timer.opt("recovery") == null ? JSONObject.NULL : timer.get("recovery"))
            .put("test", test).put("vibrate", timer.optBoolean("vibrate", true))
            .put("alert", new JSONObject().put("destination", destination).put("armed", armed).put("reason", reason));
    }

    private static String setId(JSONObject body) throws Exception {
        return body.has("target") ? body.getJSONObject("target").getString("setId") : body.getString("setId");
    }
    private static int maxCommon(JSONArray protocols) {
        int best = 0;
        for (int i = 0; i < protocols.length(); i++) { int p = protocols.optInt(i); if ((p == 1 || p == 2) && p > best) best = p; }
        return best;
    }
    static String versionName(Context context) {
        try { String name = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; return name == null ? "0" : name; }
        catch (Exception error) { return "0"; }
    }
    static long versionCode(Context context) {
        try {
            android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Math.max(1, android.os.Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
        } catch (Exception error) { return 1; }
    }
    private static Object nullable(Object value) { return value == null ? JSONObject.NULL : value; }
}
