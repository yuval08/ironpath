package com.ironpath.wearlink;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Next working set and its notification label (design §1.4). Selection and text must match
 * nextUp()/nextUpLine() in src/utils/nextUp.ts: groups in order; inside a group (superset) the member
 * with the fewest completed working sets goes next; warm-up/ramp sets are never "next".
 */
public final class NextUp {
    private NextUp() { }

    /** The inspect().next object, or null when nothing is left. */
    public static JSONObject compute(JSONObject projectedSnapshot, String lastCompletedSetIdOrNull) throws Exception {
        JSONArray steps = projectedSnapshot.getJSONArray("steps");
        // group -> prescriptionId -> working steps, all in snapshot order.
        Map<String, Map<String, List<JSONObject>>> groups = new LinkedHashMap<>();
        String lastPrescription = null;
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.getJSONObject(i);
            if (step.getString("setId").equals(lastCompletedSetIdOrNull)) lastPrescription = step.getString("prescriptionId");
            if (step.optBoolean("isWarmUp")) continue;
            // v1 snapshots have no group: every prescription is its own group.
            String group = step.has("group") ? "g" + step.getInt("group") : "p" + step.getString("prescriptionId");
            groups.computeIfAbsent(group, k -> new LinkedHashMap<>())
                .computeIfAbsent(step.getString("prescriptionId"), k -> new ArrayList<>()).add(step);
        }
        for (Map<String, List<JSONObject>> group : groups.values()) {
            List<JSONObject> best = null;
            for (List<JSONObject> working : group.values()) {
                if (firstOpen(working) < 0) continue;
                if (best == null || done(working) < done(best)) best = working;
            }
            if (best == null) continue;
            int index = firstOpen(best);
            JSONObject step = best.get(index), label = label(step, index, best.size());
            String kind = lastPrescription != null ? (lastPrescription.equals(step.getString("prescriptionId")) ? "set" : "exercise")
                : done(best) > 0 ? "set" : "exercise";
            Object weight = weight(step);
            return new JSONObject().put("setId", step.getString("setId")).put("prescriptionId", step.getString("prescriptionId"))
                .put("name", step.getString("name")).put("slot", step.opt("slot") == null ? JSONObject.NULL : step.get("slot"))
                .put("kind", kind).put("position", "Set " + (index + 1) + " of " + best.size())
                .put("target", step.getString("target")).put("weight", weight).put("unit", step.getString("unit"))
                .put("bandLabel", step.opt("bandLabel") == null ? JSONObject.NULL : step.get("bandLabel"))
                .put("supported", step.getBoolean("supported"))
                .put("title", label.getString("title")).put("text", label.getString("text"));
        }
        return null;
    }

    /** {title, text} for one snapshot step, using its own working position. */
    public static JSONObject label(JSONObject step) throws Exception {
        return label(step, Math.max(0, step.optInt("workingNumber", 1) - 1), step.optInt("workingTotal", 1));
    }

    private static JSONObject label(JSONObject step, int index, int total) throws Exception {
        String name = step.getString("name");
        Object slot = step.opt("slot");
        String title = slot instanceof String && !((String) slot).isEmpty() ? slot + " · " + name : name;
        List<String> parts = new ArrayList<>();
        parts.add("Set " + (index + 1) + " of " + total);
        String target = targetLabel(step.optString("target", ""));
        if (!target.isEmpty()) parts.add(target);
        String load = load(step);
        if (load != null) parts.add(load);
        return new JSONObject().put("title", title).put("text", String.join(" · ", parts));
    }

    /** "8-12" -> "8-12 reps", "8 per side" -> "8 reps per side"; anything else unchanged. */
    static String targetLabel(String planned) {
        return planned.replaceAll("^(\\d+(?:-\\d+)?)( per side)?$", "$1 reps$2");
    }
    private static Object weight(JSONObject step) throws Exception {
        Object actual = step.getJSONObject("actual").opt("weight");
        if (actual instanceof Number) return actual;
        Object recommended = step.opt("recommendedWeight");
        return recommended instanceof Number ? recommended : JSONObject.NULL;
    }
    private static String load(JSONObject step) throws Exception {
        Object weight = weight(step);
        if (weight instanceof Number) return number(((Number) weight).doubleValue()) + " " + step.getString("unit");
        Object band = step.opt("bandLabel");
        if (band instanceof String && !((String) band).isEmpty() && !"none".equals(step.opt("band"))) return band + " band";
        return null;
    }
    /** JavaScript's default number formatting for the values we show (60 -> "60", 62.5 -> "62.5"). */
    static String number(double value) {
        if (value == Math.rint(value) && Math.abs(value) < 1e15) return Long.toString((long) value);
        return Double.toString(value);
    }
    private static int firstOpen(List<JSONObject> working) throws Exception {
        for (int i = 0; i < working.size(); i++) if (!working.get(i).getJSONObject("actual").getBoolean("completed")) return i;
        return -1;
    }
    private static int done(List<JSONObject> working) throws Exception {
        int done = 0;
        for (JSONObject step : working) if (step.getJSONObject("actual").getBoolean("completed")) done++;
        return done;
    }
}
