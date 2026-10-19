package com.ironpath.wearlink;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Workout packets are isolated from the phase-one diagnostic protocol. */
public final class WorkProtocol {
    public static final String PATH = "/ironpath/work/v1";
    public static final int MAX_BYTES = 96 * 1024;
    public final String id;
    public final String type;
    public final JSONObject body;

    public WorkProtocol(String id, String type, JSONObject body) throws Exception {
        this.id = id; this.type = type; this.body = body;
        validate();
    }
    public byte[] encode() throws Exception {
        byte[] bytes = json().toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("Packet too large");
        return bytes;
    }
    public JSONObject json() throws Exception {
        return new JSONObject().put("version", 1).put("id", id).put("type", type).put("body", body);
    }
    public static WorkProtocol decode(byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES)
            throw new IllegalArgumentException("Invalid packet size");
        String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString();
        JSONTokener tokens = new JSONTokener(text);
        Object parsed = tokens.nextValue();
        if (!(parsed instanceof JSONObject) || tokens.nextClean() != 0) throw new IllegalArgumentException("Invalid JSON");
        JSONObject packet = (JSONObject) parsed;
        if (packet.length() != 4 || !Integer.valueOf(1).equals(packet.get("version")))
            throw new IllegalArgumentException("Unsupported protocol version");
        return new WorkProtocol(string(packet, "id", 36), string(packet, "type", 20), packet.getJSONObject("body"));
    }
    public WorkProtocol acknowledgement(String state, String reason) throws Exception {
        return new WorkProtocol(id, "ack", new JSONObject().put("type", type).put("state", state).put("reason", reason));
    }
    public static String string(JSONObject object, String key, int max) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof String) || ((String) value).isEmpty() || ((String) value).length() > max)
            throw new IllegalArgumentException("Invalid " + key);
        return (String) value;
    }
    public static long count(JSONObject object, String key) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid " + key);
        double n = ((Number) value).doubleValue();
        if (!Double.isFinite(n) || n < 0 || n != Math.floor(n) || n > 9007199254740991d)
            throw new IllegalArgumentException("Invalid " + key);
        return ((Number) value).longValue();
    }
    private static void uuid(String value) {
        if (!UUID.fromString(value).toString().equals(value)) throw new IllegalArgumentException("Invalid UUID");
    }
    private void validate() throws Exception {
        uuid(id);
        switch (type) {
            case "snapshot":
                if (body.length() < 8 || body.length() > 11) throw new IllegalArgumentException("Invalid snapshot fields");
                if (body.has("controlRevision")) count(body, "controlRevision");
                if (body.has("vibrate") && !(body.get("vibrate") instanceof Boolean)) throw new IllegalArgumentException("Invalid vibration setting");
                if (body.has("sequences")) {
                    JSONObject sequences = body.getJSONObject("sequences");
                    if (sequences.length() > 32) throw new IllegalArgumentException("Too many device sequences");
                    for (var keys = sequences.keys(); keys.hasNext();) { String key = keys.next(); uuid(key); count(sequences, key); }
                }
                if (!Integer.valueOf(1).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported snapshot");
                uuid(string(body, "epoch", 36)); string(body, "sessionId", 512); count(body, "revision");
                string(body, "title", 256);
                Object elapsed = body.get("elapsedSeconds");
                if (!(elapsed instanceof Number) || !Double.isFinite(((Number) elapsed).doubleValue()) || ((Number) elapsed).doubleValue() < 0)
                    throw new IllegalArgumentException("Invalid elapsed time");
                if (!body.getString("status").equals("inProgress")) throw new IllegalArgumentException("Closed snapshot");
                JSONArray steps = body.getJSONArray("steps");
                if (steps.length() > 400) throw new IllegalArgumentException("Too many sets");
                java.util.HashSet<String> ids = new java.util.HashSet<>();
                for (int i = 0; i < steps.length(); i++) {
                    JSONObject step = steps.getJSONObject(i);
                    if (!ids.add(string(step, "setId", 512))) throw new IllegalArgumentException("Duplicate set ID");
                    string(step, "prescriptionId", 512); string(step, "exerciseId", 512); string(step, "name", 256);
                    string(step, "entryStyle", 40); string(step, "loadType", 40); string(step, "target", 256);
                    String unit = string(step, "unit", 2);
                    if (!unit.equals("kg") && !unit.equals("lb")) throw new IllegalArgumentException("Invalid unit");
                    count(step, "setNumber"); count(step, "workingNumber"); count(step, "workingTotal");
                    if (count(step, "restAfter") > 86400) throw new IllegalArgumentException("Invalid rest");
                    if (!(step.get("isWarmUp") instanceof Boolean) || !(step.get("supported") instanceof Boolean))
                        throw new IllegalArgumentException("Invalid flags");
                    validateSet(step.getJSONObject("actual"), false);
                }
                break;
            case "control":
                if (body.length() != 4) throw new IllegalArgumentException("Invalid control fields");
                uuid(string(body, "epoch", 36)); string(body, "sessionId", 512); count(body, "controlRevision");
                String owner = string(body, "owner", 10);
                if (!owner.equals("phone") && !owner.equals("closed")) throw new IllegalArgumentException("Invalid control owner");
                break;
            case "command":
                if (body.length() != 12 || body.toString().getBytes(StandardCharsets.UTF_8).length > 8192)
                    throw new IllegalArgumentException("Invalid command fields");
                if (!Integer.valueOf(1).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported command");
                uuid(string(body, "epoch", 36)); uuid(string(body, "deviceId", 36));
                string(body, "sessionId", 512); string(body, "prescriptionId", 512);
                string(body, "setId", 512); string(body, "exerciseId", 512);
                if (count(body, "sequence") == 0 || !body.getString("action").equals("set")) throw new IllegalArgumentException("Invalid action");
                count(body, "baseRevision");
                validateSet(body.getJSONObject("expected"), false);
                validateSet(body.getJSONObject("changes"), true);
                break;
            case "result":
                if (!string(body, "commandId", 36).equals(id)) throw new IllegalArgumentException("Wrong command ID");
                if (!(body.get("epoch") instanceof String) || !(body.get("sessionId") instanceof String)) throw new IllegalArgumentException("Invalid result identity");
                String state = string(body, "state", 20);
                if (!state.equals("committed") && !state.equals("rejected") && !state.equals("conflict")) throw new IllegalArgumentException("Invalid final result");
                count(body, "revision");
                if (!(body.get("reason") instanceof String) || body.getString("reason").length() > 512) throw new IllegalArgumentException("Invalid result reason");
                break;
            case "ack":
                String acknowledged = string(body, "type", 20);
                if (!acknowledged.equals("snapshot") && !acknowledged.equals("command") && !acknowledged.equals("result") && !acknowledged.equals("control")) throw new IllegalArgumentException("Invalid acknowledgement");
                if (acknowledged.equals("control") && body.getString("state").equals("received")) {
                    uuid(string(body, "deviceId", 36)); count(body, "sequence");
                    if (body.has("restRemainingMs") && count(body, "restRemainingMs") > 86400000) throw new IllegalArgumentException("Invalid transferred rest");
                }
                String ackState = string(body, "state", 20);
                if (!ackState.equals("received") && !ackState.equals("rejected")) throw new IllegalArgumentException("Invalid acknowledgement state");
                if (!(body.get("reason") instanceof String) || body.getString("reason").length() > 512) throw new IllegalArgumentException("Invalid reason");
                break;
            default: throw new IllegalArgumentException("Unknown packet type");
        }
    }
    private static void validateSet(JSONObject set, boolean partial) throws Exception {
        String[] keys = {"completed", "reps", "repsLeft", "repsRight", "weight", "rpe", "rir"};
        java.util.Set<String> allowed = new java.util.HashSet<>(java.util.Arrays.asList(keys));
        if (set.length() == 0 || (!partial && set.length() != keys.length)) throw new IllegalArgumentException("Invalid set fields");
        for (var it = set.keys(); it.hasNext();) {
            String key = it.next();
            if (!allowed.contains(key)) throw new IllegalArgumentException("Unknown set field");
            Object value = set.get(key);
            if (key.equals("completed")) {
                if (!(value instanceof Boolean)) throw new IllegalArgumentException("Invalid completion flag");
            } else if (value != JSONObject.NULL) {
                double max = key.equals("rpe") ? 10 : key.equals("rir") ? 100 : 100000;
                if (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue())
                    || ((Number) value).doubleValue() < 0 || ((Number) value).doubleValue() > max)
                    throw new IllegalArgumentException("Invalid metric");
            }
        }
    }
}
