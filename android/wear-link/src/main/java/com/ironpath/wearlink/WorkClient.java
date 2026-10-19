package com.ironpath.wearlink;

import android.content.Context;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** All entry points run on a worker. Failed sends leave the durable outbox intact. */
public final class WorkClient {
    public static void publish(Context context, JSONObject input) throws Exception {
        WorkProtocol packet = WorkProtocol.decode(input.toString().getBytes(StandardCharsets.UTF_8));
        var nodes = Tasks.await(Wearable.getCapabilityClient(context)
            .getCapability(LinkProtocol.WATCH, CapabilityClient.FILTER_REACHABLE), 10, TimeUnit.SECONDS).getNodes();
        if (nodes.size() != 1) throw new IllegalStateException("Connect exactly one Ironpath watch before sending a workout.");
        try (WorkStore store = new WorkStore(context)) { store.publish(nodes.iterator().next().getId(), packet); }
        flush(context);
    }
    public static void flush(Context context) throws Exception {
        org.json.JSONArray outgoing;
        try (WorkStore store = new WorkStore(context)) { outgoing = store.outgoing(); }
        for (int i = 0; i < outgoing.length(); i++) {
            JSONObject row = outgoing.getJSONObject(i);
            // Dispatch without blocking for every peer. Receipt/final ACKs, not send success, clear work.
            Wearable.getMessageClient(context).sendMessage(row.getString("peer"), WorkProtocol.PATH,
                row.getJSONObject("packet").toString().getBytes(StandardCharsets.UTF_8))
                .addOnFailureListener(error -> android.util.Log.d("IronpathWork", "Queued packet awaits reconnect"));
        }
    }
}
