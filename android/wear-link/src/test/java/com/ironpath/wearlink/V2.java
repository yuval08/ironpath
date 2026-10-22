package com.ironpath.wearlink;

import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Builders for protocol-v2 test packets. */
final class V2 {
    static final String EPOCH = "00000000-0000-4000-8000-000000000001";
    static final String PHONE_ID = "00000000-0000-4000-8000-0000000000aa";
    private V2() { }

    static JSONObject state() throws Exception {
        return new JSONObject("{\"completed\":false,\"reps\":null,\"repsLeft\":null,\"repsRight\":null,\"weight\":null,\"rpe\":null,\"rir\":null}");
    }
    static JSONObject step(String setId, String prescriptionId, int setNumber, int workingNumber, int workingTotal, int group) throws Exception {
        return new JSONObject().put("setId", setId).put("prescriptionId", prescriptionId).put("exerciseId", "e-" + prescriptionId)
            .put("name", "Bench").put("setNumber", setNumber).put("workingNumber", workingNumber).put("workingTotal", workingTotal)
            .put("isWarmUp", false).put("entryStyle", "reps").put("loadType", "weight").put("unit", "kg").put("target", "8-12")
            .put("recommendedWeight", 60).put("band", JSONObject.NULL).put("restAfter", 60).put("supported", true).put("actual", state())
            .put("slot", JSONObject.NULL).put("group", group).put("bandLabel", JSONObject.NULL).put("review", false);
    }
    static JSONArray steps() throws Exception {
        return new JSONArray().put(step("set-1", "p1", 1, 1, 2, 0)).put(step("set-2", "p1", 2, 2, 2, 0)).put(step("set-3", "p2", 1, 1, 1, 1));
    }
    static JSONObject snapshotBody(String session, long revision, long controlRevision, JSONArray steps) throws Exception {
        return new JSONObject().put("protocolVersion", 2).put("epoch", EPOCH).put("sessionId", session).put("revision", revision)
            .put("controlRevision", controlRevision).put("title", "Workout").put("status", "inProgress").put("elapsedSeconds", 0)
            .put("elapsedRunning", true).put("capturedAtWall", 1000).put("vibrate", true).put("sequences", new JSONObject())
            .put("freeze", JSONObject.NULL).put("reviews", new JSONArray())
            .put("phone", new JSONObject().put("versionName", "1.0.6").put("versionCode", 7)).put("steps", steps);
    }
    static WorkProtocol snapshot(JSONObject body) throws Exception { return new WorkProtocol(2, uuid(), "snapshot", body); }
    static WorkProtocol snapshot(long revision) throws Exception { return snapshot(snapshotBody("session1", revision, 1, steps())); }
    static WorkProtocol hello(String role, String installId, boolean reply) throws Exception {
        return new WorkProtocol(2, uuid(), "hello", new JSONObject().put("role", role).put("protocols", new JSONArray().put(1).put(2))
            .put("versionName", role.equals("phone") ? "1.0.6" : "0.5.0").put("versionCode", role.equals("phone") ? 7 : 5)
            .put("installId", installId).put("reply", reply).put("features", new JSONArray().put("mutations2").put("rest2").put("diag1").put("resolve1")));
    }
    static WorkProtocol result(WorkProtocol mutation, String state, String code, long revision, boolean review, JSONArray fields) throws Exception {
        return new WorkProtocol(2, mutation.id, "result", new JSONObject().put("opId", mutation.id)
            .put("epoch", mutation.body.getString("epoch")).put("sessionId", mutation.body.getString("sessionId"))
            .put("state", state).put("code", code).put("revision", revision).put("reason", "").put("review", review)
            .put("fields", fields == null ? new JSONArray() : fields));
    }
    static WorkProtocol control(String session, long controlRevision, String action, String freezeId, String reason) throws Exception {
        return new WorkProtocol(2, uuid(), "control", new JSONObject().put("epoch", EPOCH).put("sessionId", session)
            .put("controlRevision", controlRevision).put("action", action).put("freezeId", freezeId == null ? JSONObject.NULL : freezeId)
            .put("reason", reason));
    }
    static JSONObject review(String id, String setId, String field, Object phone, Object requested) throws Exception {
        return new JSONObject().put("id", id).put("setId", setId).put("origin", "watch").put("code", "fieldConflict").put("reason", "Phone changed")
            .put("fields", new JSONArray().put(new JSONObject().put("field", field).put("phone", phone).put("requested", requested).put("conflict", true)));
    }
    static String uuid() { return UUID.randomUUID().toString(); }
    /** The first pending outbox packet of a type, measured fresh against {@code clock}. */
    static WorkProtocol outgoing(WorkStore store, String type, Clock clock) throws Exception {
        JSONArray rows = store.outgoing(clock);
        for (int i = 0; i < rows.length(); i++) {
            JSONObject packet = rows.getJSONObject(i).getJSONObject("packet");
            if (packet.getString("type").equals(type)) return WorkProtocol.decode(packet);
        }
        return null;
    }
}
