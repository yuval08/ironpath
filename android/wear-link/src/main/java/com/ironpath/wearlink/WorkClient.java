package com.ironpath.wearlink;

import android.content.Context;
import android.util.Log;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** All entry points run on a worker. Failed sends leave the durable outbox intact. */
public final class WorkClient {
    public static final String PHONE_V2 = "ironpath_phone_v2";
    public static final String WATCH_V2 = "ironpath_watch_v2";
    static final long HELLO_STALE_MS = 60_000;
    /** Diagnostic chunks must stay below the 96 KiB work packet limit, envelope included. */
    static final int DIAG_CHUNK_BYTES = 90 * 1024;

    public static boolean isWatch(Context context) {
        return context.getPackageManager().hasSystemFeature("android.hardware.type.watch");
    }
    /** Reachable peers of the other role (v1 or v2 capability), by node id. */
    static Map<String, Node> peers(Context context, long timeoutSeconds) throws Exception {
        boolean watch = isWatch(context);
        Map<String, Node> nodes = new LinkedHashMap<>();
        for (String capability : watch ? new String[]{LinkProtocol.PHONE, PHONE_V2} : new String[]{LinkProtocol.WATCH, WATCH_V2})
            for (Node node : Tasks.await(Wearable.getCapabilityClient(context).getCapability(capability, CapabilityClient.FILTER_REACHABLE),
                timeoutSeconds, TimeUnit.SECONDS).getNodes()) nodes.put(node.getId(), node);
        return nodes;
    }
    public static void publish(Context context, JSONObject input) throws Exception {
        WorkProtocol packet = WorkProtocol.decode(input.toString().getBytes(StandardCharsets.UTF_8));
        Map<String, Node> nodes = peers(context, 10);
        if (nodes.size() != 1) throw new IllegalStateException("Connect exactly one Ironpath watch before sending a workout.");
        try (WorkStore store = new WorkStore(context)) { store.publish(nodes.keySet().iterator().next(), packet); }
        flush(context);
    }
    /** Sends one packet on its own path without storing it (ACKs, hello, diagnostics). */
    public static void send(Context context, String peer, WorkProtocol packet) throws Exception {
        Wearable.getMessageClient(context).sendMessage(peer, packet.path(), packet.encode())
            .addOnFailureListener(error -> Log.d("IronpathWork", "Reply failed; the peer retries"));
    }
    public static void flush(Context context) throws Exception {
        JSONArray outgoing;
        try (WorkStore store = new WorkStore(context)) { outgoing = store.outgoing(); }
        for (int i = 0; i < outgoing.length(); i++) {
            JSONObject row = outgoing.getJSONObject(i);
            WorkProtocol packet = WorkProtocol.decode(row.getJSONObject("packet"));
            // Dispatch without blocking for every peer. Receipt/final ACKs, not send success, clear work.
            Wearable.getMessageClient(context).sendMessage(row.getString("peer"), packet.path(), packet.encode())
                .addOnFailureListener(error -> Log.d("IronpathWork", "Queued packet awaits reconnect"));
        }
    }
    /** Sends this device's hello to the reachable peer(s). */
    public static void hello(Context context) throws Exception {
        Map<String, Node> nodes = peers(context, 10);
        try (WorkStore store = new WorkStore(context)) {
            store.putState("peerReachable", Boolean.toString(!nodes.isEmpty()));
            store.putState("helloSentAt", Long.toString(System.currentTimeMillis()));
        }
        for (String node : nodes.keySet()) hello(context, node, false);
    }
    static void hello(Context context, String peer, boolean reply) throws Exception {
        WorkProtocol hello;
        try (WorkStore store = new WorkStore(context)) {
            hello = store.hello(isWatch(context), WatchView.versionName(context), WatchView.versionCode(context), reply);
        }
        send(context, peer, hello);
    }
    /** Hello again if the last one is older than a minute (phone flushWorkout, watch app launch). */
    public static void helloIfStale(Context context) {
        try {
            String sent;
            try (WorkStore store = new WorkStore(context)) { sent = store.state("helloSentAt"); }
            if (sent == null || System.currentTimeMillis() - Long.parseLong(sent) > HELLO_STALE_MS) hello(context);
        } catch (Exception error) { Log.d("IronpathWork", "Hello deferred", error); }
    }
    /** Phone: ask the watch for diagnostics after our cursor. Returns {requested, reason}. */
    public static JSONObject requestDiagnostics(Context context) throws Exception {
        String peer, cursor;
        JSONObject hello;
        try (WorkStore store = new WorkStore(context)) {
            peer = store.state("phonePeer");
            if (peer == null) {
                Map<String, Node> nodes = peers(context, 5);
                peer = nodes.size() == 1 ? nodes.keySet().iterator().next() : null;
            }
            hello = store.peerHello(peer);
            cursor = store.state("diagWatchCursor");
        }
        if (peer == null) return new JSONObject().put("requested", false).put("reason", "noWatch");
        if (hello == null || !hello.getJSONObject("hello").getJSONArray("features").toString().contains("\"diag1\""))
            return new JSONObject().put("requested", false).put("reason", "legacyWatch");
        long after = cursor == null ? 0 : Long.parseLong(cursor);
        send(context, peer, new WorkProtocol(2, java.util.UUID.randomUUID().toString(), "diagRequest",
            new JSONObject().put("afterSeq", after).put("max", 150)));
        Diagnostics.record(context, "diag.request", new JSONObject().put("data", new JSONObject().put("afterSeq", after)));
        return new JSONObject().put("requested", true).put("reason", "");
    }
    /** Watch: answer a diagRequest with chunks (≤150 events, ≤90 KiB each). Not durable. */
    static void sendDiagnostics(Context context, String peer, JSONObject request) throws Exception {
        JSONObject chunk = Diagnostics.chunk(context, request.getLong("afterSeq"), request.getInt("max"), DIAG_CHUNK_BYTES);
        send(context, peer, new WorkProtocol(2, java.util.UUID.randomUUID().toString(), "diagChunk", chunk));
    }
    /** Phone: import a diagChunk and continue while the watch has more. */
    static void importDiagnostics(Context context, String peer, JSONObject chunk) throws Exception {
        int added = Diagnostics.importEvents(context, chunk.getJSONArray("events"));
        try (WorkStore store = new WorkStore(context)) {
            String cursor = store.state("diagWatchCursor");
            if (cursor == null || Long.parseLong(cursor) < chunk.getLong("lastSeq")) store.putState("diagWatchCursor", Long.toString(chunk.getLong("lastSeq")));
        }
        Diagnostics.record(context, "diag.import", new JSONObject().put("data", new JSONObject()
            .put("afterSeq", chunk.getLong("lastSeq")).put("received", added).put("more", chunk.getBoolean("more"))));
        if (chunk.getBoolean("more")) requestDiagnostics(context);
    }
    /** Compat is cached so the 2 s phone poll never waits on a capability query. */
    static final long COMPAT_TTL_MS = 60_000;
    private static final java.util.concurrent.ExecutorService COMPAT_REFRESH = java.util.concurrent.Executors.newSingleThreadExecutor();
    private static final java.util.concurrent.atomic.AtomicBoolean COMPAT_IN_FLIGHT = new java.util.concurrent.atomic.AtomicBoolean();

