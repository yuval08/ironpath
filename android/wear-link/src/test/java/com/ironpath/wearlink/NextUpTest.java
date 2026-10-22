package com.ironpath.wearlink;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Text must equal nextUp()/nextUpLine() in src/utils/nextUp.ts (design §1.4). */
public class NextUpTest {
    private static JSONObject snapshot(JSONArray steps) throws Exception { return new JSONObject().put("steps", steps); }
    private static void complete(JSONObject step) throws Exception { step.getJSONObject("actual").put("completed", true); }

    @Test public void continuesTheCurrentExerciseWithTargetAndWeight() throws Exception {
        JSONArray steps = V2.steps();
        complete(steps.getJSONObject(0));
        JSONObject next = NextUp.compute(snapshot(steps), "set-1");
        assertEquals("set-2", next.getString("setId"));
        assertEquals("set", next.getString("kind"));
        assertEquals("Bench", next.getString("title"));
        assertEquals("Set 2 of 2 · 8-12 reps · 60 kg", next.getString("text"));
    }
    @Test public void supersetAlternatesBySlotAndCountsOnlyWorkingSets() throws Exception {
        JSONArray steps = new JSONArray()
            .put(V2.step("w-1", "a1", 1, 0, 2, 0).put("isWarmUp", true).put("slot", "A1"))
            .put(V2.step("a1-1", "a1", 2, 1, 2, 0).put("slot", "A1"))
            .put(V2.step("a1-2", "a1", 3, 2, 2, 0).put("slot", "A1"))
            .put(V2.step("a2-1", "a2", 1, 1, 2, 0).put("slot", "A2").put("name", "Row").put("target", "8 per side")
                .put("recommendedWeight", JSONObject.NULL).put("band", "red").put("bandLabel", "Red"))
            .put(V2.step("a2-2", "a2", 2, 2, 2, 0).put("slot", "A2").put("name", "Row"));
        complete(steps.getJSONObject(1));
        JSONObject next = NextUp.compute(snapshot(steps), "a1-1");
        assertEquals("a2-1", next.getString("setId"));
        assertEquals("exercise", next.getString("kind"));
        assertEquals("A2 · Row", next.getString("title"));
        assertEquals("Set 1 of 2 · 8 reps per side · Red band", next.getString("text"));
    }
    @Test public void actualWeightWinsAndDecimalsMatchJavaScript() throws Exception {
        JSONArray steps = V2.steps();
        steps.getJSONObject(0).getJSONObject("actual").put("weight", 62.5);
        assertEquals("Set 1 of 2 · 8-12 reps · 62.5 kg", NextUp.compute(snapshot(steps), null).getString("text"));
        assertEquals("exercise", NextUp.compute(snapshot(steps), null).getString("kind"));
    }
    @Test public void lastSetLeavesNothingNext() throws Exception {
        JSONArray steps = V2.steps();
        for (int i = 0; i < steps.length(); i++) complete(steps.getJSONObject(i));
        assertNull(NextUp.compute(snapshot(steps), "set-3"));
    }
    @Test public void nonRepTargetsAreUnchanged() {
        assertEquals("30 s", NextUp.targetLabel("30 s"));
        assertEquals("8 reps", NextUp.targetLabel("8"));
        assertEquals("8-12 reps per side", NextUp.targetLabel("8-12 per side"));
    }
}
