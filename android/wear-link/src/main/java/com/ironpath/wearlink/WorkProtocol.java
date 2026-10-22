package com.ironpath.wearlink;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Workout (v1, v2) and rest (v2) packets. Every body is validated on construction; v2 mirrors the zod
 * schemas in src/watch/protocol.ts exactly (design §1).
 */
public final class WorkProtocol {
    public static final String PATH = "/ironpath/work/v1";
    public static final String PATH_V2 = "/ironpath/work/v2";
    public static final String REST_PATH = "/ironpath/rest/v2";
    public static final int MAX_BYTES = 96 * 1024;
    public static final int MAX_REST_BYTES = 4 * 1024;
    public static final int MAX_MUTATION_BYTES = 8 * 1024;
    public static final List<String> RESULT_CODES = Arrays.asList("ok", "noop", "fieldConflict", "setMissing",
        "exerciseChanged", "exerciseSkipped", "unsupportedStyle", "sessionClosed", "epochMismatch", "sequenceReused",
        "idReused", "invalid", "reviewMissing", "pending", "closed", "frozen", "stale");
    static final Set<String> WORK_V2_TYPES = set("hello", "snapshot", "mutation", "result", "ack", "control", "status", "diagRequest", "diagChunk");
    static final Set<String> REST_TYPES = set("restOp", "restState", "restArmed");

    public final int version;
    public final String id;
    public final String type;
    public final JSONObject body;

