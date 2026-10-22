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

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 30, manifest = Config.NONE)
public class DiagnosticsTest {
    private Context context;
    @Before public void setUp() { context = RuntimeEnvironment.getApplication(); Diagnostics.deviceOverride = "watch"; }
    @After public void tearDown() { Diagnostics.deviceOverride = null; Diagnostics.store(context).close(); }

    @Test public void keepsAtMost500EventsPerDevice() throws Exception {
        for (int i = 0; i < 520; i++) Diagnostics.record(context, "rest.op", new JSONObject().put("data", new JSONObject().put("i", i)));
        assertEquals(500, Diagnostics.summary(context).getJSONObject("watch").getLong("count"));
        assertEquals(519, Diagnostics.recent(context, "watch", 1).getJSONObject(0).getJSONObject("data").getInt("i"));
    }
    @Test public void prunesEventsOlderThan14Days() throws Exception {
        Diagnostics.store(context).insert(event("phone", System.currentTimeMillis() - Diagnostics.MAX_AGE_MS + 60_000));
        Diagnostics.store(context).insert(event("phone", System.currentTimeMillis() - Diagnostics.MAX_AGE_MS - 1000));
        assertEquals(1, Diagnostics.summary(context).getJSONObject("phone").getLong("count"));
    }
    @Test public void importDeduplicatesByDeviceAndId() throws Exception {
        Diagnostics.deviceOverride = "phone";
        JSONObject e = event("watch", System.currentTimeMillis());
        assertEquals(1, Diagnostics.importEvents(context, new JSONArray().put(e)));
        assertEquals(0, Diagnostics.importEvents(context, new JSONArray().put(e)));
        assertEquals(0, Diagnostics.importEvents(context, new JSONArray().put(event("phone", System.currentTimeMillis()))));
        assertEquals(1, Diagnostics.summary(context).getJSONObject("watch").getLong("count"));
        assertFalse(Diagnostics.summary(context).getJSONObject("watch").isNull("lastRetrievedAt"));
    }
    @Test public void recordNeverThrows() throws Exception {
        Diagnostics.record(context, "unknown.type", null);
        Diagnostics.record(context, "rest.op", new JSONObject().put("timerId", "not-a-uuid").put("data", new JSONObject().put("big", "x".repeat(5000))));
        Diagnostics.store(context).getWritableDatabase().close();
        Diagnostics.record(context, "rest.op", null);
        JSONObject latest = Diagnostics.recent(context, "watch", 1).getJSONObject(0);
        assertEquals("rest.op", latest.getString("type"));
        JSONArray all = Diagnostics.recent(context, null, 10);
        assertTrue(all.getJSONObject(all.length() - 1).getJSONObject("data").optBoolean("truncated"));
        assertTrue(all.getJSONObject(all.length() - 1).isNull("timerId"));
    }
    @Test public void chunksStayWithinTheByteBudget() throws Exception {
        for (int i = 0; i < 40; i++) Diagnostics.record(context, "rest.op", new JSONObject().put("data", new JSONObject().put("pad", "x".repeat(1500))));
        JSONObject chunk = Diagnostics.chunk(context, 0, 150, 20 * 1024);
        assertTrue(chunk.getBoolean("more"));
        assertTrue(chunk.toString().length() < 20 * 1024);
        JSONObject rest = Diagnostics.chunk(context, chunk.getLong("lastSeq"), 150, 200 * 1024);
        assertFalse(rest.getBoolean("more"));
        assertEquals(40, chunk.getJSONArray("events").length() + rest.getJSONArray("events").length());
        new WorkProtocol(2, V2.uuid(), "diagChunk", rest); // valid on the wire
    }
    @Test public void permissionSnapshotsAreRecordedOnlyWhenTheyChange() throws Exception {
        JSONObject granted = new JSONObject().put("notifications", true).put("exactAlarms", true);
        assertTrue(Diagnostics.recordIfChanged(context, "perm.snapshot", granted));
        assertFalse(Diagnostics.recordIfChanged(context, "perm.snapshot", new JSONObject(granted.toString())));
        assertTrue(Diagnostics.recordIfChanged(context, "perm.snapshot", new JSONObject().put("notifications", false).put("exactAlarms", true)));
        JSONArray events = Diagnostics.recent(context, "watch", 10);
        assertEquals(2, events.length());
        assertFalse(events.getJSONObject(0).getJSONObject("data").getBoolean("notifications"));
    }
    private static JSONObject event(String device, long at) throws Exception {
        return new JSONObject().put("id", V2.uuid()).put("seq", 1).put("device", device).put("type", "rest.op").put("at", at)
            .put("elapsed", 1).put("boot", 1).put("sessionId", JSONObject.NULL).put("timerId", JSONObject.NULL)
            .put("revision", JSONObject.NULL).put("opId", JSONObject.NULL).put("data", new JSONObject());
    }
}
