package com.ironpath.wearlink;

import android.content.Context;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.Wearable;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Blocking operations: invoke on a worker, never on the main thread. */
public final class LinkClient {
    private static <T> T await(Task<T> task) throws Exception {
        return Tasks.await(task, 10, TimeUnit.SECONDS);
    }
    public static JSONObject inspect(Context context, String capability) throws Exception {
        JSONArray peers = new JSONArray();
        for (var node : await(Wearable.getCapabilityClient(context)
            .getCapability(capability, CapabilityClient.FILTER_REACHABLE)).getNodes()) {
            peers.put(new JSONObject().put("id", node.getId()).put("name", node.getDisplayName()));
        }
        try (LinkStore store = new LinkStore(context)) {
            return new JSONObject().put("protocolVersion", 1).put("peers", peers)
                .put("receipts", store.recent());
        }
    }
    public static String ping(Context context, String capability) throws Exception {
        var peers = await(Wearable.getCapabilityClient(context)
            .getCapability(capability, CapabilityClient.FILTER_REACHABLE)).getNodes();
        if (peers.isEmpty()) throw new IllegalStateException("No reachable companion. Open both apps and check pairing.");
        LinkProtocol message = LinkProtocol.ping();
        List<Task<Integer>> sends = new ArrayList<>();
        for (var node : peers) sends.add(Wearable.getMessageClient(context)
            .sendMessage(node.getId(), LinkProtocol.PATH, message.encode()));
        await(Tasks.whenAll(sends));
        return message.id; // Delivery is not proof of receipt; UI must wait for the matching pong.
    }
}
