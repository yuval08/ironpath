package com.ironpath.wearlink;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class RestStateTest {
    @Test public void sameBootUsesMonotonicClockDespiteWallClockChange() throws Exception {
        JSONObject timer = RestState.start("cmd", "session", 60, 1000, 100000, 1, true);
        assertEquals(30000, RestState.remaining(RestState.recover(timer, 31000, 10000000, 1), 31000));
    }
    @Test public void expiredRestAfterRebootIsEndedWithoutReplayingItsAlert() throws Exception {
        JSONObject timer = RestState.start("cmd", "session", 60, 1000, 100000, 1, true);
        assertFalse(RestState.recover(timer, 100, 200000, 2).getBoolean("active"));
    }
    @Test public void unexpiredRestAfterRebootReanchorsFromPersistedDeadline() throws Exception {
        JSONObject timer = RestState.start("cmd", "session", 60, 1000, 100000, 1, true);
        JSONObject restored = RestState.recover(timer, 100, 120000, 2);
        assertEquals(40000, RestState.remaining(restored, 100));
        assertNotEquals(timer.getLong("revision"), restored.getLong("revision"));
    }
    @Test public void unsafeClockRecoveryAndExtensionsDoNotRestartExpiredRest() throws Exception {
        JSONObject timer = RestState.start("cmd", "session", 60, 1000, 100000, 1, true);
        assertFalse(RestState.recover(timer, 0, 0, 2).getBoolean("active"));
        assertThrows(Exception.class, () -> RestState.extend(timer, 70000));
        assertThrows(Exception.class, () -> RestState.start("cmd", "session", -1, 0, 0, 1, true));
    }
}
