package com.ironpath.wearlink;

import android.content.Intent;
import android.util.Log;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;
import org.json.JSONObject;

/** Routes the three workout paths and the diagnostic ping path; runs while the app UI is suspended. */
public final class LinkListenerService extends WearableListenerService {
    private boolean isPeerCapability(String name) {
        return name.equals(LinkProtocol.PHONE) || name.equals(LinkProtocol.WATCH) || name.equals(WorkClient.PHONE_V2) || name.equals(WorkClient.WATCH_V2);
    }
    @Override public void onCapabilityChanged(com.google.android.gms.wearable.CapabilityInfo info) {
        if (!isPeerCapability(info.getName())) return;
        try {
            try (WorkStore store = new WorkStore(this)) {
                store.retryReceivedCommands();
                store.putState("peerChangedAt", Long.toString(System.currentTimeMillis()));
                store.putState("peerReachable", Boolean.toString(!info.getNodes().isEmpty()));
            }
            Diagnostics.record(this, "sync.peer", new JSONObject().put("data", new JSONObject()
                .put("reachable", !info.getNodes().isEmpty()).put("nodeCount", info.getNodes().size()).put("capability", info.getName())));
            if (!info.getNodes().isEmpty()) WorkClient.hello(this);
            if (!WorkClient.isWatch(this)) WorkClient.compat(this); // refresh the cached compat
            WorkClient.flush(this);
        }
        catch (Exception error) { Log.w("IronpathWork", "Pending work awaits retry", error); }
    }
    @Override public void onMessageReceived(MessageEvent event) {
        String path = event.getPath();
        if (WorkProtocol.PATH.equals(path) || WorkProtocol.PATH_V2.equals(path) || WorkProtocol.REST_PATH.equals(path)) {
            work(event);
            return;
        }
        if (!LinkProtocol.PATH.equals(path)) return;
        try {
            LinkProtocol message = LinkProtocol.decode(event.getData());
            try (LinkStore store = new LinkStore(this)) {
                store.record(event.getSourceNodeId(), message);
            }
            // Only acknowledge after the native receipt is durably committed.
            if (message.type.equals("ping")) {
                com.google.android.gms.wearable.Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(),
                    LinkProtocol.PATH, message.pong().encode())
                    .addOnFailureListener(error -> Log.w("IronpathLink", "Reply failed", error));
            }
        } catch (Exception error) {
            // Invalid messages or failed writes are never acknowledged as saved.
            Log.w("IronpathLink", "Diagnostic message rejected", error);
        }
    }
    private void work(MessageEvent event) {
        String peer = event.getSourceNodeId();
        boolean watch = WorkClient.isWatch(this);
        try {
            WorkProtocol packet = WorkProtocol.decode(event.getData(), event.getPath());
            if (packet.type.equals("diagRequest")) { if (watch) WorkClient.sendDiagnostics(this, peer, packet.body); return; }
            if (packet.type.equals("diagChunk")) { if (!watch) WorkClient.importDiagnostics(this, peer, packet.body); return; }
            if (WorkProtocol.REST_TYPES.contains(packet.type)) { RestCoordinator.receive(this, peer, packet); changed(); return; }
            JSONObject restBefore, restAfter;
            WorkProtocol ack;
            try (WorkStore store = new WorkStore(this)) {
                restBefore = store.rest();
                ack = store.receive(peer, packet, watch);
                restAfter = store.rest();
            }
            changed();
            if (packet.type.equals("hello")) hello(peer, packet, watch);
            if (ack != null) WorkClient.send(this, peer, ack);
            if (watch && !String.valueOf(restBefore).equals(String.valueOf(restAfter))) {
                // A snapshot switch or a closed control ended the local rest: re-arm from stored state.
                RestCoordinator.applyEffects(this);
            }
            WorkClient.flush(this);
        } catch (Exception error) {
            Log.w("IronpathWork", "Workout packet rejected", error);
        }
    }
    /** Answer a first hello; the phone then asks the watch for diagnostics. */
    private void hello(String peer, WorkProtocol packet, boolean watch) throws Exception {
        if (!packet.body.getBoolean("reply")) WorkClient.hello(this, peer, true);
        if (!watch) { WorkClient.compat(this); WorkClient.requestDiagnostics(this); }
    }
    private void changed() { sendBroadcast(new Intent("com.ironpath.app.WORK_CHANGED").setPackage(getPackageName())); }
}