    public WorkProtocol(String id, String type, JSONObject body) throws Exception { this(1, id, type, body); }
    public WorkProtocol(int version, String id, String type, JSONObject body) throws Exception {
        this.version = version; this.id = id; this.type = type; this.body = body;
        validate();
    }
    public byte[] encode() throws Exception {
        byte[] bytes = json().toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > maxBytes(path())) throw new IllegalArgumentException("Packet too large");
        return bytes;
    }
    public JSONObject json() throws Exception {
        return new JSONObject().put("version", version).put("id", id).put("type", type).put("body", body);
    }
    /** The only path this packet may travel on. */
    public String path() {
        if (version == 1) return PATH;
        boolean rest = REST_TYPES.contains(type) || (type.equals("ack") && REST_TYPES.contains(body.optString("type")));
        return rest ? REST_PATH : PATH_V2;
    }
    static int maxBytes(String path) { return REST_PATH.equals(path) ? MAX_REST_BYTES : MAX_BYTES; }

    /** Decodes a packet received on {@code path}; the version and type must belong to that path. */
    public static WorkProtocol decode(byte[] bytes, String path) throws Exception {
        if (!PATH.equals(path) && !PATH_V2.equals(path) && !REST_PATH.equals(path)) throw new IllegalArgumentException("Unknown path");
        WorkProtocol packet = parse(bytes, maxBytes(path));
        if (!packet.path().equals(path)) throw new IllegalArgumentException("Packet is not valid on " + path);
        return packet;
    }
    /** Decodes a stored or bridged packet of either version. */
    public static WorkProtocol decode(byte[] bytes) throws Exception {
        WorkProtocol packet = parse(bytes, MAX_BYTES);
        if (bytes.length > maxBytes(packet.path())) throw new IllegalArgumentException("Invalid packet size");
        return packet;
    }
    private static WorkProtocol parse(byte[] bytes, int max) throws Exception {
        if (bytes == null || bytes.length == 0 || bytes.length > max)
            throw new IllegalArgumentException("Invalid packet size");
        String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString();
        JSONTokener tokens = new JSONTokener(text);
        Object parsed = tokens.nextValue();
        if (!(parsed instanceof JSONObject) || tokens.nextClean() != 0) throw new IllegalArgumentException("Invalid JSON");
        JSONObject packet = (JSONObject) parsed;
        Object version = packet.opt("version");
        if (packet.length() != 4 || !(Integer.valueOf(1).equals(version) || Integer.valueOf(2).equals(version)))
            throw new IllegalArgumentException("Unsupported protocol version");
        return new WorkProtocol((Integer) version, string(packet, "id", 36), string(packet, "type", 20), packet.getJSONObject("body"));
    }
    public static WorkProtocol decode(JSONObject json) throws Exception {
        return decode(json.toString().getBytes(StandardCharsets.UTF_8));
    }
    public WorkProtocol acknowledgement(String state, String reason) throws Exception {
        if (version == 2) return acknowledgement(state, state.equals("received") ? "ok" : "invalid", reason);
        return new WorkProtocol(id, "ack", new JSONObject().put("type", type).put("state", state).put("reason", reason));
    }
    /** v2 acknowledgement with a result code; travels on this packet's path. */
    public WorkProtocol acknowledgement(String state, String code, String reason) throws Exception {
        return new WorkProtocol(2, id, "ack", new JSONObject().put("type", type).put("state", state).put("code", code)
            .put("reason", reason.length() > 512 ? reason.substring(0, 512) : reason));
    }

    // ---- field helpers (shared by v1 and v2) ----
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
    private static String uuid(JSONObject object, String key) throws Exception {
        String value = string(object, key, 36); uuid(value); return value;
    }
    /** String that may be empty (zod z.string().max(n)). */
    private static String text(JSONObject object, String key, int max) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof String) || ((String) value).length() > max) throw new IllegalArgumentException("Invalid " + key);
        return (String) value;
    }
    private static String nullableText(JSONObject object, String key, int max) throws Exception {
        return object.get(key) == JSONObject.NULL ? null : text(object, key, max);
    }
    private static boolean bool(JSONObject object, String key) throws Exception {
        if (!(object.get(key) instanceof Boolean)) throw new IllegalArgumentException("Invalid " + key);
        return object.getBoolean(key);
    }
    private static String oneOf(JSONObject object, String key, String... values) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof String) || !Arrays.asList(values).contains(value)) throw new IllegalArgumentException("Invalid " + key);
        return (String) value;
    }
    private static long range(JSONObject object, String key, long min, long max) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid " + key);
        double n = ((Number) value).doubleValue();
        if (!Double.isFinite(n) || n != Math.floor(n) || n < min || n > max) throw new IllegalArgumentException("Invalid " + key);
        return ((Number) value).longValue();
    }
    private static void finiteNonNegative(JSONObject object, String key) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue()) || ((Number) value).doubleValue() < 0)
            throw new IllegalArgumentException("Invalid " + key);
    }
    /** zod .strict(): exactly these keys; optional ones may be absent. */
    private static void keys(JSONObject object, String[] required, String... optional) {
        Set<String> allowed = new HashSet<>(Arrays.asList(required)); allowed.addAll(Arrays.asList(optional));
        for (String key : required) if (!object.has(key)) throw new IllegalArgumentException("Missing " + key);
        for (var it = object.keys(); it.hasNext();) {
            String key = it.next();
            if (!allowed.contains(key)) throw new IllegalArgumentException("Unknown field " + key);
        }
    }
    private static String[] req(String... keys) { return keys; }
    private static Set<String> set(String... values) { return new HashSet<>(Arrays.asList(values)); }
    private static JSONObject nullableObject(JSONObject object, String key) throws Exception {
        Object value = object.get(key);
        if (value == JSONObject.NULL) return null;
        if (!(value instanceof JSONObject)) throw new IllegalArgumentException("Invalid " + key);
        return (JSONObject) value;
    }

    private void validate() throws Exception {
        uuid(id);
        if (version == 1) { validateV1(); return; }
        if (version != 2) throw new IllegalArgumentException("Unsupported protocol version");
        if (!WORK_V2_TYPES.contains(type) && !REST_TYPES.contains(type)) throw new IllegalArgumentException("Unknown packet type");
        switch (type) {
            case "hello": validateHello(); break;
            case "snapshot": validateSnapshotV2(body); break;
            case "mutation": validateMutation(); break;
            case "result": validateResultV2(); break;
            case "ack": validateAckV2(); break;
            case "control": validateControlV2(); break;
            case "status": validateStatus(); break;
            case "diagRequest":
                keys(body, req("afterSeq", "max")); count(body, "afterSeq"); range(body, "max", 1, 150);
                break;
            case "diagChunk": validateDiagChunk(); break;
            case "restOp": validateRestOp(); break;
            case "restState": validateRestState(); break;
            default: validateRestArmed();
        }
    }

    // ---- v1 (unchanged) ----
    private void validateV1() throws Exception {
        switch (type) {
            case "snapshot":
                if (body.length() < 8 || body.length() > 11) throw new IllegalArgumentException("Invalid snapshot fields");
                if (body.has("controlRevision")) count(body, "controlRevision");
                if (body.has("vibrate") && !(body.get("vibrate") instanceof Boolean)) throw new IllegalArgumentException("Invalid vibration setting");
                if (body.has("sequences")) sequences(body.getJSONObject("sequences"), 32);
                if (!Integer.valueOf(1).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported snapshot");
                uuid(string(body, "epoch", 36)); string(body, "sessionId", 512); count(body, "revision");
                string(body, "title", 256);
                finiteNonNegative(body, "elapsedSeconds");
                if (!body.getString("status").equals("inProgress")) throw new IllegalArgumentException("Closed snapshot");
                JSONArray steps = body.getJSONArray("steps");
                if (steps.length() > 400) throw new IllegalArgumentException("Too many sets");
                HashSet<String> ids = new HashSet<>();
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
                if (body.length() != 12 || body.toString().getBytes(StandardCharsets.UTF_8).length > MAX_MUTATION_BYTES)
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
    private static void sequences(JSONObject sequences, int max) throws Exception {
        if (sequences.length() > max) throw new IllegalArgumentException("Too many device sequences");
        for (var keys = sequences.keys(); keys.hasNext();) { String key = keys.next(); uuid(key); count(sequences, key); }
    }
    /** watchSetStateSchema (full) or its .partial().strict() form. */
    private static void validateSet(JSONObject set, boolean partial) throws Exception {
        if (set.length() == 0 || (!partial && set.length() != MutationRules.WATCH_SET_FIELDS.size())) throw new IllegalArgumentException("Invalid set fields");
        validateSparse(set);
    }
    private static void validateSparse(JSONObject set) throws Exception {
        for (var it = set.keys(); it.hasNext();) {
            String key = it.next();
            if (!MutationRules.WATCH_SET_FIELDS.contains(key)) throw new IllegalArgumentException("Unknown set field");
            Object value = set.get(key);
            if (key.equals("completed")) {
                if (!(value instanceof Boolean)) throw new IllegalArgumentException("Invalid completion flag");
            } else metric(value, key.equals("rpe") ? 10 : key.equals("rir") ? 100 : 100000);
        }
    }
    private static void metric(Object value, double max) {
        if (value == JSONObject.NULL) return;
        if (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue())
            || ((Number) value).doubleValue() < 0 || ((Number) value).doubleValue() > max)
            throw new IllegalArgumentException("Invalid metric");
    }
    /** z.union([z.boolean(), metric]) */
    private static void boolOrMetric(Object value) {
        if (!(value instanceof Boolean)) metric(value, 100000);
    }

    // ---- v2 bodies ----
    private void validateHello() throws Exception {
        keys(body, req("role", "protocols", "versionName", "versionCode", "installId", "reply", "features"));
        oneOf(body, "role", "phone", "watch");
        JSONArray protocols = body.getJSONArray("protocols");
        if (protocols.length() < 1 || protocols.length() > 8) throw new IllegalArgumentException("Invalid protocols");
        for (int i = 0; i < protocols.length(); i++) {
            Object p = protocols.get(i);
            if (!(p instanceof Integer) || (Integer) p < 1 || (Integer) p > 99) throw new IllegalArgumentException("Invalid protocol");
        }
        string(body, "versionName", 20); range(body, "versionCode", 1, 9007199254740991L);
        uuid(body, "installId"); bool(body, "reply");
        JSONArray features = body.getJSONArray("features");
        if (features.length() > 8) throw new IllegalArgumentException("Too many features");
        for (int i = 0; i < features.length(); i++)
            if (!Arrays.asList("mutations2", "rest2", "diag1", "resolve1").contains(features.get(i))) throw new IllegalArgumentException("Unknown feature");
    }
    static void validateSnapshotV2(JSONObject body) throws Exception {
        keys(body, req("protocolVersion", "epoch", "sessionId", "revision", "controlRevision", "title", "status",
            "elapsedSeconds", "elapsedRunning", "capturedAtWall", "vibrate", "sequences", "freeze", "reviews", "phone", "steps"));
        if (!Integer.valueOf(2).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported snapshot");
        uuid(body, "epoch"); string(body, "sessionId", 512); count(body, "revision"); count(body, "controlRevision");
        text(body, "title", 256);
        if (!"inProgress".equals(body.get("status"))) throw new IllegalArgumentException("Closed snapshot");
        finiteNonNegative(body, "elapsedSeconds"); bool(body, "elapsedRunning"); count(body, "capturedAtWall"); bool(body, "vibrate");
        sequences(body.getJSONObject("sequences"), 32);
        JSONObject freeze = nullableObject(body, "freeze");
        if (freeze != null) { keys(freeze, req("id", "reason")); uuid(freeze, "id"); oneOf(freeze, "reason", "finish", "switch"); }
        JSONArray reviews = body.getJSONArray("reviews");
        if (reviews.length() > 50) throw new IllegalArgumentException("Too many reviews");
        for (int i = 0; i < reviews.length(); i++) {
            JSONObject review = reviews.getJSONObject(i);
            keys(review, req("id", "setId", "origin", "code", "reason", "fields"));
            uuid(review, "id"); string(review, "setId", 512); oneOf(review, "origin", "watch", "phone");
            resultCode(review); text(review, "reason", 512); reviewFields(review.getJSONArray("fields"));
        }
        JSONObject phone = body.getJSONObject("phone");
        keys(phone, req("versionName", "versionCode")); text(phone, "versionName", 20); range(phone, "versionCode", 1, 9007199254740991L);
        JSONArray steps = body.getJSONArray("steps");
        if (steps.length() > 400) throw new IllegalArgumentException("Too many sets");
        HashSet<String> ids = new HashSet<>();
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.getJSONObject(i);
            keys(step, req("setId", "prescriptionId", "exerciseId", "name", "setNumber", "workingNumber", "workingTotal",
                "isWarmUp", "entryStyle", "loadType", "unit", "target", "recommendedWeight", "band", "restAfter", "supported",
                "actual", "slot", "group", "bandLabel", "review"));
            if (!ids.add(string(step, "setId", 512))) throw new IllegalArgumentException("Duplicate set ID");
            string(step, "prescriptionId", 512); string(step, "exerciseId", 512); text(step, "name", 256);
            range(step, "setNumber", 1, 9007199254740991L); count(step, "workingNumber"); count(step, "workingTotal");
            bool(step, "isWarmUp"); text(step, "entryStyle", 40); text(step, "loadType", 40);
            oneOf(step, "unit", "kg", "lb"); text(step, "target", 256); metric(step.get("recommendedWeight"), 100000);
            nullableText(step, "band", 40); range(step, "restAfter", 0, 86400); bool(step, "supported");
            validateSet(step.getJSONObject("actual"), false);
            nullableText(step, "slot", 8); range(step, "group", 0, 400); nullableText(step, "bandLabel", 40); bool(step, "review");
        }
    }
    private static String resultCode(JSONObject object) throws Exception {
        Object code = object.get("code");
        if (!RESULT_CODES.contains(code)) throw new IllegalArgumentException("Invalid code");
        return (String) code;
    }
    private static void reviewFields(JSONArray fields) throws Exception {
        if (fields.length() > 7) throw new IllegalArgumentException("Too many fields");
        for (int i = 0; i < fields.length(); i++) {
            JSONObject field = fields.getJSONObject(i);
            // Every changed field of the op is listed; `conflict` marks the ones that actually conflicted.
            keys(field, req("field", "phone", "requested", "conflict"));
            if (!MutationRules.WATCH_SET_FIELDS.contains(field.get("field"))) throw new IllegalArgumentException("Invalid field");
            boolOrMetric(field.get("phone")); boolOrMetric(field.get("requested")); bool(field, "conflict");
        }
    }
    private void validateMutation() throws Exception {
        if (body.toString().getBytes(StandardCharsets.UTF_8).length > MAX_MUTATION_BYTES) throw new IllegalArgumentException("Mutation too large");
        keys(body, req("protocolVersion", "opId", "epoch", "sessionId", "deviceId", "sequence", "baseRevision", "controlRevision",
            "op", "target", "expected", "changes", "undoOf", "resolves", "keep", "createdAtWall"));
        if (!Integer.valueOf(2).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported mutation");
        if (!uuid(body, "opId").equals(id)) throw new IllegalArgumentException("opId must equal the packet id");
        uuid(body, "epoch"); string(body, "sessionId", 512); uuid(body, "deviceId");
        if (count(body, "sequence") == 0) throw new IllegalArgumentException("Invalid sequence");
        count(body, "baseRevision"); count(body, "controlRevision");
        oneOf(body, "op", MutationRules.OPS.toArray(new String[0]));
        JSONObject target = body.getJSONObject("target");
        keys(target, req("prescriptionId", "exerciseId", "setId"));
        string(target, "prescriptionId", 512); string(target, "exerciseId", 512); string(target, "setId", 512);
        validateSparse(body.getJSONObject("expected")); validateSparse(body.getJSONObject("changes"));
        for (String key : new String[]{"undoOf", "resolves"}) if (body.get(key) != JSONObject.NULL) uuid(body, key);
        if (body.get("keep") != JSONObject.NULL) oneOf(body, "keep", "phone", "watch");
        count(body, "createdAtWall");
        MutationRules.validateShape(body);
    }
    private void validateResultV2() throws Exception {
        keys(body, req("opId", "epoch", "sessionId", "state", "code", "revision", "reason", "review", "fields"));
        if (!uuid(body, "opId").equals(id)) throw new IllegalArgumentException("Wrong op ID");
        text(body, "epoch", 36); text(body, "sessionId", 512);
        oneOf(body, "state", "committed", "rejected", "conflict"); resultCode(body);
        count(body, "revision"); text(body, "reason", 512); bool(body, "review"); reviewFields(body.getJSONArray("fields"));
    }
    private void validateAckV2() throws Exception {
        String acknowledged = string(body, "type", 20);
        boolean rest = REST_TYPES.contains(acknowledged);
        if (!rest && !Arrays.asList("snapshot", "mutation", "result", "control", "status").contains(acknowledged))
            throw new IllegalArgumentException("Invalid acknowledgement");
        if (rest) keys(body, req("type", "state", "code", "reason"));
        else keys(body, req("type", "state", "code", "reason"), "deviceId", "sequence", "freezeId");
        oneOf(body, "state", "received", "rejected"); resultCode(body); text(body, "reason", 512);
        if (body.has("deviceId")) uuid(body, "deviceId");
        if (body.has("sequence")) count(body, "sequence");
        if (body.has("freezeId") && body.get("freezeId") != JSONObject.NULL) uuid(body, "freezeId");
    }
    private void validateControlV2() throws Exception {
        keys(body, req("epoch", "sessionId", "controlRevision", "action", "freezeId", "reason"));
        uuid(body, "epoch"); string(body, "sessionId", 512); count(body, "controlRevision");
        String action = oneOf(body, "action", "freeze", "unfreeze", "closed");
        oneOf(body, "reason", "finish", "switch", "completed", "removed", "restored");
        if (action.equals("closed")) { if (body.get("freezeId") != JSONObject.NULL) throw new IllegalArgumentException("Closed takes no freezeId"); }
        else uuid(body, "freezeId");
    }
    private void validateStatus() throws Exception {
        keys(body, req("epoch", "sessionId", "pendingMutations", "receivedMutations", "pendingRestOps", "reviewCount",
            "lastSequence", "diagnosticsLastSeq", "measuredAtWall"));
        if (body.get("epoch") != JSONObject.NULL) uuid(body, "epoch");
        if (body.get("sessionId") != JSONObject.NULL) string(body, "sessionId", 512);
        for (String key : new String[]{"pendingMutations", "receivedMutations", "pendingRestOps", "reviewCount", "lastSequence", "diagnosticsLastSeq", "measuredAtWall"})
            count(body, key);
    }
    private void validateDiagChunk() throws Exception {
        keys(body, req("events", "lastSeq", "more"));
        JSONArray events = body.getJSONArray("events");
        if (events.length() > 150) throw new IllegalArgumentException("Too many events");
        for (int i = 0; i < events.length(); i++) validateEvent(events.getJSONObject(i));
        count(body, "lastSeq"); bool(body, "more");
    }
    static void validateEvent(JSONObject event) throws Exception {
        keys(event, req("id", "seq", "device", "type", "at", "elapsed", "boot", "sessionId", "timerId", "revision", "opId", "data"));
        uuid(event, "id"); count(event, "seq"); oneOf(event, "device", "phone", "watch"); string(event, "type", 40);
        count(event, "at"); count(event, "elapsed"); count(event, "boot");
        nullableText(event, "sessionId", 512);
        if (event.get("timerId") != JSONObject.NULL) uuid(event, "timerId");
        if (event.get("revision") != JSONObject.NULL) count(event, "revision");
        if (event.get("opId") != JSONObject.NULL) uuid(event, "opId");
        event.getJSONObject("data");
    }
    private static void label(JSONObject object, String key) throws Exception {
        JSONObject label = nullableObject(object, key);
        if (label != null) { keys(label, req("title", "text")); text(label, "title", 120); text(label, "text", 200); }
    }
    private void validateRestOp() throws Exception {
        keys(body, req("protocolVersion", "opId", "deviceId", "restSequence", "epoch", "sessionId", "op", "timerId",
            "baseRevision", "durationMs", "deltaMs", "sourceOp", "reason", "next", "clock"));
        if (!Integer.valueOf(2).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported rest op");
        if (!uuid(body, "opId").equals(id)) throw new IllegalArgumentException("opId must equal the packet id");
        uuid(body, "deviceId");
        if (count(body, "restSequence") == 0) throw new IllegalArgumentException("Invalid rest sequence");
        uuid(body, "epoch"); string(body, "sessionId", 512);
        String op = oneOf(body, "op", "start", "adjust", "skip", "cancel");
        uuid(body, "timerId");
        if (body.get("baseRevision") != JSONObject.NULL) count(body, "baseRevision");
        if (body.get("durationMs") != JSONObject.NULL) range(body, "durationMs", 1000, RestRules.MAX_MS);
        if (body.get("deltaMs") != JSONObject.NULL && range(body, "deltaMs", -3_600_000, 3_600_000) == 0) throw new IllegalArgumentException("Zero delta");
        if (body.get("sourceOp") != JSONObject.NULL) uuid(body, "sourceOp");
        oneOf(body, "reason", "user", "undo", "zeroRest", "closed");
        label(body, "next");
        JSONObject clock = body.getJSONObject("clock");
        keys(clock, req("ageMs", "uncertain")); count(clock, "ageMs"); bool(clock, "uncertain");
        // Op-specific shape: start carries a duration, adjust a delta, cancel a source op.
        if (op.equals("start") != (body.get("durationMs") != JSONObject.NULL)) throw new IllegalArgumentException("durationMs is start-only");
        if (op.equals("adjust") != (body.get("deltaMs") != JSONObject.NULL)) throw new IllegalArgumentException("deltaMs is adjust-only");
        if (op.equals("cancel") && body.get("sourceOp") == JSONObject.NULL) throw new IllegalArgumentException("cancel needs sourceOp");
        if (!op.equals("start") && body.get("next") != JSONObject.NULL) throw new IllegalArgumentException("next is start-only");
    }
    static void validateRestTimer(JSONObject timer) throws Exception {
        keys(timer, req("timerId", "state", "startedAgoMs", "remainingMs", "durationMs", "origin", "originDevice", "sourceOp", "next", "alert"));
        uuid(timer, "timerId"); oneOf(timer, "state", "running", "ended", "skipped", "cancelled", "replaced");
        count(timer, "startedAgoMs"); count(timer, "remainingMs"); range(timer, "durationMs", 0, RestRules.MAX_MS);
        oneOf(timer, "origin", "phone", "watch"); uuid(timer, "originDevice");
        if (timer.get("sourceOp") != JSONObject.NULL) uuid(timer, "sourceOp");
        label(timer, "next");
        JSONObject alert = timer.getJSONObject("alert");
        keys(alert, req("preferred", "watchArmedRevision", "phoneBackup"));
        oneOf(alert, "preferred", "watch", "phone");
        if (alert.get("watchArmedRevision") != JSONObject.NULL) count(alert, "watchArmedRevision");
        oneOf(alert, "phoneBackup", "scheduled", "suppressed", "off", "delivered");
    }
    private void validateRestState() throws Exception {
        keys(body, req("protocolVersion", "epoch", "sessionId", "revision", "watermarks", "timer", "outcomes"));
        if (!Integer.valueOf(2).equals(body.get("protocolVersion"))) throw new IllegalArgumentException("Unsupported rest state");
        uuid(body, "epoch");
        if (body.get("sessionId") != JSONObject.NULL) string(body, "sessionId", 512);
        count(body, "revision"); sequences(body.getJSONObject("watermarks"), 8);
        JSONObject timer = nullableObject(body, "timer");
        if (timer != null) validateRestTimer(timer);
        JSONArray outcomes = body.getJSONArray("outcomes");
        if (outcomes.length() > 16) throw new IllegalArgumentException("Too many outcomes");
        for (int i = 0; i < outcomes.length(); i++) {
            JSONObject outcome = outcomes.getJSONObject(i);
            keys(outcome, req("opId", "outcome")); uuid(outcome, "opId");
            oneOf(outcome, "outcome", "applied", "stale", "superseded", "expired", "rejected");
        }
    }
    private void validateRestArmed() throws Exception {
        keys(body, req("deviceId", "timerId", "revision", "armed", "reason", "exact"));
        uuid(body, "deviceId"); uuid(body, "timerId"); count(body, "revision"); bool(body, "armed");
        oneOf(body, "reason", "ok", "notificationsOff", "channelOff", "exactDenied", "serviceFailed", "pendingOps");
        bool(body, "exact");
    }
}
