package com.ironpath.wearlink;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Diagnostic protocol only. Workout commands are deliberately not accepted here. */
public final class LinkProtocol {
    public static final String PATH = "/ironpath/link/v1";
    public static final String PHONE = "ironpath_phone_v1";
    public static final String WATCH = "ironpath_watch_v1";
    public static final int MAX_BYTES = 1024;
    public final String id;
    public final String type;

    private LinkProtocol(String id, String type) { this.id = id; this.type = type; }
    public static LinkProtocol ping() { return new LinkProtocol(UUID.randomUUID().toString(), "ping"); }
    public LinkProtocol pong() { return new LinkProtocol(id, "pong"); }

    public byte[] encode() throws Exception {
        return new JSONObject().put("version", 1).put("id", id).put("type", type)
            .toString().getBytes(StandardCharsets.UTF_8);
    }

    public static LinkProtocol decode(byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES)
            throw new IllegalArgumentException("Invalid message size");
        String text = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        // JSONObject accepts trailing garbage; enforce the complete envelope before parsing.
        text = text.trim();
        if (!text.startsWith("{") || !text.endsWith("}"))
            throw new IllegalArgumentException("Invalid envelope");
        JSONTokener tokens = new JSONTokener(text);
        Object parsed = tokens.nextValue();
        if (!(parsed instanceof JSONObject) || tokens.nextClean() != 0)
            throw new IllegalArgumentException("Trailing content");
        JSONObject json = (JSONObject) parsed;
        if (json.length() != 3 || !(json.get("version") instanceof Integer)
            || json.getInt("version") != 1 || !(json.get("id") instanceof String)
            || !(json.get("type") instanceof String))
            throw new IllegalArgumentException("Unsupported protocol envelope");
        String id = json.getString("id");
        if (!UUID.fromString(id).toString().equals(id))
            throw new IllegalArgumentException("Invalid message ID");
        String type = json.getString("type");
        if (!type.equals("ping") && !type.equals("pong"))
            throw new IllegalArgumentException("Unknown message type");
        return new LinkProtocol(id, type);
    }
}
