package com.ironpath.wearlink;

import static org.junit.Assert.*;
import android.content.ContentValues;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 30, manifest = Config.NONE)
public class WorkStoreV2Test {
    private static final Clock NOW = new Clock(100_000, 1_000_000, 7);
    private Context context;
    private WorkStore watch, phone;

    @Before public void setUp() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("watch-v2.db"); context.deleteDatabase("phone-v2.db");
        watch = new WorkStore(context, "watch-v2.db"); phone = new WorkStore(context, "phone-v2.db");
        watch.fixedClock = NOW; phone.fixedClock = NOW;
    }
    @After public void close() { watch.close(); phone.close(); }

    private WorkProtocol deliver(JSONObject body) throws Exception {
        WorkProtocol snapshot = V2.snapshot(body);
        phone.publish("watch", snapshot);
        WorkProtocol ack = watch.receive("phone", snapshot, true);
        phone.receive("watch", ack, false);
        return ack;
    }
    private WorkProtocol deliver(long revision) throws Exception { return deliver(V2.snapshotBody("session1", revision, 1, V2.steps())); }
    private WorkProtocol log(String setId, int reps) throws Exception {
        return watch.logSet(setId, V2.state(), V2.state().put("reps", reps).put("completed", true), NOW.elapsed, NOW.wall, NOW.boot);
    }
    private JSONObject view() throws Exception { return watch.inspect(NOW); }
    private JSONObject step(int index) throws Exception { return view().getJSONObject("workout").getJSONArray("steps").getJSONObject(index); }
    private String code(Exception error) { return error instanceof SyncError ? ((SyncError) error).code : error.getClass().getSimpleName(); }
    private String refusal(ThrowingRunnable action) {
        try { action.run(); return "none"; } catch (Exception error) { return code(error); }
    }
    interface ThrowingRunnable { void run() throws Exception; }
    private JSONArray out(String type) throws Exception { return watch.packets("out", type); }

    @Test public void migratesAV1DatabaseAndKeepsIdentitySequenceAndPendingWork() throws Exception {
        String name = "legacy-v1.db", device = "00000000-0000-4000-8000-0000000000dd";
        context.deleteDatabase(name);
        SQLiteOpenHelper v1 = new SQLiteOpenHelper(context, name, null, 1) {
            @Override public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE packets (direction TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, "
                    + "peer TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(direction,type,id))");
                db.execSQL("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
            }
            @Override public void onUpgrade(SQLiteDatabase db, int a, int b) { }
        };
        SQLiteDatabase db = v1.getWritableDatabase();
        JSONObject v1Snapshot = V2.snapshotBody("session1", 1, 1, V2.steps()).put("protocolVersion", 1);
        WorkProtocol command = new WorkProtocol(V2.uuid(), "command", new JSONObject().put("protocolVersion", 1).put("epoch", V2.EPOCH)
            .put("sessionId", "session1").put("deviceId", device).put("sequence", 3).put("baseRevision", 1).put("action", "set")
            .put("prescriptionId", "p2").put("setId", "set-3").put("exerciseId", "e-p2").put("expected", V2.state())
            .put("changes", new JSONObject().put("completed", true)));
        WorkProtocol control = new WorkProtocol(V2.uuid(), "control", new JSONObject().put("epoch", V2.EPOCH).put("sessionId", "session1")
            .put("owner", "phone").put("controlRevision", 2));
        for (WorkProtocol packet : new WorkProtocol[]{command, control}) {
            ContentValues row = new ContentValues(); row.put("direction", "out"); row.put("type", packet.type); row.put("id", packet.id);
            row.put("peer", "phone"); row.put("data", packet.json().toString()); row.put("state", "pending");
            db.insert("packets", null, row);
        }
        String[][] state = {{"device", device}, {"sequence:" + V2.EPOCH, "3"}, {"watchPeer", "phone"},
            {"snapshot", v1Snapshot.toString()}, {"baseSnapshot", v1Snapshot.toString()}};
        for (String[] kv : state) { ContentValues row = new ContentValues(); row.put("key", kv[0]); row.put("value", kv[1]); db.insert("state", null, row); }
        v1.close();

        WorkStore upgraded = new WorkStore(context, name);
        upgraded.fixedClock = NOW;
        try {
            assertEquals("2", upgraded.state("schema"));
            JSONArray outgoing = upgraded.outgoing(NOW);
            assertEquals(2, outgoing.length());
            for (int i = 0; i < 2; i++) assertEquals(WorkProtocol.PATH, WorkProtocol.decode(outgoing.getJSONObject(i).getJSONObject("packet")).path());
            // The phone upgrades to v2 for the same session: the pending v1 command keeps draining.
            assertEquals("received", upgraded.receive("phone", V2.snapshot(V2.snapshotBody("session1", 2, 3, V2.steps())), true).body.getString("state"));
            WorkProtocol mutation = upgraded.logSet("set-1", V2.state(), V2.state().put("reps", 8), NOW.elapsed, NOW.wall, NOW.boot);
            assertEquals(4, mutation.body.getLong("sequence"));
            assertEquals(device, mutation.body.getString("deviceId"));
            JSONArray steps = upgraded.inspect(NOW).getJSONObject("workout").getJSONArray("steps");
            assertTrue("v1 command still projected", steps.getJSONObject(2).getJSONObject("actual").getBoolean("completed"));
            assertTrue(steps.getJSONObject(0).getJSONObject("actual").getBoolean("completed"));
            assertEquals(1, upgraded.packets("out", "command").length());
        } finally { upgraded.close(); }
    }

    @Test public void completeIsSparseAndStartsTheLocalRestInOneTransaction() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        assertEquals("complete", m.body.getString("op"));
        assertEquals(new JSONObject("{\"reps\":8,\"completed\":true}").toString().length(), m.body.getJSONObject("changes").toString().length());
        assertTrue(m.body.getJSONObject("expected").isNull("reps"));
        assertFalse(m.body.getJSONObject("expected").getBoolean("completed"));
        assertEquals(WorkProtocol.PATH_V2, m.path());
        JSONObject view = view();
        assertEquals("resting", view.getString("phase"));
        assertEquals("shared", view.getString("mode"));
        assertEquals("savedOnWatch", view.getString("syncState"));
        assertTrue(step(0).getBoolean("pending"));
        assertTrue(step(0).getJSONObject("actual").getBoolean("completed"));
        JSONObject rest = view.getJSONObject("rest");
        assertEquals(60_000, rest.getLong("remainingMs"));
        assertEquals(m.id, rest.getString("sourceOp"));
        assertTrue(rest.getBoolean("pendingSync"));
        assertEquals("Set 2 of 2 · 8-12 reps · 60 kg", rest.getJSONObject("next").getString("text"));
        assertEquals("set-2", view.getJSONObject("next").getString("setId"));
        assertEquals("Undo set 1", view.getJSONObject("undo").getString("label"));
        JSONObject op = out("restOp").getJSONObject(0).getJSONObject("packet").getJSONObject("body");
        assertEquals("start", op.getString("op"));
        assertEquals(m.id, op.getString("sourceOp"));
        assertEquals("alreadyCompleted", refusal(() -> log("set-1", 8)));
    }

    @Test public void localRefusalsCoverStaleReviewFrozenClosedUnsupportedAndQueueFull() throws Exception {
        JSONArray steps = V2.steps();
        steps.getJSONObject(1).put("review", true);
        steps.getJSONObject(2).put("supported", false);
        JSONObject body = V2.snapshotBody("session1", 1, 1, steps);
        body.getJSONArray("reviews").put(V2.review(V2.uuid(), "set-2", "reps", 8, 10));
        deliver(body);
        assertEquals("stale", refusal(() -> watch.logSet("set-1", V2.state().put("reps", 5), V2.state().put("reps", 8), 1, 1, 7)));
        assertEquals("review", refusal(() -> log("set-2", 8)));
        assertEquals("review", refusal(() -> watch.updateSet("set-2", new JSONObject(), new JSONObject().put("reps", 9))));
        assertEquals("unsupported", refusal(() -> log("set-3", 8)));
        assertEquals("stale", refusal(() -> log("missing", 8)));
        for (int i = 0; i < WorkStore.MAX_QUEUED; i++) watch.updateSet("set-1", new JSONObject(), new JSONObject().put("weight", i + 1));
        assertEquals("queueFull", refusal(() -> watch.updateSet("set-1", new JSONObject(), new JSONObject().put("weight", 1000))));
        assertEquals(WorkStore.MAX_QUEUED, out("mutation").length());
        assertEquals(WorkStore.MAX_QUEUED, step(0).getJSONObject("actual").getInt("weight"));
    }

    @Test public void frozenAndClosedSessionsRefuseActions() throws Exception {
        deliver(1);
        log("set-1", 8);
        String freezeId = V2.uuid();
        watch.receive("phone", V2.control("session1", 2, "freeze", freezeId, "finish"), true);
        assertEquals("frozen", refusal(() -> log("set-2", 8)));
        assertEquals("frozen", refusal(() -> watch.undoLast()));
        assertEquals("finishing", view().getString("phase"));
        assertEquals("running", view().getJSONObject("rest").getString("state")); // freeze leaves the rest alone
        watch.receive("phone", V2.control("session1", 3, "closed", null, "completed"), true);
        JSONObject closed = view().getJSONObject("closed");
        assertEquals("closed", view().getString("phase"));
        assertEquals("completed", closed.getString("reason"));
        assertEquals(1, closed.getJSONObject("summary").getInt("done"));
        assertEquals(3, closed.getJSONObject("summary").getInt("total"));
        assertEquals(1, closed.getLong("unsynced"));
        assertEquals("cancelled", watch.rest().getString("state"));
        assertEquals("closed", refusal(() -> log("set-2", 8)));
        assertEquals(1, out("mutation").length()); // pending work is kept so it can drain
    }

    @Test public void freezeIsIdempotentAndStaleUnfreezeOrDelayedFreezeIsIgnored() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        String freezeId = V2.uuid();
        WorkProtocol freeze = V2.control("session1", 2, "freeze", freezeId, "finish");
        WorkProtocol ack = watch.receive("phone", freeze, true);
        assertEquals("received", ack.body.getString("state"));
        assertEquals(1, ack.body.getLong("sequence"));
        assertEquals(freezeId, ack.body.getString("freezeId"));
        assertEquals(m.body.getString("deviceId"), ack.body.getString("deviceId"));
        assertEquals(ack.json().toString(), watch.receive("phone", freeze, true).json().toString());
        phone.control(freeze);
        phone.receive("watch", ack, false);
        JSONObject confirmed = phone.inspect().getJSONObject("controlConfirmation").getJSONObject("body");
        assertEquals("received", confirmed.getString("state"));
        assertEquals(1, confirmed.getLong("sequence"));
        assertEquals(freezeId, confirmed.getString("freezeId"));
        assertEquals(m.body.getString("deviceId"), confirmed.getString("deviceId"));
        WorkProtocol again = V2.control("session1", 2, "freeze", freezeId, "finish");
        assertEquals("received", watch.receive("phone", again, true).body.getString("state"));
        WorkProtocol staleUnfreeze = V2.control("session1", 3, "unfreeze", V2.uuid(), "finish");
        WorkProtocol staleAck = watch.receive("phone", staleUnfreeze, true);
        assertEquals("stale", staleAck.body.getString("code"));
        assertEquals(staleUnfreeze.body.getString("freezeId"), staleAck.body.getString("freezeId"));
        assertEquals("finishing", view().getString("phase"));
        assertEquals("received", watch.receive("phone", V2.control("session1", 3, "unfreeze", freezeId, "finish"), true).body.getString("state"));
        assertNotEquals("finishing", view().getString("phase"));
        WorkProtocol delayed = V2.control("session1", 3, "freeze", freezeId, "finish");
        assertEquals("stale", watch.receive("phone", delayed, true).body.getString("code"));
        log("set-2", 8);
    }

    @Test public void freezeRetriesMutationsOnlyAcknowledgedByNativeReceipt() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        watch.receive("phone", phone.receive("watch", m, false), true);
        assertEquals("received", out("mutation").getJSONObject(0).getString("state"));
        assertEquals("waitingForPhone", view().getString("syncState"));
        watch.receive("phone", V2.control("session1", 2, "freeze", V2.uuid(), "finish"), true);
        assertEquals("pending", out("mutation").getJSONObject(0).getString("state"));
    }

    @Test public void undoBeforeSendRevertsAndCancelsOnlyItsOwnRest() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        watch.undoLast();
        JSONArray mutations = out("mutation");
        assertEquals(2, mutations.length());
        JSONObject undo = mutations.getJSONObject(1).getJSONObject("packet").getJSONObject("body");
        assertEquals("undo", undo.getString("op"));
        assertEquals(m.id, undo.getString("undoOf"));
        assertTrue(undo.getJSONObject("changes").isNull("reps"));
        assertFalse(step(0).getJSONObject("actual").getBoolean("completed"));
        assertEquals("cancelled", watch.rest().getString("state"));
        JSONArray restOps = out("restOp");
        assertEquals("cancel", restOps.getJSONObject(1).getJSONObject("packet").getJSONObject("body").getString("op"));
        assertEquals("noUndo", refusal(() -> watch.undoLast()));
        assertTrue(view().isNull("undo"));
    }

    @Test public void undoIsRefusedWhenThePhoneChangedTheSetSince() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        JSONArray steps = V2.steps();
        steps.getJSONObject(0).getJSONObject("actual").put("completed", true).put("reps", 9);
        JSONObject body = V2.snapshotBody("session1", 3, 1, steps);
        body.getJSONObject("sequences").put(m.body.getString("deviceId"), 1);
        deliver(body);
        assertEquals("stale", refusal(() -> watch.undoLast()));
    }

    @Test public void resolveFromTheWatchIsAConditionalMutation() throws Exception {
        String reviewId = V2.uuid();
        JSONArray steps = V2.steps();
        steps.getJSONObject(1).put("review", true).getJSONObject("actual").put("completed", true).put("reps", 8);
        JSONObject body = V2.snapshotBody("session1", 1, 1, steps);
        body.getJSONArray("reviews").put(V2.review(reviewId, "set-2", "reps", 8, 10));
        deliver(body);
        JSONObject conflict = view().getJSONArray("conflicts").getJSONObject(0);
        assertEquals("set-2", conflict.getString("setId"));
        assertEquals(10, conflict.getJSONArray("fields").getJSONObject(0).getInt("watch"));
        assertEquals("needsReview", view().getString("syncState"));
        WorkProtocol resolve = watch.resolveConflict(reviewId, false);
        assertEquals("watch", resolve.body.getString("keep"));
        assertEquals(8, resolve.body.getJSONObject("expected").getInt("reps"));
        assertEquals(10, resolve.body.getJSONObject("changes").getInt("reps"));
        assertEquals("watch", view().getJSONArray("conflicts").getJSONObject(0).getString("queuedResolution"));
        assertEquals("pending", refusal(() -> watch.resolveConflict(reviewId, true)));
        assertEquals(10, step(1).getJSONObject("actual").getInt("reps")); // projected optimistically
        watch.receive("phone", V2.result(resolve, "committed", "ok", 2, false, null), true);
        steps.getJSONObject(1).put("review", false).getJSONObject("actual").put("reps", 10);
        JSONObject resolved = V2.snapshotBody("session1", 2, 1, steps);
        resolved.getJSONObject("sequences").put(resolve.body.getString("deviceId"), 1);
        deliver(resolved);
        assertEquals(0, view().getJSONArray("conflicts").length());
        assertEquals("stale", refusal(() -> watch.resolveConflict(reviewId, true)));
    }

    @Test public void aConflictResultBlocksOnlyItsSetUntilASnapshotDropsIt() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 10);
        JSONArray fields = new JSONArray().put(new JSONObject().put("field", "reps").put("phone", 8).put("requested", 10).put("conflict", true));
        watch.receive("phone", V2.result(m, "conflict", "fieldConflict", 1, true, fields), true);
        JSONObject view = view();
        assertEquals(1, view.getJSONArray("conflicts").length());
        assertEquals(m.id, view.getJSONArray("conflicts").getJSONObject(0).getString("id"));
        assertEquals("needsReview", view.getString("syncState"));
        assertTrue(view.isNull("undo"));
        assertEquals("review", refusal(() -> log("set-1", 8)));
        log("set-3", 5); // other sets stay usable in v2
        JSONObject later = V2.snapshotBody("session1", 2, 1, V2.steps());
        later.getJSONObject("sequences").put(m.body.getString("deviceId"), 1);
        deliver(later);
        assertEquals(0, view().getJSONArray("conflicts").length());
    }

    @Test public void committedResultsBecomeEffectsAndTheOutboxClears() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        phone.receive("watch", m, false);
        assertEquals(1, phone.inspect().getJSONArray("inbox").length());
        WorkProtocol result = V2.result(m, "committed", "ok", 2, false, null);
        phone.complete("watch", result);
        assertEquals(0, phone.inspect().getJSONArray("inbox").length());
        WorkProtocol ack = watch.receive("phone", result, true);
        assertEquals(WorkProtocol.PATH_V2, ack.path());
        assertEquals(0, out("mutation").length());
        assertTrue(step(0).getJSONObject("actual").getBoolean("completed"));
        assertFalse(step(0).getBoolean("pending"));
        watch.receive("phone", result, true); // lost ACK retry is harmless
        phone.receive("watch", ack, false);
        assertEquals(0, phone.packets("out", "result").length());
    }

    @Test public void switchingWorkoutsRequiresTheWatermarkToCoverPendingWork() throws Exception {
        deliver(1);
        WorkProtocol m = log("set-1", 8);
        JSONObject other = V2.snapshotBody("session2", 1, 2, V2.steps());
        assertEquals("pending", deliver(other).body.getString("code"));
        // The phone bridge exposes it as confirmation.body.code (drives switch retries).
        assertEquals("pending", phone.inspect().getJSONObject("confirmation").getJSONObject("body").getString("code"));
        other.getJSONObject("sequences").put(m.body.getString("deviceId"), 1);
        assertEquals("received", deliver(other).body.getString("state"));
        assertEquals("session2", view().getJSONObject("workout").getString("sessionId"));
        assertEquals("cancelled", watch.rest().getString("state"));
        assertTrue(view().isNull("undo"));
    }

    @Test public void closedSessionsCannotBeRevived() throws Exception {
        deliver(1);
        WorkProtocol closed = V2.control("session1", 2, "closed", null, "completed");
        phone.control(closed);
        phone.receive("watch", watch.receive("phone", closed, true), false);
        assertTrue(phone.inspect().getJSONObject("controlConfirmation").getJSONObject("body").isNull("freezeId"));
        assertEquals("closed", deliver(V2.snapshotBody("session1", 5, 9, V2.steps())).body.getString("code"));
        watch.clearClosed();
        assertEquals("idle", view().getString("phase"));
        assertTrue(view().isNull("workout"));
        assertEquals("received", deliver(V2.snapshotBody("session2", 1, 10, V2.steps())).body.getString("state"));
        assertEquals("active", view().getString("phase"));
    }

    @Test public void olderControlRevisionsAndOlderSnapshotsAreRefused() throws Exception {
        deliver(V2.snapshotBody("session1", 5, 4, V2.steps()));
        assertEquals("stale", deliver(V2.snapshotBody("session1", 6, 3, V2.steps())).body.getString("code"));
        assertEquals("stale", deliver(V2.snapshotBody("session1", 4, 4, V2.steps())).body.getString("code"));
        assertEquals("stale", watch.receive("phone", V2.control("session1", 2, "freeze", V2.uuid(), "finish"), true).body.getString("code"));
    }

    @Test public void legacyPhoneNeedsAnUpdateOncePerVersionPair() throws Exception {
        JSONObject v1 = new JSONObject().put("protocolVersion", 1).put("epoch", V2.EPOCH).put("sessionId", "session1").put("revision", 1)
            .put("title", "Workout").put("status", "inProgress").put("elapsedSeconds", 0).put("sequences", new JSONObject())
            .put("steps", new JSONArray().put(new JSONObject(V2.steps().getJSONObject(0).toString())));
        JSONObject legacyStep = v1.getJSONArray("steps").getJSONObject(0);
        for (String key : new String[]{"slot", "group", "bandLabel", "review"}) legacyStep.remove(key);
        WorkProtocol snapshot = new WorkProtocol(V2.uuid(), "snapshot", v1);
        watch.receive("phone", snapshot, true);
        JSONObject view = view();
        assertEquals("legacy", view.getString("mode"));
        assertEquals("updateNeeded", view.getString("phase"));
        assertEquals("updateNeeded", view.getString("syncState"));
        assertEquals("phone", view.getJSONObject("peer").getString("updateTarget"));
        assertEquals(1, view.getJSONObject("peer").getInt("protocol"));
        watch.acknowledgeUpdate(view.getJSONObject("peer").getString("updatePairKey"));
        assertEquals("active", view().getString("phase"));
        assertFalse(view().isNull("legacy"));
        log("set-1", 8); // legacy logging still works
        assertEquals(1, watch.packets("out", "command").length());
    }

    @Test public void helloStatusAndSharedModeOnThePhone() throws Exception {
        WorkProtocol hello = watch.hello(true, "0.5.0", 5, false);
        assertEquals("watch", hello.body.getString("role"));
        assertNull(phone.receive("watch", hello, false));
        deliver(1);
        assertTrue(phone.phoneShared());
        assertEquals("0.5.0", phone.peerHello("watch").getJSONObject("hello").getString("versionName"));
        log("set-1", 8);
        WorkProtocol status = V2.outgoing(watch, "status", NOW);
        assertNotNull(status);
        assertEquals(1, status.body.getLong("pendingMutations"));
        assertEquals("received", phone.receive("watch", status, false).body.getString("state"));
        assertEquals(1, phone.watchStatus().getJSONObject("status").getLong("pendingMutations"));
    }

    @Test public void noArgInspectReturnsTheFullWatchViewWithoutThrowing() throws Exception {
        String[] keys = {"phase", "mode", "syncState", "sync", "peer", "workout", "next", "rest", "undo", "conflicts", "freeze", "closed", "alerts", "legacy"};
        JSONObject empty = watch.inspect();
        for (String key : keys) assertTrue("idle has " + key, empty.has(key));
        assertEquals("idle", empty.getString("phase"));
        assertEquals("none", empty.getString("mode"));
        deliver(1);
        log("set-1", 8);
        watch.fixedClock = null; // real clock path, as on the watch
        JSONObject view = watch.inspect();
        for (String key : keys) assertTrue("active has " + key, view.has(key));
        JSONObject step = view.getJSONObject("workout").getJSONArray("steps").getJSONObject(0);
        for (String key : new String[]{"setId", "slot", "group", "review", "pending", "actual", "workingNumber", "restAfter"}) assertTrue(key, step.has(key));
        for (String key : new String[]{"timerId", "localRev", "revision", "state", "endsElapsed", "remainingMs", "durationMs", "origin",
            "sourceOp", "next", "pendingSync", "uncertain", "recovery", "test", "alert"}) assertTrue("rest." + key, view.getJSONObject("rest").has(key));
        for (String key : new String[]{"setId", "prescriptionId", "name", "slot", "kind", "position", "weight", "unit", "bandLabel", "supported", "title", "text"})
            assertTrue("next." + key, view.getJSONObject("next").has(key));
        for (String key : new String[]{"pendingMutations", "receivedMutations", "pendingRestOps", "reviewCount", "phoneReachable", "lastSyncedWall"})
            assertTrue("sync." + key, view.getJSONObject("sync").has(key));
        for (String key : new String[]{"protocol", "phoneVersion", "watchVersion", "updatePairKey", "updateTarget"})
            assertTrue("peer." + key, view.getJSONObject("peer").has(key));
    }

    @Test public void logSetAcceptsEditorRebaseOutputIncludingPrefilledValues() throws Exception {
        deliver(1);
        JSONObject actual = step(0).getJSONObject("actual");
        // The UI pre-fills weight 60 and reps 8 as user edits, and leaves rpe untouched.
        JSONObject editor = EditorRebase.edit(EditorRebase.edit(EditorRebase.open(actual), "weight", 60), "reps", 8);
        WorkProtocol m = watch.logSet("set-1", EditorRebase.expected(editor, true), EditorRebase.changes(editor, true), NOW.elapsed, NOW.wall, NOW.boot);
        JSONObject changes = m.body.getJSONObject("changes"), expected = m.body.getJSONObject("expected");
        assertEquals(60, changes.getInt("weight"));
        assertEquals(8, changes.getInt("reps"));
        assertTrue(changes.getBoolean("completed"));
        assertTrue(expected.isNull("weight"));
        assertFalse(changes.has("rpe"));
        assertEquals(changes.length(), expected.length());
        // updateSet with a sparse editor: only the touched field is sent.
        JSONObject edit = EditorRebase.edit(EditorRebase.open(step(0).getJSONObject("actual")), "reps", 9);
        WorkProtocol u = watch.updateSet("set-1", EditorRebase.expected(edit, false), EditorRebase.changes(edit, false));
        assertEquals("{\"reps\":9}", u.body.getJSONObject("changes").toString());
        assertEquals(8, u.body.getJSONObject("expected").getInt("reps"));
    }

    @Test public void reportArmedAcceptsExactDeniedAndIsANoOpInLegacyMode() throws Exception {
        deliver(1);
        log("set-1", 8);
        JSONObject timer = watch.rest();
        timer.put("revision", 4);
        watch.putState("rest", timer.toString()); // as if the phone had confirmed revision 4
        watch.reportArmed(timer.getString("id"), timer.getLong("localRev"), false, "exactDenied", false);
        WorkProtocol armed = V2.outgoing(watch, "restArmed", NOW);
        assertEquals("pendingOps", armed.body.getString("reason")); // the start op is still unconfirmed
        // Once the phone has consumed the start op, the watch reason goes through unchanged.
        watch.write(db -> { db.delete("packets", "direction='out' AND type='restOp'", null); return null; });
        watch.reportArmed(timer.getString("id"), timer.getLong("localRev"), false, "exactDenied", false);
        assertEquals("exactDenied", V2.outgoing(watch, "restArmed", NOW).body.getString("reason"));
        assertEquals("exactDenied", watch.inspect(NOW).getJSONObject("rest").getJSONObject("alert").getString("reason"));

        WorkStore legacy = new WorkStore(context, "legacy-armed.db");
        legacy.fixedClock = NOW;
        JSONObject v1 = V2.snapshotBody("session1", 1, 1, new JSONArray()).put("protocolVersion", 1);
        for (String key : new String[]{"controlRevision", "elapsedRunning", "capturedAtWall", "freeze", "reviews", "phone"}) v1.remove(key);
        JSONObject legacyStep = new JSONObject(V2.steps().getJSONObject(0).toString());
        for (String key : new String[]{"slot", "group", "bandLabel", "review"}) legacyStep.remove(key);
        v1.put("steps", new JSONArray().put(legacyStep));
        legacy.receive("phone", new WorkProtocol(V2.uuid(), "snapshot", v1), true);
        legacy.logSet("set-1", V2.state(), new JSONObject().put("reps", 8), NOW.elapsed, NOW.wall, NOW.boot);
        JSONObject legacyTimer = legacy.rest();
        legacy.reportArmed(legacyTimer.getString("id"), legacyTimer.getLong("revision"), false, "exactDenied", false);
        legacy.reportArmed("unknown", 99, true, "ok", true);
        assertEquals(0, legacy.packets("out", "restArmed").length());
    }

    @Test public void resolvingAConflictingCompleteResendsEveryFieldSoTheCompletionIsKept() throws Exception {
        // Watch sent complete {completed:true, reps:10}; the phone had reps 8, so nothing was written.
        String reviewId = V2.uuid();
        JSONArray steps = V2.steps();
        steps.getJSONObject(0).put("review", true).getJSONObject("actual").put("reps", 8);
        JSONObject body = V2.snapshotBody("session1", 2, 1, steps);
        body.getJSONArray("reviews").put(new JSONObject().put("id", reviewId).put("setId", "set-1").put("origin", "watch")
            .put("code", "fieldConflict").put("reason", "Phone changed reps").put("fields", new JSONArray()
                .put(new JSONObject().put("field", "completed").put("phone", false).put("requested", true).put("conflict", false))
                .put(new JSONObject().put("field", "reps").put("phone", 8).put("requested", 10).put("conflict", true))));
        deliver(body);
        JSONArray shown = view().getJSONArray("conflicts").getJSONObject(0).getJSONArray("fields");
        assertFalse(shown.getJSONObject(0).getBoolean("conflict"));
        assertTrue(shown.getJSONObject(1).getBoolean("conflict"));
        WorkProtocol resolve = watch.resolveConflict(reviewId, false);
        assertTrue(resolve.body.getJSONObject("changes").getBoolean("completed"));
        assertEquals(10, resolve.body.getJSONObject("changes").getInt("reps"));
        assertFalse(resolve.body.getJSONObject("expected").getBoolean("completed"));
        assertEquals(8, resolve.body.getJSONObject("expected").getInt("reps"));
        JSONObject projected = step(0).getJSONObject("actual");
        assertTrue(projected.getBoolean("completed"));
        assertEquals(10, projected.getInt("reps"));
    }

    @Test public void rebootRecoveryKeepsTheAuthoritativeRevisionOfASharedRest() throws Exception {
        deliver(1);
        log("set-1", 8);
        JSONObject timer = watch.rest().put("revision", 4);
        watch.putState("rest", timer.toString());
        JSONObject recovered = watch.recoverRest(500, NOW.wall + 10_000, NOW.boot + 1);
        assertEquals(4, recovered.getLong("revision"));
        assertEquals(timer.getLong("localRev") + 1, recovered.getLong("localRev"));
        assertEquals(50_500, recovered.getLong("endsElapsed"));
        watch.reportArmed(recovered.getString("id"), recovered.getLong("localRev"), true, "ok", true);
        watch.write(db -> { db.delete("packets", "direction='out' AND type='restOp'", null); return null; });
        watch.reportArmed(recovered.getString("id"), recovered.getLong("localRev"), true, "ok", true);
        assertEquals(4, V2.outgoing(watch, "restArmed", NOW).body.getLong("revision"));
    }

    @Test public void aRestoredSessionWithANewEpochCanBeSentAgain() throws Exception {
        deliver(1);
        watch.receive("phone", V2.control("session1", 2, "closed", null, "restored"), true);
        assertEquals("closed", deliver(V2.snapshotBody("session1", 3, 3, V2.steps())).body.getString("code"));
        JSONObject restored = V2.snapshotBody("session1", 1, 1, V2.steps()).put("epoch", "00000000-0000-4000-8000-000000000002");
        assertEquals("received", deliver(restored).body.getString("state"));
        watch.clearClosed();
        assertEquals("active", view().getString("phase"));
        assertEquals("00000000-0000-4000-8000-000000000002", view().getJSONObject("workout").getString("epoch"));
    }
}
