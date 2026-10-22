package com.ironpath.wearlink;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The single per-field three-way merge (design §2.1), mirrored by src/watch/mutations.ts and pinned by
 * src/test/resources/sync-v2/merge-cases.json.
 */
public final class MutationRules {
    public static final List<String> WATCH_SET_FIELDS = Collections.unmodifiableList(Arrays.asList(
        "completed", "reps", "repsLeft", "repsRight", "weight", "rpe", "rir"));
    public static final List<String> OPS = Collections.unmodifiableList(Arrays.asList("complete", "edit", "undo", "resolve"));

    private MutationRules() { }

    /** Numbers compare by value (1 == 1.0), null only equals null, everything else strictly. Missing == null. */
    public static boolean same(Object a, Object b) {
        if (a == null) a = JSONObject.NULL;
        if (b == null) b = JSONObject.NULL;
        if (a instanceof Number && b instanceof Number)
            return Double.compare(((Number) a).doubleValue(), ((Number) b).doubleValue()) == 0;
        if (a == JSONObject.NULL || b == JSONObject.NULL) return a == b;
        return a.equals(b);
    }

    /**
     * Merge {@code changes} onto {@code current} given the values the author saw ({@code expected}).
     * Returns {outcome: apply|noop|conflict, result: merged copy of current, conflicts: [field...] in
     * WATCH_SET_FIELDS order, applied: {field: value} actually changed}. A conflict applies nothing.
     */
    public static JSONObject merge(JSONObject current, JSONObject expected, JSONObject changes) throws Exception {
        JSONObject result = new JSONObject(current.toString()), applied = new JSONObject();
        JSONArray conflicts = new JSONArray();
        for (String field : ordered(changes)) {
            Object value = changes.get(field), now = current.opt(field);
            if (same(now, value)) continue;
            if (same(now, expected.opt(field))) applied.put(field, value);
            else conflicts.put(field);
        }
        String outcome = conflicts.length() > 0 ? "conflict" : applied.length() == 0 ? "noop" : "apply";
        if (outcome.equals("apply")) for (var keys = applied.keys(); keys.hasNext();) {
            String key = keys.next(); result.put(key, applied.get(key));
        }
        if (!outcome.equals("apply")) applied = new JSONObject();
        return new JSONObject().put("outcome", outcome).put("result", result).put("conflicts", conflicts).put("applied", applied);
    }

    /** Keys in canonical field order first, then any others (phone-only fields) alphabetically. */
    static List<String> ordered(JSONObject object) {
        java.util.ArrayList<String> keys = new java.util.ArrayList<>();
        for (String field : WATCH_SET_FIELDS) if (object.has(field)) keys.add(field);
        java.util.ArrayList<String> rest = new java.util.ArrayList<>();
        for (var it = object.keys(); it.hasNext();) { String key = it.next(); if (!WATCH_SET_FIELDS.contains(key)) rest.add(key); }
        Collections.sort(rest); keys.addAll(rest);
        return keys;
    }

    /** Mirrors mutationShapeRules (design §1.5). Throws IllegalArgumentException on any violation. */
    public static void validateShape(JSONObject body) throws Exception {
        String op = body.getString("op");
        if (!OPS.contains(op)) throw new IllegalArgumentException("Invalid op");
        JSONObject changes = body.getJSONObject("changes"), expected = body.getJSONObject("expected");
        if (!keys(changes).equals(keys(expected))) throw new IllegalArgumentException("Expected keys must match changes");
        Object undoOf = body.get("undoOf"), resolves = body.get("resolves"), keep = body.get("keep");
        boolean empty = changes.length() == 0;
        switch (op) {
            case "complete":
                if (empty || !Boolean.TRUE.equals(changes.opt("completed")) || !Boolean.FALSE.equals(expected.opt("completed")))
                    throw new IllegalArgumentException("Complete must set completed");
                nulls(undoOf, resolves, keep);
                break;
            case "edit":
                if (empty || changes.has("completed")) throw new IllegalArgumentException("Invalid edit");
                nulls(undoOf, resolves, keep);
                break;
            case "undo":
                if (empty || !(undoOf instanceof String)) throw new IllegalArgumentException("Invalid undo");
                nulls(resolves, keep);
                break;
            default: // resolve
                if (!(resolves instanceof String) || !("phone".equals(keep) || "watch".equals(keep)))
                    throw new IllegalArgumentException("Invalid resolve");
                if (undoOf != JSONObject.NULL || empty != "phone".equals(keep)) throw new IllegalArgumentException("Invalid resolve values");
        }
    }

    /** Inverse of an applied complete/edit: changes = original.expected, expected = original.changes. */
    public static JSONObject undoOf(JSONObject original) throws Exception {
        return new JSONObject().put("expected", new JSONObject(original.getJSONObject("changes").toString()))
            .put("changes", new JSONObject(original.getJSONObject("expected").toString()));
    }

    private static Set<String> keys(JSONObject object) {
        Set<String> keys = new HashSet<>();
        for (var it = object.keys(); it.hasNext();) keys.add(it.next());
        return keys;
    }
    private static void nulls(Object... values) {
        for (Object value : values) if (value != JSONObject.NULL) throw new IllegalArgumentException("Unexpected op field");
    }
}
