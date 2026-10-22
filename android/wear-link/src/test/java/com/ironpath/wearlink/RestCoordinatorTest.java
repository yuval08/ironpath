package com.ironpath.wearlink;

import static org.junit.Assert.*;
import android.content.Context;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Each device has its own monotonic clock and boot; only fresh durations cross. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 30, manifest = Config.NONE)
public class RestCoordinatorTest {
    private Context context;
    private WorkStore watch, phone;
    private String device;

    private static Clock watchAt(long elapsed) { return new Clock(elapsed, 2_000_000 + elapsed, 7); }
    private static Clock phoneAt(long elapsed) { return new Clock(elapsed, 9_000_000 + elapsed, 3); }

    @Before public void setUp() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("watch-rest.db"); context.deleteDatabase("phone-rest.db");
        watch = new WorkStore(context, "watch-rest.db"); phone = new WorkStore(context, "phone-rest.db");
        watch.fixedClock = watchAt(100_000); phone.fixedClock = phoneAt(500_000);
        WorkProtocol hello = watch.hello(true, "0.5.0", 5, false);
        device = hello.body.getString("installId");
        phone.receive("watch", hello, false);
        WorkProtocol snapshot = V2.snapshot(1);
        phone.publish("watch", snapshot);
        phone.receive("watch", watch.receive("phone", snapshot, true), false);
    }
    @After public void close() { watch.close(); phone.close(); }

    private void log() throws Exception {
        Clock c = watch.fixedClock;
        watch.logSet("set-1", V2.state(), V2.state().put("reps", 8), c.elapsed, c.wall, c.boot);
    }
    /** Watch flushes its next restOp at {@code sendAt}; the phone receives it at {@code recvAt}. */
    private WorkProtocol sendOp(long sendAt, long recvAt) throws Exception {
        WorkProtocol op = V2.outgoing(watch, "restOp", watchAt(sendAt));
        phone.fixedClock = phoneAt(recvAt);
        WorkProtocol ack = RestCoordinator.receivePhone(phone, "watch", op);
        watch.receive("phone", ack, true);
        return ack;
    }
    /** Phone flushes its restState at {@code sendAt}; the watch receives it at {@code recvAt}. */
    private void sendState(long sendAt, long recvAt) throws Exception {
        WorkProtocol state = V2.outgoing(phone, "restState", phoneAt(sendAt));
        watch.fixedClock = watchAt(recvAt);
        RestCoordinator.receiveWatch(watch, "phone", state);
    }
    private JSONObject phoneTimer() throws Exception { return RestCoordinator.view(phone, phone.fixedClock).getJSONObject("timer"); }
    private WorkProtocol op(long sequence, String op, String timerId, Long duration, Long delta, String epoch) throws Exception {
        String id = V2.uuid();
        return new WorkProtocol(2, id, "restOp", new JSONObject().put("protocolVersion", 2).put("opId", id).put("deviceId", device)
            .put("restSequence", sequence).put("epoch", epoch).put("sessionId", "session1").put("op", op).put("timerId", timerId)
            .put("baseRevision", JSONObject.NULL).put("durationMs", duration == null ? JSONObject.NULL : duration)
            .put("deltaMs", delta == null ? JSONObject.NULL : delta).put("sourceOp", JSONObject.NULL).put("reason", "user")
            .put("next", JSONObject.NULL).put("clock", new JSONObject().put("ageMs", 0).put("uncertain", false)));
    }
    private WorkProtocol armed(String timerId, long revision, boolean armed, String reason) throws Exception {
        return new WorkProtocol(2, V2.uuid(), "restArmed", new JSONObject().put("deviceId", device).put("timerId", timerId)
            .put("revision", revision).put("armed", armed).put("reason", reason).put("exact", true));
    }

    @Test public void aWatchRestIsAnchoredOnFreshAgesAndReturnsWithoutJitter() throws Exception {
        log();
        long localRev = watch.rest().getLong("localRev");
        assertEquals("ok", sendOp(102_000, 500_000).body.getString("code"));
        JSONObject timer = phoneTimer();
        assertEquals("watch", timer.getString("origin"));
        assertEquals(58_000, timer.getLong("remainingMs")); // 2 s spent in the watch outbox
        assertEquals("scheduled", timer.getJSONObject("alert").getString("phoneBackup"));
        assertEquals("watch", timer.getJSONObject("alert").getString("preferred"));
        sendState(501_000, 104_000); // 1 s transit: inside the 1.5 s re-anchor threshold
        JSONObject local = watch.rest();
        assertEquals(160_000, local.getLong("endsElapsed"));
        assertEquals(localRev, local.getLong("localRev"));
        assertEquals(timer.getLong("revision"), local.getLong("revision"));
        assertEquals(0, watch.packets("out", "restOp").length()); // watermark consumed the start
        // A phone +15 is a real change: the watch moves its deadline and re-keys its alarm.
        phone.fixedClock = phoneAt(502_000);
        RestCoordinator.adjust(phone, timer.getString("timerId"), 15_000);
        sendState(502_000, 105_000);
        assertEquals(176_000, watch.rest().getLong("endsElapsed"));
        assertEquals(localRev + 1, watch.rest().getLong("localRev"));
        assertNull(watch.claimRest(local.getString("id"), localRev, 200_000));
    }

    @Test public void pendingWatchOpsAreReplayedOverTheAuthoritativeState() throws Exception {
        log();
        watch.fixedClock = watchAt(101_000);
        watch.editRest(15, 101_000);
        assertEquals(175_000, watch.rest().getLong("endsElapsed"));
        sendOp(101_000, 500_000);          // only the start reaches the phone
        sendState(500_000, 101_500);       // watermark 1: the +15 is still pending locally
        assertEquals(175_000, watch.rest().getLong("endsElapsed"));
        assertEquals(1, watch.packets("out", "restOp").length());
        JSONObject local = watch.rest();
        watch.reportArmed(local.getString("id"), local.getLong("localRev"), true, "ok", true);
        JSONObject restArmed = V2.outgoing(watch, "restArmed", watch.fixedClock).body;
        assertFalse(restArmed.getBoolean("armed"));
        assertEquals("pendingOps", restArmed.getString("reason"));
    }

    @Test public void deferredGapsAgeFromTheirOwnReceiveTime() throws Exception {
        String b = V2.uuid();
        phone.fixedClock = phoneAt(1_000_000);
        RestCoordinator.receivePhone(phone, "watch", op(2, "start", b, 60_000L, null, V2.EPOCH));
        assertTrue(RestCoordinator.view(phone, phone.fixedClock).isNull("timer"));
        phone.fixedClock = phoneAt(1_010_000);
        RestCoordinator.receivePhone(phone, "watch", op(1, "skip", V2.uuid(), null, null, V2.EPOCH));
        JSONObject timer = phoneTimer();
        assertEquals(b, timer.getString("timerId"));
        assertEquals(50_000, timer.getLong("remainingMs"));
        assertEquals(2, new JSONObject(phone.state("restWatermarks")).getLong(device));
    }

    @Test public void theWatermarkConsumesRejectedOpsAndDuplicatesAreIdempotent() throws Exception {
        WorkProtocol wrongEpoch = op(1, "start", V2.uuid(), 60_000L, null, "00000000-0000-4000-8000-000000000999");
        assertEquals("ok", RestCoordinator.receivePhone(phone, "watch", wrongEpoch).body.getString("code"));
        assertTrue(RestCoordinator.view(phone, phone.fixedClock).isNull("timer"));
        assertEquals(1, new JSONObject(phone.state("restWatermarks")).getLong(device));
        WorkProtocol reused = op(1, "start", V2.uuid(), 60_000L, null, V2.EPOCH);
        assertEquals("sequenceReused", RestCoordinator.receivePhone(phone, "watch", reused).body.getString("code"));
        assertEquals("ok", RestCoordinator.receivePhone(phone, "watch", wrongEpoch).body.getString("code"));
        JSONObject state = V2.outgoing(phone, "restState", phone.fixedClock).body;
        assertEquals("rejected", state.getJSONArray("outcomes").getJSONObject(0).getString("outcome"));
        assertThrows(Exception.class, () -> RestCoordinator.receivePhone(phone, "stranger", op(2, "skip", V2.uuid(), null, null, V2.EPOCH)));
    }

    @Test public void restArmedSuppressesOnlyItsRevisionAndANewRevisionReschedules() throws Exception {
        JSONObject timer = RestCoordinator.start(phone, "session1", 60_000, null, new JSONObject().put("title", "A1 · Bench").put("text", "Set 2 of 4"))
            .getJSONObject("timer");
        String id = timer.getString("timerId");
        long r = timer.getLong("revision");
        RestCoordinator.receivePhone(phone, "watch", armed(id, r - 1, true, "ok"));
        assertEquals("scheduled", phoneTimer().getJSONObject("alert").getString("phoneBackup"));
        RestCoordinator.receivePhone(phone, "watch", armed(id, r, false, "notificationsOff"));
        assertEquals("scheduled", phoneTimer().getJSONObject("alert").getString("phoneBackup"));
        RestCoordinator.receivePhone(phone, "watch", armed(id, r, true, "ok"));
        assertEquals("suppressed", phoneTimer().getJSONObject("alert").getString("phoneBackup"));
        assertEquals("watch", phoneTimer().getJSONObject("alert").getString("destination"));
        phone.fixedClock = phoneAt(560_000);
        assertNull(RestCoordinator.claimBackup(phone, id, r)); // the wrist owns this revision
        phone.fixedClock = phoneAt(510_000);
        JSONObject adjusted = RestCoordinator.adjust(phone, id, 15_000).getJSONObject("timer");
        assertEquals(r + 1, adjusted.getLong("revision"));
        assertEquals("scheduled", adjusted.getJSONObject("alert").getString("phoneBackup"));
        assertEquals("both", adjusted.getJSONObject("alert").getString("destination"));
        phone.fixedClock = phoneAt(575_000);
        assertNull(RestCoordinator.claimBackup(phone, id, r));          // stale revision
        phone.fixedClock = phoneAt(560_000);
        assertNull(RestCoordinator.claimBackup(phone, id, r + 1));      // not due yet
        phone.fixedClock = phoneAt(575_000);
        JSONObject claimed = RestCoordinator.claimBackup(phone, id, r + 1).getJSONObject("timer");
        assertEquals("delivered", claimed.getJSONObject("alert").getString("phoneBackup"));
        assertEquals("ended", claimed.getString("state"));
        assertNull(RestCoordinator.claimBackup(phone, id, r + 1));      // once
        phone.fixedClock = phoneAt(580_000);
        JSONObject again = RestCoordinator.adjust(phone, id, 15_000).getJSONObject("timer"); // +15 after it ended
        assertEquals("running", again.getString("state"));
        assertEquals(15_000, again.getLong("remainingMs"));
        assertEquals("scheduled", again.getJSONObject("alert").getString("phoneBackup"));
        assertTrue(again.getLong("revision") > r + 1);
    }

    @Test public void notificationsOffMeansNoBackup() throws Exception {
        RestCoordinator.configure(phone, false, true);
        JSONObject timer = RestCoordinator.start(phone, "session1", 60_000, null, null).getJSONObject("timer");
        assertEquals("off", timer.getJSONObject("alert").getString("phoneBackup"));
        assertEquals("none", timer.getJSONObject("alert").getString("destination"));
        phone.fixedClock = phoneAt(560_000);
        assertNull(RestCoordinator.claimBackup(phone, timer.getString("timerId"), timer.getLong("revision")));
        RestCoordinator.configure(phone, true, true);
        assertEquals("ended", phoneTimer().getString("state"));
    }

    @Test public void closingASessionCancelsItsRestAndRefusesLaterStarts() throws Exception {
        String id = RestCoordinator.start(phone, "session1", 60_000, null, null).getJSONObject("timer").getString("timerId");
        assertEquals("cancelled", RestCoordinator.closeSession(phone, "session1").getJSONObject("timer").getString("state"));
        assertThrows(SyncError.class, () -> RestCoordinator.start(phone, "session1", 60_000, null, null));
        assertThrows(SyncError.class, () -> RestCoordinator.skip(phone, id));
        RestCoordinator.receivePhone(phone, "watch", op(1, "start", V2.uuid(), 60_000L, null, V2.EPOCH));
        assertEquals("cancelled", phoneTimer().getString("state"));
        RestCoordinator.start(phone, null, 30_000, null, null);
        assertEquals("cancelled", RestCoordinator.closeSession(phone, null).getJSONObject("timer").getString("state"));
    }

    @Test public void aRestThatExpiredInTransitEndsOnTheWatchWithoutAnAlert() throws Exception {
        log();
        JSONObject local = watch.rest();
        sendOp(170_000, 500_000);          // 70 s in the outbox: already over
        JSONObject timer = phoneTimer();
        assertEquals("ended", timer.getString("state"));
        sendState(500_000, 170_500);
        JSONObject ended = watch.rest();
        assertEquals("ended", ended.getString("state"));
        assertTrue(ended.getLong("localRev") > local.getLong("localRev"));
        assertNull(watch.claimRest(local.getString("id"), local.getLong("localRev"), 171_000));
        assertEquals("active", watch.inspect(watchAt(171_000)).getString("phase"));
    }

    @Test public void undoCancelsTheCoordinatorRestOnlyForItsSourceOp() throws Exception {
        log();
        sendOp(100_500, 500_000);
        watch.fixedClock = watchAt(101_000);
        watch.undoLast();
        assertEquals("cancelled", watch.rest().getString("state"));
        sendOp(101_000, 501_000);
        assertEquals("cancelled", phoneTimer().getString("state"));
        // A cancel for another source op never touches the current rest.
        JSONObject restarted = RestCoordinator.start(phone, "session1", 60_000, V2.uuid(), null).getJSONObject("timer");
        RestCoordinator.receivePhone(phone, "watch", cancelOther());
        assertEquals("running", phoneTimer().getString("state"));
        assertEquals(restarted.getString("timerId"), phoneTimer().getString("timerId"));
    }
    @Test public void aSwitchOnlyCancelsTheRestWhileFinishingBlocksLaterStartsUntilRepublished() throws Exception {
        RestCoordinator.start(phone, "session1", 60_000, null, null);
        assertEquals("cancelled", RestCoordinator.closeSession(phone, "session1", false).getJSONObject("timer").getString("state"));
        assertEquals("running", RestCoordinator.start(phone, "session1", 60_000, null, null).getJSONObject("timer").getString("state"));
        RestCoordinator.closeSession(phone, "session1", true);
        assertThrows(SyncError.class, () -> RestCoordinator.start(phone, "session1", 60_000, null, null));
        phone.publish("watch", V2.snapshot(2)); // selected again: in progress after all
        assertEquals("running", RestCoordinator.start(phone, "session1", 60_000, null, null).getJSONObject("timer").getString("state"));
    }

    @Test public void effectsAreAppliedUnderTheLockFromTheLatestState() throws Exception {
        java.util.List<Long> applied = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        RestCoordinator.effectsOverride = (c, view) -> {
            JSONObject timer = view == null ? null : view.optJSONObject("timer");
            if (timer != null) applied.add(timer.optLong("revision"));
        };
        try {
            int threads = 4;
            java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(threads);
            java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
            for (int t = 0; t < threads; t++) new Thread(() -> {
                try { for (int i = 0; i < 10; i++) RestCoordinator.start(context, null, 60_000, null, null); }
                catch (Throwable error) { failure.set(error); }
                finally { done.countDown(); }
            }).start();
            done.await();
            assertNull(failure.get());
            assertEquals(40, applied.size());
            for (int i = 1; i < applied.size(); i++) assertTrue("effects never go back to an older revision", applied.get(i) > applied.get(i - 1));
            assertEquals(RestCoordinator.view(context).getJSONObject("timer").getLong("revision"), (long) applied.get(applied.size() - 1));
        } finally { RestCoordinator.effectsOverride = null; }
    }
    private WorkProtocol cancelOther() throws Exception {
        WorkProtocol base = op(3, "skip", V2.uuid(), null, null, V2.EPOCH);
        JSONObject body = new JSONObject(base.body.toString()).put("op", "cancel").put("sourceOp", V2.uuid());
        return new WorkProtocol(2, base.id, "restOp", body);
    }
}
