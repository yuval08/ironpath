package com.ironpath.wearlink;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Keeps an open set editor current while remote updates arrive (design §2.6).
 * Editor JSON: {base, draft, touched:[field], stale:[{field, latest}]}.
 */
public final class EditorRebase {
    private EditorRebase() { }

    /** A fresh editor over the projected actual values. */
    public static JSONObject open(JSONObject actual) throws Exception {
        return new JSONObject().put("base", new JSONObject(actual.toString())).put("draft", new JSONObject(actual.toString()))
            .put("touched", new JSONArray()).put("stale", new JSONArray());
    }

    /** The user changed {@code field}; it is now protected from silent rebases. */
    public static JSONObject edit(JSONObject editor, String field, Object value) throws Exception {
        JSONObject next = new JSONObject(editor.toString());
        next.getJSONObject("draft").put(field, value == null ? JSONObject.NULL : value);
        if (!contains(next.getJSONArray("touched"), field)) next.getJSONArray("touched").put(field);
        return next;
    }

    public static JSONObject rebase(JSONObject editor, JSONObject latestActual) throws Exception {
        JSONObject next = new JSONObject(editor.toString());
        JSONObject base = next.getJSONObject("base"), draft = next.getJSONObject("draft");
        JSONArray touched = next.getJSONArray("touched"), stale = new JSONArray();
        for (var keys = latestActual.keys(); keys.hasNext();) {
            String field = keys.next();
            Object latest = latestActual.get(field);
            if (!contains(touched, field)) { base.put(field, latest); draft.put(field, latest); }
            else if (!MutationRules.same(latest, base.opt(field))) stale.put(new JSONObject().put("field", field).put("latest", latest));
        }
        return next.put("stale", stale);
    }

    /** The user keeps their own value for {@code field} over the remote change. */
    public static JSONObject accept(JSONObject editor, String field) throws Exception {
        JSONObject next = new JSONObject(editor.toString());
        JSONArray stale = next.getJSONArray("stale"), kept = new JSONArray();
        for (int i = 0; i < stale.length(); i++) {
            JSONObject entry = stale.getJSONObject(i);
            if (entry.getString("field").equals(field)) next.getJSONObject("base").put(field, entry.get("latest"));
            else kept.put(entry);
        }
        return next.put("stale", kept);
    }

    /** expected = base restricted to touched fields (+ completed when completing). */
    public static JSONObject expected(JSONObject editor, boolean complete) throws Exception {
        JSONObject base = editor.getJSONObject("base"), out = new JSONObject();
        JSONArray touched = editor.getJSONArray("touched");
        for (int i = 0; i < touched.length(); i++) out.put(touched.getString(i), base.opt(touched.getString(i)) == null ? JSONObject.NULL : base.get(touched.getString(i)));
        if (complete) out.put("completed", base.optBoolean("completed", false));
        return out;
    }

    /** changes = draft restricted to touched fields (+ completed:true when completing). */
    public static JSONObject changes(JSONObject editor, boolean complete) throws Exception {
        JSONObject draft = editor.getJSONObject("draft"), out = new JSONObject();
        JSONArray touched = editor.getJSONArray("touched");
        for (int i = 0; i < touched.length(); i++) out.put(touched.getString(i), draft.get(touched.getString(i)));
        if (complete) out.put("completed", true);
        return out;
    }

    static boolean contains(JSONArray array, String value) throws Exception {
        for (int i = 0; i < array.length(); i++) if (value.equals(array.getString(i))) return true;
        return false;
    }
}
