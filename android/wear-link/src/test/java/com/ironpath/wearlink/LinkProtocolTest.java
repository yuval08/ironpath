package com.ironpath.wearlink;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class LinkProtocolTest {
    @Test public void responseKeepsCorrelationId() throws Exception {
        LinkProtocol ping = LinkProtocol.ping();
        LinkProtocol pong = LinkProtocol.decode(ping.pong().encode());
        assertEquals(ping.id, pong.id);
        assertEquals("pong", pong.type);
    }
    @Test public void refusesUnsupportedVersionsAndWorkoutCommands() throws Exception {
        String valid = new String(LinkProtocol.ping().encode(), StandardCharsets.UTF_8);
        rejects(valid.replace("\"version\":1", "\"version\":2").getBytes(StandardCharsets.UTF_8));
        rejects(valid.replace("\"ping\"", "\"completeSet\"").getBytes(StandardCharsets.UTF_8));
        rejects(valid.replace("\"version\":1", "\"version\":\"1\"").getBytes(StandardCharsets.UTF_8));
        rejects((valid + "{}").getBytes(StandardCharsets.UTF_8));
    }
    @Test public void refusesMalformedOrUnboundedInput() throws Exception {
        rejects(new byte[0]);
        rejects(new byte[LinkProtocol.MAX_BYTES + 1]);
        rejects(new byte[] {(byte) 0xc3, (byte) 0x28});
        rejects("{\"version\":1,\"id\":\"bad\",\"type\":\"ping\"}".getBytes(StandardCharsets.UTF_8));
    }
    private void rejects(byte[] bytes) throws Exception {
        assertThrows(Exception.class, () -> LinkProtocol.decode(bytes));
    }
}
