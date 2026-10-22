package com.ironpath.wearlink;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class EditorRebaseTest {
    @Test public void untouchedFieldsRebaseSilently() throws Exception {
        JSONObject editor = EditorRebase.edit(EditorRebase.open(V2.state()), "reps", 8);
        JSONObject latest = V2.state().put("weight", 62.5);
        JSONObject next = EditorRebase.rebase(editor, latest);
        assertEquals(62.5, next.getJSONObject("draft").getDouble("weight"), 0);
        assertEquals(62.5, next.getJSONObject("base").getDouble("weight"), 0);
        assertEquals(8, next.getJSONObject("draft").getInt("reps"));
        assertEquals(0, next.getJSONArray("stale").length());
    }
    @Test public void touchedFieldChangedRemotelyIsStaleUntilAccepted() throws Exception {
        JSONObject editor = EditorRebase.edit(EditorRebase.open(V2.state()), "reps", 8);
        JSONObject next = EditorRebase.rebase(editor, V2.state().put("reps", 10));
        assertEquals(8, next.getJSONObject("draft").getInt("reps"));
        assertTrue(next.getJSONObject("base").isNull("reps"));
        assertEquals("reps", next.getJSONArray("stale").getJSONObject(0).getString("field"));
        assertEquals(10, next.getJSONArray("stale").getJSONObject(0).getInt("latest"));
        JSONObject accepted = EditorRebase.accept(next, "reps");
        assertEquals(0, accepted.getJSONArray("stale").length());
        assertEquals(10, accepted.getJSONObject("base").getInt("reps"));
        assertEquals(10, EditorRebase.expected(accepted, true).getInt("reps"));
        assertFalse(EditorRebase.expected(accepted, true).getBoolean("completed"));
        assertEquals(8, EditorRebase.changes(accepted, true).getInt("reps"));
    }
    @Test public void touchedFieldUnchangedRemotelyStaysClean() throws Exception {
        JSONObject editor = EditorRebase.edit(EditorRebase.open(V2.state().put("reps", 5)), "reps", 8);
        JSONObject next = EditorRebase.rebase(editor, V2.state().put("reps", 5.0));
        assertEquals(0, next.getJSONArray("stale").length());
    }
}
