package com.ironpath.wearlink;

import static org.junit.Assert.*;
import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 30, manifest = Config.NONE)
public class WorkStoreTest {
    private Context context;
    private WorkStore watch, phone;
    private WorkProtocol snapshot;
    private static final String EPOCH = "00000000-0000-4000-8000-000000000001";
    @Before public void setUp() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("watch-test.db"); context.deleteDatabase("phone-test.db");
        watch = new WorkStore(context, "watch-test.db"); phone = new WorkStore(context, "phone-test.db");
        snapshot = snapshot(1);
        phone.publish("watch", snapshot);
        phone.receive("watch", watch.receive("phone", snapshot, true), false);
    }
    @After public void close() { watch.close(); phone.close(); }
    private JSONObject state() throws Exception {
        return new JSONObject("{\"completed\":false,\"reps\":null,\"repsLeft\":null,\"repsRight\":null,\"weight\":null,\"rpe\":null,\"rir\":null}");
    }
    private WorkProtocol snapshot(int revision) throws Exception {
        JSONObject step = new JSONObject().put("setId", "set-1").put("prescriptionId", "p1")
            .put("exerciseId", "e1").put("name", "Exercise").put("entryStyle", "reps").put("loadType", "none")
            .put("target", "8-12").put("unit", "kg").put("setNumber", 1).put("workingNumber", 1)
            .put("workingTotal", 1).put("restAfter", 60).put("isWarmUp", false).put("supported", true).put("actual", state());
        return new WorkProtocol(UUID.randomUUID().toString(), "snapshot", new JSONObject()
            .put("protocolVersion", 1).put("epoch", EPOCH).put("sessionId", "session1")
            .put("revision", revision).put("title", "Workout").put("status", "inProgress")
            .put("elapsedSeconds", 0).put("steps", new JSONArray().put(step)).put("sequences", new JSONObject()));
    }
    private JSONObject draft() throws Exception {
        return new JSONObject().put("baseRevision", 1).put("action", "set").put("prescriptionId", "p1")
            .put("setId", "set-1").put("exerciseId", "e1").put("expected", state())
            .put("changes", new JSONObject().put("completed", true));
    }
    private WorkProtocol result(WorkProtocol command) throws Exception {
        return new WorkProtocol(command.id, "result", new JSONObject().put("commandId", command.id)
            .put("epoch", EPOCH).put("sessionId", "session1").put("state", "committed").put("revision", 2).put("reason", ""));
    }
    @Test public void snapshotAndCommandsSurviveDatabaseReopen() throws Exception {
        WorkProtocol first = watch.enqueueCommand(draft());
        watch.close(); watch = new WorkStore(context, "watch-test.db");
        assertEquals("session1", watch.inspect().getJSONObject("snapshot").getString("sessionId"));
        assertEquals(first.id, watch.packets("out", "command").getJSONObject(0).getJSONObject("packet").getString("id"));
        assertEquals(2, watch.enqueueCommand(draft()).body.getInt("sequence"));
    }
    @Test public void receivedAcknowledgementDoesNotDiscardUncommittedCommand() throws Exception {
        WorkProtocol command = watch.enqueueCommand(draft());
        WorkProtocol ack = phone.receive("watch", command, false);
        watch.receive("phone", ack, true);
        assertEquals(1, watch.packets("out", "command").length());
        assertEquals("received", watch.packets("out", "command").getJSONObject(0).getString("state"));
        assertEquals(1, phone.packets("in", "command").length());
        assertEquals(0, watch.outgoing().length());
        watch.retryReceivedCommands();
        assertEquals(1, watch.outgoing().length());
    }
    @Test public void deduplicatesReceiptAndRejectsChangedPayloadForTheSameId() throws Exception {
        WorkProtocol command = watch.enqueueCommand(draft());
        phone.receive("watch", command, false); phone.receive("watch", command, false);
        assertEquals(1, phone.packets("in", "command").length());
        JSONObject altered = new JSONObject(command.body.toString()).put("changes", new JSONObject().put("reps", 99));
        assertThrows(Exception.class, () -> phone.receive("watch", new WorkProtocol(command.id, "command", altered), false));
        assertEquals(1, phone.packets("in", "command").length());
    }
    @Test public void finalResultIsSavedBeforeTheWatchOutboxIsCleared() throws Exception {
        WorkProtocol command = watch.enqueueCommand(draft());
        phone.receive("watch", command, false);
        WorkProtocol result = result(command);
        phone.complete("watch", result);
        assertEquals(0, phone.packets("in", "command").length());
        WorkProtocol ack = watch.receive("phone", result, true);
        assertEquals(0, watch.packets("out", "command").length());
        assertEquals(1, watch.packets("in", "result").length());
        watch.receive("phone", result, true); // Lost result ACK; safely retry.
        phone.receive("watch", ack, false);
        assertEquals(0, phone.packets("out", "result").length());
    }
    @Test public void refusesNewSessionSnapshotWhileCommandsArePending() throws Exception {
        watch.enqueueCommand(draft());
        JSONObject other = new JSONObject(snapshot.body.toString()).put("sessionId", "another-session");
        WorkProtocol ack = watch.receive("phone", new WorkProtocol(UUID.randomUUID().toString(), "snapshot", other), true);
        assertEquals("rejected", ack.body.getString("state"));
        assertEquals("session1", watch.inspect().getJSONObject("snapshot").getString("sessionId"));
        assertEquals(1, watch.packets("out", "command").length());
    }
    @Test public void refusesAnOlderSnapshot() throws Exception {
        watch.receive("phone", snapshot(5), true);
        assertEquals("rejected", watch.receive("phone", snapshot(2), true).body.getString("state"));
        assertEquals(5, watch.inspect().getJSONObject("snapshot").getInt("revision"));
    }
    @Test public void capacityFailureKeepsEveryPendingCommandAndSequence() throws Exception {
        for (int i = 0; i < WorkStore.MAX_QUEUED; i++) watch.enqueueCommand(draft());
        assertThrows(Exception.class, () -> watch.enqueueCommand(draft()));
        assertEquals(WorkStore.MAX_QUEUED, watch.packets("out", "command").length());
        WorkProtocol first = WorkProtocol.decode(watch.packets("out", "command").getJSONObject(0)
            .getJSONObject("packet").toString().getBytes(StandardCharsets.UTF_8));
        watch.receive("phone", result(first), true);
        assertEquals(WorkStore.MAX_QUEUED + 1, watch.enqueueCommand(draft()).body.getLong("sequence"));
    }
    @Test public void unrelatedPeersCannotAcknowledgeOrFinalizePendingWork() throws Exception {
        WorkProtocol command = watch.enqueueCommand(draft());
        assertNull(watch.receive("wrong-phone", command.acknowledgement("received", ""), true));
        assertThrows(Exception.class, () -> watch.receive("wrong-phone", result(command), true));
        assertEquals(1, watch.packets("out", "command").length());
    }
    @Test public void receivedCommandsDoNotStarveLaterUnsentCommands() throws Exception {
        for (int i = 0; i < 20; i++) {
            WorkProtocol command = watch.enqueueCommand(draft());
            if (i < 16) watch.receive("phone", phone.receive("watch", command, false), true);
        }
        assertEquals(20, watch.packets("out", "command").length());
        assertEquals(4, watch.outgoing().length());
    }
    @Test public void rejectsMalformedAndOversizedProtocolEnvelopes() throws Exception {
        byte[] valid = snapshot.encode();
        assertThrows(Exception.class, () -> WorkProtocol.decode(new byte[WorkProtocol.MAX_BYTES + 1]));
        assertThrows(Exception.class, () -> WorkProtocol.decode((new String(valid, StandardCharsets.UTF_8) + "{}").getBytes(StandardCharsets.UTF_8)));
        assertThrows(Exception.class, () -> WorkProtocol.decode(new String(valid, StandardCharsets.UTF_8).replace("\"version\":1", "\"version\":2").getBytes(StandardCharsets.UTF_8)));
    }
    private WorkProtocol log() throws Exception {
        return watch.logSet("set-1", state(), new JSONObject().put("reps", 8), 1000, 100000, 7);
    }
    @Test public void savesCompletionTimerAndOutboxTogetherAndRejectsDoubleTap() throws Exception {
        WorkProtocol command = log();
        assertTrue(watch.inspect().getJSONObject("snapshot").getJSONArray("steps").getJSONObject(0).getJSONObject("actual").getBoolean("completed"));
        assertEquals(command.id, watch.rest().getString("source"));
        assertEquals(60000, RestState.remaining(watch.rest(), 1000));
        assertThrows(Exception.class, () -> log());
        assertEquals(1, watch.packets("out", "command").length());
        watch.close(); watch = new WorkStore(context, "watch-test.db");
        assertEquals(command.id, watch.rest().getString("source"));
    }
    @Test public void fullQueueCannotClaimASetWasCompletedOrStartItsRest() throws Exception {
        for (int i = 0; i < MAX(); i++) watch.enqueueCommand(draft());
        assertThrows(Exception.class, () -> log());
        assertNull(watch.rest());
        assertFalse(watch.inspect().getJSONObject("snapshot").getJSONArray("steps").getJSONObject(0).getJSONObject("actual").getBoolean("completed"));
    }
    private int MAX() { return WorkStore.MAX_QUEUED; }
    @Test public void undoQueuesAnInverseCommandAndCancelsOnlyItsOwnRest() throws Exception {
        log(); watch.undoLast();
        assertEquals(2, watch.packets("out", "command").length());
        assertFalse(watch.rest().getBoolean("active"));
        assertFalse(watch.inspect().getJSONObject("snapshot").getJSONArray("steps").getJSONObject(0).getJSONObject("actual").getBoolean("completed"));
    }
    @Test public void reverseResultArrivalDoesNotReorderCompletionAndUndo() throws Exception {
        WorkProtocol first = log(); watch.undoLast();
        WorkProtocol second = WorkProtocol.decode(watch.packets("out", "command").getJSONObject(1).getJSONObject("packet").toString().getBytes(StandardCharsets.UTF_8));
        watch.receive("phone", new WorkProtocol(second.id, "result", result(second).body.put("revision", 3)), true);
        watch.receive("phone", result(first), true);
        assertFalse(watch.inspect().getBoolean("blocked"));
        assertFalse(watch.inspect().getJSONObject("snapshot").getJSONArray("steps").getJSONObject(0).getJSONObject("actual").getBoolean("completed"));
    }
    @Test public void aSnapshotWatermarkPreventsReapplyingAnAlreadyUndoneSetWhileAcksAreDelayed() throws Exception {
        WorkProtocol first = log(); watch.undoLast();
        WorkProtocol fresh = snapshot(3);
        fresh.body.getJSONObject("sequences").put(first.body.getString("deviceId"), 2);
        watch.receive("phone", fresh, true);
        assertFalse(watch.inspect().getJSONObject("snapshot").getJSONArray("steps").getJSONObject(0).getJSONObject("actual").getBoolean("completed"));
        assertEquals(2, watch.packets("out", "command").length());
    }
    @Test public void rejectedCompletionRevertsProjectionAndBlocksFurtherLoggingUntilReviewed() throws Exception {
        WorkProtocol command = log();
        watch.receive("phone", new WorkProtocol(command.id, "result", result(command).body.put("state", "conflict").put("reason", "Phone changed")), true);
        assertTrue(watch.inspect().getBoolean("blocked"));
        assertFalse(watch.rest().getBoolean("active"));
        assertThrows(Exception.class, () -> log());
        watch.acceptPhoneValues();
        assertFalse(watch.inspect().getBoolean("blocked"));
        assertEquals(1, watch.packets("in", "result").length());
        log();
    }
    @Test public void staleOnscreenInputsCannotOverwriteNewPhoneValues() throws Exception {
        WorkProtocol fresh = snapshot(2);
        fresh.body.getJSONArray("steps").getJSONObject(0).getJSONObject("actual").put("reps", 12);
        watch.receive("phone", fresh, true);
        assertThrows(Exception.class, () -> log());
        assertEquals(0, watch.packets("out", "command").length());
    }
    @Test public void staleTimerCallbacksCannotDismissExtendedSkippedOrNewRests() throws Exception {
        log(); JSONObject old = watch.rest();
        watch.editRest(15, 2000);
        assertNull(watch.claimRest(old.getString("id"), old.getLong("revision"), 62000));
        JSONObject extended = watch.rest();
        assertNotNull(watch.claimRest(extended.getString("id"), extended.getLong("revision"), 76000));
        assertNull(watch.claimRest(extended.getString("id"), extended.getLong("revision"), 76000));
        watch.testRest(80000, 180000, 7);
        assertNull(watch.claimRest(old.getString("id"), old.getLong("revision"), 90000));
        assertTrue(watch.rest().getBoolean("active"));
    }
    @Test public void zeroRestDoesNotCreateATimerOrFillMissingActualsFromTargets() throws Exception {
        WorkProtocol fresh = snapshot(2);
        fresh.body.getJSONArray("steps").getJSONObject(0).put("restAfter", 0);
        watch.receive("phone", fresh, true);
        watch.logSet("set-1", state(), new JSONObject().put("completed", true), 1000, 100000, 7);
        assertNull(watch.rest());
        assertTrue(watch.inspect().getJSONObject("snapshot").getJSONArray("steps").getJSONObject(0).getJSONObject("actual").isNull("reps"));
    }
    private WorkProtocol control(long generation) throws Exception {
        return new WorkProtocol(UUID.randomUUID().toString(), "control", new JSONObject().put("epoch", EPOCH)
            .put("sessionId", "session1").put("owner", "phone").put("controlRevision", generation));
    }
    @Test public void pauseAtomicallyFreezesLoggingAndUndoCancelsRestAndReturnsDurableCheckpoint() throws Exception {
        WorkProtocol command = log(), pause = control(1);
        JSONObject timer = watch.rest();
        WorkProtocol ack = watch.receive("phone", pause, true);
        assertEquals(1, ack.body.getLong("sequence"));
        assertEquals(command.body.getString("deviceId"), ack.body.getString("deviceId"));
        assertFalse(watch.rest().getBoolean("active"));
        assertNull(watch.claimRest(timer.getString("id"), timer.getLong("revision"), 999999));
        assertThrows(Exception.class, () -> watch.undoLast());
        assertThrows(Exception.class, () -> watch.enqueueCommand(draft()));
        assertEquals(1, watch.packets("out", "command").length());
        watch.close(); watch = new WorkStore(context, "watch-test.db");
        assertFalse(watch.inspect().getBoolean("canUndo"));
        assertEquals(ack.json().toString(), watch.receive("phone", pause, true).json().toString());
    }
    @Test public void delayedSnapshotCannotResumePausedLoggingButANewHandoffCan() throws Exception {
        watch.receive("phone", control(2), true);
        WorkProtocol stale = snapshot(10); stale.body.put("controlRevision", 1);
        assertEquals("rejected", watch.receive("phone", stale, true).body.getString("state"));
        assertThrows(Exception.class, () -> log());
        WorkProtocol fresh = snapshot(10); fresh.body.put("controlRevision", 3);
        assertEquals("received", watch.receive("phone", fresh, true).body.getString("state"));
        log();
    }
    @Test public void anOlderControlCannotPauseANewerHandoffOrAnotherWorkout() throws Exception {
        WorkProtocol fresh = snapshot(2); fresh.body.put("controlRevision", 5);
        watch.receive("phone", fresh, true);
        assertEquals("rejected", watch.receive("phone", control(4), true).body.getString("state"));
        WorkProtocol other = control(6); other.body.put("sessionId", "other");
        assertEquals("rejected", watch.receive("phone", other, true).body.getString("state"));
        assertThrows(Exception.class, () -> watch.receive("stranger", control(6), true));
        log();
    }
    @Test public void pauseIsQueuedWhileDisconnectedAndOnlyMatchingPeerCanConfirmIt() throws Exception {
        WorkProtocol pause = control(1); phone.control(pause);
        assertEquals(1, phone.outgoing().length());
        WorkProtocol ack = watch.receive("phone", pause, true);
        phone.receive("stranger", ack, false);
        assertEquals(1, phone.outgoing().length());
        phone.receive("watch", ack, false);
        assertEquals(0, phone.outgoing().length());
        assertEquals(pause.id, phone.inspect().getJSONObject("controlConfirmation").getString("id"));
    }
    @Test public void pauseRetriesCommandsThatWereOnlyAcknowledgedByNativePhoneReceipt() throws Exception {
        WorkProtocol command = log();
        watch.receive("phone", phone.receive("watch", command, false), true);
        assertEquals(0, watch.outgoing().length());
        watch.receive("phone", control(1), true);
        assertEquals(1, watch.outgoing().length());
    }

    @Test public void controlPausesTheCurrentRestAndDurablyOffersItsRemainderOnce() throws Exception {
        long now = android.os.SystemClock.elapsedRealtime();
        int boot = android.provider.Settings.Global.getInt(context.getContentResolver(), android.provider.Settings.Global.BOOT_COUNT, 0);
        watch.logSet("set-1", state(), new JSONObject().put("reps", 8), now, System.currentTimeMillis(), boot);
        WorkProtocol pause = control(1), ack = watch.receive("phone", pause, true);
        assertTrue(ack.body.getLong("restRemainingMs") > 0);
        assertTrue(ack.body.getLong("restRemainingMs") <= 60000);
        assertFalse(watch.rest().getBoolean("active"));
        assertEquals(ack.body.getLong("restRemainingMs"), watch.receive("phone", pause, true).body.getLong("restRemainingMs"));
    }

}
