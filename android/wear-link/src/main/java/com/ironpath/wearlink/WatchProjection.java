package com.ironpath.wearlink;

import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Canonical snapshot + committed effects + unconfirmed local actions = what the watch shows. */
public final class WatchProjection {
    public static boolean equal(JSONObject a, JSONObject b) throws Exception {
        if (a.length() != b.length()) return false;
        for (var keys = a.keys(); keys.hasNext();) {
            String key = keys.next();
            if (!sameValue(a.get(key), b.opt(key))) return false;
        }
        return true;
    }
    static boolean sameValue(Object a, Object b) { return MutationRules.same(a, b); }
    public static JSONObject step(JSONObject snapshot, String id) throws Exception {
        JSONArray steps = snapshot.getJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) if (steps.getJSONObject(i).getString("setId").equals(id)) return steps.getJSONObject(i);
        throw new SyncError("stale", "This set is no longer in the workout");
    }
    static JSONObject stepOrNull(JSONObject snapshot, String id) throws Exception {
        try { return step(snapshot, id); } catch (SyncError error) { return null; }
    }
    /** v1 command: whole-set expected must match, unless the canonical set already includes the effect. */
    private static boolean applyV1(JSONObject snapshot, JSONObject command) throws Exception {
        if (!snapshot.getString("epoch").equals(command.getString("epoch")) || !snapshot.getString("sessionId").equals(command.getString("sessionId"))) return false;
        JSONObject target = stepOrNull(snapshot, command.getString("setId"));
        if (target == null || !target.getString("exerciseId").equals(command.getString("exerciseId"))) return false;
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
    /** v2 mutation: the shared per-field merge. keep:'phone' resolutions change nothing until the result arrives. */
    private static boolean applyV2(JSONObject snapshot, JSONObject mutation) throws Exception {
        if (!snapshot.getString("epoch").equals(mutation.getString("epoch")) || !snapshot.getString("sessionId").equals(mutation.getString("sessionId"))) return false;
        JSONObject target = mutation.getJSONObject("target"), step = stepOrNull(snapshot, target.getString("setId"));
        if (step == null || !step.getString("exerciseId").equals(target.getString("exerciseId"))) return false;
        if (mutation.getString("op").equals("resolve") && "phone".equals(mutation.optString("keep"))) return true;
        JSONObject merged = MutationRules.merge(step.getJSONObject("actual"), mutation.getJSONObject("expected"), mutation.getJSONObject("changes"));
        if (merged.getString("outcome").equals("conflict")) return false;
        step.put("actual", merged.getJSONObject("result"));
        return true;
    }
    private static boolean v2(JSONObject body) { return body.optInt("protocolVersion") == 2; }
    private static String device(JSONObject body) { return body.optString("deviceId"); }

    /**
     * Returns {snapshot, blocked, pendingSets}. Effects newer than the base and pending actions are
     * replayed in sequence order; actions already covered by the base's sequence watermark are skipped.
     * Each step gains {@code pending:true} while an unconfirmed local action targets it.
     */
    public static JSONObject project(JSONObject base, JSONArray effects, JSONArray pending) throws Exception {
        JSONObject snapshot = new JSONObject(base.toString());
        boolean blocked = false;
        java.util.List<JSONObject> actions = new java.util.ArrayList<>();
        Set<String> pendingSets = new HashSet<>();
        for (int i = 0; i < effects.length(); i++) {
            JSONObject effect = effects.getJSONObject(i);
            if (effect.getLong("revision") > base.getLong("revision")) {
                actions.add(effect.getJSONObject("body"));
                snapshot.put("revision", Math.max(snapshot.getLong("revision"), effect.getLong("revision")));
            }
        }
        for (int i = 0; i < pending.length(); i++) {
            JSONObject packet = pending.getJSONObject(i).getJSONObject("packet");
            JSONObject body = packet.getJSONObject("body");
            actions.add(body); pendingSets.add(setId(body));
        }
        actions.sort((a, b) -> Long.compare(a.optLong("sequence"), b.optLong("sequence")));
        JSONObject sequences = base.optJSONObject("sequences");
        for (JSONObject action : actions) {
            if (sequences != null && action.getLong("sequence") <= sequences.optLong(device(action))) continue;
            boolean ok = v2(action) ? applyV2(snapshot, action) : applyV1(snapshot, action);
            if (!ok && !v2(action)) blocked = true;
        }
        JSONArray steps = snapshot.getJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) steps.getJSONObject(i).put("pending", pendingSets.contains(steps.getJSONObject(i).getString("setId")));
        return new JSONObject().put("snapshot", snapshot).put("blocked", blocked).put("pendingSets", new JSONArray(pendingSets));
    }
    static String setId(JSONObject body) throws Exception {
        return v2(body) ? body.getJSONObject("target").getString("setId") : body.getString("setId");
    }
}