    /**
     * Phone compatibility (§6.4 WatchCompat), measured now: exactly one reachable watch whose hello lists
     * protocol 2 with mutations2 and rest2. Blocking (capability queries); refreshes the cache.
     */
    public static JSONObject compat(Context context) throws Exception {
        Map<String, String> nodes = new LinkedHashMap<>();
        java.util.Set<String> v2 = new java.util.HashSet<>();
        try {
            for (Node node : reachable(context, LinkProtocol.WATCH)) nodes.put(node.getId(), node.getDisplayName());
            for (Node node : reachable(context, WATCH_V2)) { nodes.put(node.getId(), node.getDisplayName()); v2.add(node.getId()); }
        } catch (Exception error) { Log.d("IronpathWork", "Capability query failed; treating the watch as unreachable"); nodes.clear(); }
        try (WorkStore store = new WorkStore(context)) { return refreshCompat(store, nodes, v2, System.currentTimeMillis()); }
    }
    /** The cached compat for polling; never touches the network. A stale cache triggers a background refresh. */
    public static JSONObject cachedCompat(Context context) throws Exception {
        JSONObject cached;
        try (WorkStore store = new WorkStore(context)) { cached = cachedCompat(store, System.currentTimeMillis()); }
        if (cached.getBoolean("stale")) refreshCompatAsync(context);
        return cached.getJSONObject("compat");
    }
    static void refreshCompatAsync(Context context) {
        if (!COMPAT_IN_FLIGHT.compareAndSet(false, true)) return;
        Context app = context.getApplicationContext();
        COMPAT_REFRESH.execute(() -> {
            try { compat(app); } catch (Exception error) { Log.d("IronpathWork", "Compat refresh failed", error); }
            finally { COMPAT_IN_FLIGHT.set(false); }
        });
    }
    /** {compat, stale}. Without a cache, a provisional value is built from stored state only. */
    static JSONObject cachedCompat(WorkStore store, long nowWall) throws Exception {
        String text = store.state("compat");
        if (text != null) {
            JSONObject row = new JSONObject(text);
            return new JSONObject().put("compat", row.getJSONObject("value")).put("stale", nowWall - row.getLong("at") > COMPAT_TTL_MS || nowWall < row.getLong("at"));
        }
        String peer = store.state("phonePeer");
        boolean reachable = peer != null && !"false".equals(store.state("peerReachable"));
        Map<String, String> nodes = new LinkedHashMap<>();
        if (reachable) nodes.put(peer, "");
        return new JSONObject().put("compat", compatFrom(store, nodes, nodes.keySet())).put("stale", true);
    }
    static JSONObject refreshCompat(WorkStore store, Map<String, String> nodes, java.util.Set<String> v2Nodes, long nowWall) throws Exception {
        JSONObject value = compatFrom(store, nodes, v2Nodes);
        store.putState("peerReachable", Boolean.toString(!nodes.isEmpty()));
        store.putState("compat", new JSONObject().put("value", value).put("at", nowWall).toString());
        return value;
    }
    /** Pure compat decision from reachable nodes (id → name), the v2-capable subset and stored hellos. */
    static JSONObject compatFrom(WorkStore store, Map<String, String> nodes, java.util.Set<String> v2Nodes) throws Exception {
        String id = nodes.size() == 1 ? nodes.keySet().iterator().next() : store.state("phonePeer");
        JSONObject helloRow = store.peerHello(id), hello = helloRow == null ? null : helloRow.getJSONObject("hello");
        JSONObject peer = id == null ? null : new JSONObject().put("nodeId", id)
            .put("name", nodes.containsKey(id) ? nodes.get(id) : "").put("reachable", nodes.containsKey(id))
            .put("protocols", hello == null ? JSONObject.NULL : hello.getJSONArray("protocols"))
            .put("versionName", hello == null ? JSONObject.NULL : hello.getString("versionName"))
            .put("versionCode", hello == null ? JSONObject.NULL : hello.getLong("versionCode"))
            .put("helloAt", helloRow == null ? JSONObject.NULL : helloRow.getLong("receivedAtWall"));
        String reason;
        if (nodes.isEmpty()) reason = "noWatch";
        else if (nodes.size() > 1) reason = "multipleWatches";
        else if (WorkStore.sharedHello(hello)) reason = "ok";
        else if (hello != null) reason = "watchUpdateRequired";
        else reason = v2Nodes.contains(id) ? "helloPending" : "watchUpdateRequired";
        return new JSONObject().put("phoneProtocols", new JSONArray().put(1).put(2))
            .put("peer", peer == null ? JSONObject.NULL : peer).put("sharedMode", reason.equals("ok")).put("reason", reason);
    }
    private static java.util.Set<Node> reachable(Context context, String capability) throws Exception {
        return Tasks.await(Wearable.getCapabilityClient(context).getCapability(capability, CapabilityClient.FILTER_REACHABLE), 3, TimeUnit.SECONDS).getNodes();
    }
}
