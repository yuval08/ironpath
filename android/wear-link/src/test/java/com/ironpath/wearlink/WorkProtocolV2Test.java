package com.ironpath.wearlink;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class WorkProtocolV2Test {
    private static byte[] bytes(WorkProtocol p) throws Exception { return p.encode(); }
    private static JSONObject mutationBody(String id) throws Exception {
        return new JSONObject().put("protocolVersion", 2).put("opId", id).put("epoch", V2.EPOCH).put("sessionId", "s")
            .put("deviceId", V2.PHONE_ID).put("sequence", 1).put("baseRevision", 0).put("controlRevision", 0).put("op", "complete")
            .put("target", new JSONObject().put("prescriptionId", "p").put("exerciseId", "e").put("setId", "set"))
            .put("expected", new JSONObject().put("completed", false)).put("changes", new JSONObject().put("completed", true))
            .put("undoOf", JSONObject.NULL).put("resolves", JSONObject.NULL).put("keep", JSONObject.NULL).put("createdAtWall", 1);
    }
    private static JSONObject restOpBody(String id) throws Exception {
        return new JSONObject().put("protocolVersion", 2).put("opId", id).put("deviceId", V2.PHONE_ID).put("restSequence", 1)
            .put("epoch", V2.EPOCH).put("sessionId", "s").put("op", "start").put("timerId", V2.uuid()).put("baseRevision", JSONObject.NULL)
            .put("durationMs", 60000).put("deltaMs", JSONObject.NULL).put("sourceOp", JSONObject.NULL).put("reason", "user")
            .put("next", new JSONObject().put("title", "A1 · Bench").put("text", "Set 2 of 4")).put("clock", new JSONObject().put("ageMs", 5).put("uncertain", false));
    }
    private static JSONObject restStateBody() throws Exception {
        JSONObject timer = new JSONObject().put("timerId", V2.uuid()).put("state", "running").put("startedAgoMs", 10).put("remainingMs", 50000)
            .put("durationMs", 60000).put("origin", "watch").put("originDevice", V2.PHONE_ID).put("sourceOp", JSONObject.NULL).put("next", JSONObject.NULL)
            .put("alert", new JSONObject().put("preferred", "watch").put("watchArmedRevision", JSONObject.NULL).put("phoneBackup", "scheduled"));
        return new JSONObject().put("protocolVersion", 2).put("epoch", V2.EPOCH).put("sessionId", "s").put("revision", 3)
            .put("watermarks", new JSONObject().put(V2.PHONE_ID, 1)).put("timer", timer)
            .put("outcomes", new JSONArray().put(new JSONObject().put("opId", V2.uuid()).put("outcome", "applied")));
    }

    @Test public void everyV2TypeIsAcceptedOnItsPath() throws Exception {
        String id = V2.uuid();
        WorkProtocol[] work = {
            V2.hello("phone", V2.PHONE_ID, false), V2.snapshot(1), new WorkProtocol(2, id, "mutation", mutationBody(id)),
            V2.result(new WorkProtocol(2, id, "mutation", mutationBody(id)), "conflict", "fieldConflict", 3, true,
                new JSONArray().put(new JSONObject().put("field", "reps").put("phone", 8).put("requested", 10).put("conflict", true))),
            V2.control("s", 2, "freeze", V2.uuid(), "finish"), V2.control("s", 3, "closed", null, "completed"),
            new WorkProtocol(2, V2.uuid(), "status", new JSONObject().put("epoch", V2.EPOCH).put("sessionId", "s").put("pendingMutations", 1)
                .put("receivedMutations", 0).put("pendingRestOps", 0).put("reviewCount", 0).put("lastSequence", 3).put("diagnosticsLastSeq", 9).put("measuredAtWall", 5)),
            new WorkProtocol(2, V2.uuid(), "diagRequest", new JSONObject().put("afterSeq", 0).put("max", 150)),
            new WorkProtocol(2, V2.uuid(), "diagChunk", new JSONObject().put("events", new JSONArray()).put("lastSeq", 0).put("more", false)),
        };
        for (WorkProtocol p : work) assertEquals(p.type, p.type, WorkProtocol.decode(bytes(p), WorkProtocol.PATH_V2).type);
        String restId = V2.uuid();
        WorkProtocol[] rest = {
            new WorkProtocol(2, restId, "restOp", restOpBody(restId)), new WorkProtocol(2, V2.uuid(), "restState", restStateBody()),
            new WorkProtocol(2, V2.uuid(), "restArmed", new JSONObject().put("deviceId", V2.PHONE_ID).put("timerId", V2.uuid()).put("revision", 3)
                .put("armed", true).put("reason", "ok").put("exact", true)),
        };
        for (WorkProtocol p : rest) {
            assertEquals(WorkProtocol.REST_PATH, p.path());
            WorkProtocol.decode(bytes(p), WorkProtocol.REST_PATH);
            WorkProtocol.decode(bytes(p.acknowledgement("received", "ok", "")), WorkProtocol.REST_PATH);
        }
    }
    @Test public void packetsOnTheWrongPathAreRejected() throws Exception {
        assertThrows(Exception.class, () -> WorkProtocol.decode(bytes(V2.snapshot(1)), WorkProtocol.PATH));
        assertThrows(Exception.class, () -> WorkProtocol.decode(bytes(V2.snapshot(1)), WorkProtocol.REST_PATH));
        String id = V2.uuid();
        assertThrows(Exception.class, () -> WorkProtocol.decode(bytes(new WorkProtocol(2, id, "restOp", restOpBody(id))), WorkProtocol.PATH_V2));
        WorkProtocol v1 = new WorkProtocol(V2.uuid(), "ack", new JSONObject().put("type", "snapshot").put("state", "received").put("reason", ""));
        assertThrows(Exception.class, () -> WorkProtocol.decode(bytes(v1), WorkProtocol.PATH_V2));
        WorkProtocol.decode(bytes(v1), WorkProtocol.PATH);
    }
    @Test public void unknownExtraAndMissingFieldsAreRejected() throws Exception {
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "snapshot", V2.snapshotBody("s", 1, 1, V2.steps()).put("extra", 1)));
        JSONObject missing = V2.snapshotBody("s", 1, 1, V2.steps()); missing.remove("freeze");
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "snapshot", missing));
        JSONArray steps = V2.steps(); steps.getJSONObject(0).put("unknown", true);
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "snapshot", V2.snapshotBody("s", 1, 1, steps)));
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "teleport", new JSONObject()));
        JSONObject noFlag = V2.snapshotBody("s", 1, 1, V2.steps());
        noFlag.getJSONArray("reviews").put(V2.review(V2.uuid(), "set-1", "reps", 8, 10));
        noFlag.getJSONArray("reviews").getJSONObject(0).getJSONArray("fields").getJSONObject(0).remove("conflict");
        assertThrows("review fields need the conflict flag", Exception.class, () -> new WorkProtocol(2, V2.uuid(), "snapshot", noFlag));
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "restArmed", new JSONObject().put("deviceId", V2.PHONE_ID)
            .put("timerId", V2.uuid()).put("revision", 3).put("armed", true).put("reason", "maybe").put("exact", true)));
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "control", V2.control("s", 1, "closed", null, "completed").body.put("freezeId", V2.uuid())));
    }
    @Test public void oversizePacketsAreRejectedPerPath() throws Exception {
        assertThrows(Exception.class, () -> WorkProtocol.decode(new byte[WorkProtocol.MAX_BYTES + 1], WorkProtocol.PATH_V2));
        assertThrows(Exception.class, () -> WorkProtocol.decode(new byte[WorkProtocol.MAX_REST_BYTES + 1], WorkProtocol.REST_PATH));
        // A full-size rest packet is refused on the rest path even though it would fit a work packet.
        String id = V2.uuid();
        byte[] padded = new WorkProtocol(2, id, "restOp", restOpBody(id)).encode();
        byte[] oversized = new String(padded, StandardCharsets.UTF_8).replace("\"user\"", "\"user\"" + " ".repeat(WorkProtocol.MAX_REST_BYTES)).getBytes(StandardCharsets.UTF_8);
        assertThrows(Exception.class, () -> WorkProtocol.decode(oversized, WorkProtocol.REST_PATH));
        JSONObject steps = V2.snapshotBody("s", 1, 1, new JSONArray());
        JSONArray many = new JSONArray();
        for (int i = 0; i < 400; i++) many.put(V2.step("set-" + i + "-" + "x".repeat(400), "p".repeat(500) + i, 1, 1, 1, 0).put("name", "n".repeat(256)));
        WorkProtocol snapshot = new WorkProtocol(2, V2.uuid(), "snapshot", steps.put("steps", many));
        assertThrows(Exception.class, snapshot::encode);
    }
    @Test public void mutationIdentityAndShapeAreEnforced() throws Exception {
        String id = V2.uuid();
        assertThrows(Exception.class, () -> new WorkProtocol(2, V2.uuid(), "mutation", mutationBody(id)));
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "mutation", mutationBody(id).put("op", "edit")
            .put("expected", new JSONObject()).put("changes", new JSONObject())));
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "mutation", mutationBody(id).put("op", "edit")
            .put("expected", new JSONObject().put("rpe", 1)).put("changes", new JSONObject().put("reps", 2))));
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "mutation", mutationBody(id).put("changes", new JSONObject().put("completed", true).put("reps", 100001))
            .put("expected", new JSONObject().put("completed", false).put("reps", JSONObject.NULL))));
    }
    @Test public void restOpShapeFollowsTheOp() throws Exception {
        String id = V2.uuid();
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "restOp", restOpBody(id).put("op", "adjust")));
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "restOp", restOpBody(id).put("op", "skip").put("durationMs", JSONObject.NULL)));
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "restOp", restOpBody(id).put("op", "adjust").put("durationMs", JSONObject.NULL)
            .put("next", JSONObject.NULL).put("deltaMs", 0)));
        new WorkProtocol(2, id, "restOp", restOpBody(id).put("op", "adjust").put("durationMs", JSONObject.NULL).put("next", JSONObject.NULL).put("deltaMs", -15000));
        assertThrows(Exception.class, () -> new WorkProtocol(2, id, "restOp", restOpBody(id).put("op", "cancel").put("durationMs", JSONObject.NULL).put("next", JSONObject.NULL)));
    }
    @Test public void v1PacketsStillDecodeUnchanged() throws Exception {
        WorkProtocol v1 = new WorkProtocol(V2.uuid(), "ack", new JSONObject().put("type", "command").put("state", "received").put("reason", ""));
        assertEquals(1, WorkProtocol.decode(v1.encode()).version);
        assertEquals(1, new JSONObject(new String(v1.encode(), StandardCharsets.UTF_8)).getInt("version"));
    }
}
