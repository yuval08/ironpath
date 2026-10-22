package com.ironpath.wearlink;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class RestRulesTest {
    private static final Clock T0 = new Clock(10_000, 1_000_000, 1);
    private static Clock at(long elapsed) { return new Clock(elapsed, T0.wall + elapsed - T0.elapsed, 1); }
    private static JSONObject timer(String id, long start, long duration, String source) throws Exception {
        return RestRules.create(id, "s", V2.EPOCH, "watch", V2.PHONE_ID, source, duration, start, at(start), null, true);
    }

    @Test public void startReplacesAnOlderTimerButAnOlderStartIsSuperseded() throws Exception {
        JSONObject a = timer("a", 10_000, 60_000, null), b = timer("b", 20_000, 60_000, null);
        RestRules.Result started = RestRules.start(a, b, 20_000);
        assertEquals("applied", started.outcome);
        assertEquals("b", started.current.getString("id"));
        assertEquals("replaced", started.replaced.getString("state"));
        RestRules.Result late = RestRules.start(b, timer("c", 15_000, 60_000, null), 21_000);
        assertEquals("superseded", late.outcome);
        assertEquals("b", late.current.getString("id"));
    }
    @Test public void anExpiredStartNeverSchedulesAnAlert() throws Exception {
        RestRules.Result result = RestRules.start(null, timer("a", 0, 60_000, null), 70_000);
        assertEquals("expired", result.outcome);
        assertFalse(RestRules.running(result.current));
        assertEquals(0, RestRules.remaining(result.current, 70_000));
    }
    @Test public void adjustBothWaysAndDeductToZeroExpiresOnce() throws Exception {
        JSONObject a = timer("a", 10_000, 60_000, null);
        JSONObject plus = RestRules.adjust(a, "a", 15_000, at(20_000)).current;
        assertEquals(85_000, plus.getLong("endsElapsed"));
        assertEquals(75_000, plus.getLong("durationMs"));
        assertEquals(a.getLong("localRev") + 1, plus.getLong("localRev"));
        JSONObject zero = RestRules.adjust(plus, "a", -3_600_000, at(30_000)).current;
        assertEquals(30_000, zero.getLong("endsElapsed"));
        assertEquals(0, RestRules.remaining(zero, 30_000));
        assertEquals("stale", RestRules.adjust(zero, "a", -15_000, at(30_000)).outcome);
        JSONObject restarted = RestRules.adjust(zero, "a", 15_000, at(40_000)).current;  // "+15 at zero" restarts
        assertEquals(55_000, restarted.getLong("endsElapsed"));
        assertEquals(15_000, restarted.getLong("durationMs"));
        assertEquals("stale", RestRules.adjust(RestRules.skip(plus, "a").current, "a", 15_000, at(40_000)).outcome);
        assertEquals("stale", RestRules.adjust(plus, "other", 15_000, at(20_000)).outcome);
    }
    @Test public void concurrentAdjustmentsCommute() throws Exception {
        JSONObject a = timer("a", 10_000, 60_000, null);
        JSONObject x = RestRules.adjust(RestRules.adjust(a, "a", 15_000, at(20_000)).current, "a", -5_000, at(21_000)).current;
        JSONObject y = RestRules.adjust(RestRules.adjust(a, "a", -5_000, at(20_000)).current, "a", 15_000, at(21_000)).current;
        assertEquals(x.getLong("endsElapsed"), y.getLong("endsElapsed"));
    }
    @Test public void durationIsClamped() throws Exception {
        JSONObject a = timer("a", 10_000, RestRules.MAX_MS - 1000, null);
        JSONObject plus = RestRules.adjust(a, "a", 3_600_000, at(10_000)).current;
        assertEquals(RestRules.MAX_MS, plus.getLong("durationMs"));
        assertEquals(10_000 + RestRules.MAX_MS, plus.getLong("endsElapsed"));
    }
    @Test public void skipAndCancelAreStaleUnlessTheyTargetTheCurrentRest() throws Exception {
        JSONObject a = timer("a", 10_000, 60_000, "op-1");
        assertEquals("stale", RestRules.skip(a, "b").outcome);
        assertEquals("skipped", RestRules.skip(a, "a").current.getString("state"));
        assertEquals("stale", RestRules.cancel(a, "op-2").outcome);
        assertEquals("cancelled", RestRules.cancel(a, "op-1").current.getString("state"));
        assertEquals("stale", RestRules.closeSession(a, "other").outcome);
        assertEquals("cancelled", RestRules.closeSession(a, null).current.getString("state"));
    }
    @Test public void rebootRecoveryReanchorsOrEndsWithoutReplay() throws Exception {
        JSONObject a = timer("a", 10_000, 60_000, null);
        JSONObject restored = RestRules.recover(a, new Clock(500, T0.wall + 20_000, 2));
        assertEquals(40_500, restored.getLong("endsElapsed"));
        JSONObject late = RestRules.recover(a, new Clock(500, T0.wall + 90_000, 2));
        assertFalse(RestRules.running(late));
        assertTrue(late.getBoolean("uncertain"));
        // A wall clock moved backwards makes the remainder implausible: end, never restart.
        assertFalse(RestRules.running(RestRules.recover(a, new Clock(500, T0.wall - 600_000, 2))));
        assertSame(a, RestRules.recover(a, at(30_000)));
    }
    @Test public void legacyRestStateUsesTheSameArithmetic() throws Exception {
        JSONObject legacy = RestState.start("cmd", "s", 60, 1000, 100_000, 1, true);
        JSONObject minus = RestState.adjust(legacy, -15_000, 2000);
        assertEquals(46_000, minus.getLong("endsElapsed"));
        assertEquals(minus.getLong("localRev"), minus.getLong("revision"));
    }
}
