package com.ironpath.wearlink;

import org.json.JSONArray;
import org.json.JSONObject;

public final class WatchProjection {
    public static boolean equal(JSONObject a, JSONObject b) throws Exception {
        if (a.length() != b.length()) return false;
        for (var keys = a.keys(); keys.hasNext();) {
            String key = keys.next();
            if (!sameValue(a.get(key), b.opt(key))) return false;
        }
        return true;
    }
    private static boolean sameValue(Object a, Object b) {
        if (a instanceof Number && b instanceof Number) return Double.compare(((Number)a).doubleValue(), ((Number)b).doubleValue()) == 0;
        return a == JSONObject.NULL ? b == JSONObject.NULL : a.equals(b);
    }
    public static JSONObject step(JSONObject snapshot, String id) throws Exception {
        JSONArray steps = snapshot.getJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) if (steps.getJSONObject(i).getString("setId").equals(id)) return steps.getJSONObject(i);
        throw new IllegalStateException("This set is no longer in the workout");
    }
    private static boolean apply(JSONObject snapshot, JSONObject command) throws Exception {
        if (!snapshot.getString("epoch").equals(command.getString("epoch")) || !snapshot.getString("sessionId").equals(command.getString("sessionId"))) return false;
        JSONObject target;
        try { target = step(snapshot, command.getString("setId")); } catch (IllegalStateException error) { return false; }
        if (!target.getString("exerciseId").equals(command.getString("exerciseId"))) return false;
        JSONObject actual = target.getJSONObject("actual"), changes = command.getJSONObject("changes");
        boolean applied = true;
        for (var keys = changes.keys(); keys.hasNext();) {
            String key = keys.next();
            if (!sameValue(changes.get(key), actual.opt(key))) applied = false;
        }
        if (applied) return true; // Canonical snapshot already includes the effect; its result ACK may still be in flight.
        if (!equal(actual, command.getJSONObject("expected"))) return false;
        for (var keys = changes.keys(); keys.hasNext();) { String key = keys.next(); actual.put(key, changes.get(key)); }
        return true;
    }
    public static JSONObject project(JSONObject base, JSONArray effects, JSONArray pending) throws Exception {
        JSONObject snapshot = new JSONObject(base.toString());
        boolean blocked = false;
        java.util.List<JSONObject> actions = new java.util.ArrayList<>();
        for (int i = 0; i < effects.length(); i++) {
            JSONObject effect = effects.getJSONObject(i);
            if (effect.getLong("revision") > base.getLong("revision")) {
                actions.add(effect.getJSONObject("body"));
                snapshot.put("revision", Math.max(snapshot.getLong("revision"), effect.getLong("revision")));
            }
        }
        for (int i = 0; i < pending.length(); i++) actions.add(pending.getJSONObject(i).getJSONObject("packet").getJSONObject("body"));
        actions.sort((a, b) -> Long.compare(a.optLong("sequence"), b.optLong("sequence")));
        JSONObject sequences = base.optJSONObject("sequences");
        for (JSONObject action : actions) {
            if (sequences != null && action.getLong("sequence") <= sequences.optLong(action.getString("deviceId"))) continue;
            if (!apply(snapshot, action)) blocked = true;
        }
        return new JSONObject().put("snapshot", snapshot).put("blocked", blocked);
    }
}
