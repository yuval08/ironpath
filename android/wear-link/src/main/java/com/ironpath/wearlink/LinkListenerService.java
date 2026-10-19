package com.ironpath.wearlink;

import android.util.Log;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;

public final class LinkListenerService extends WearableListenerService {
    @Override public void onCapabilityChanged(com.google.android.gms.wearable.CapabilityInfo info) {
        if (!info.getName().equals(LinkProtocol.PHONE) && !info.getName().equals(LinkProtocol.WATCH)) return;
        try {
            try (WorkStore store = new WorkStore(this)) { store.retryReceivedCommands(); }
            WorkClient.flush(this);
        }
        catch (Exception error) { Log.w("IronpathWork", "Pending work awaits retry", error); }
    }
    @Override public void onMessageReceived(MessageEvent event) {
        if (WorkProtocol.PATH.equals(event.getPath())) {
            try {
                WorkProtocol packet = WorkProtocol.decode(event.getData());
                WorkProtocol ack;
                try (WorkStore store = new WorkStore(this)) {
                    ack = store.receive(event.getSourceNodeId(), packet,
                        getPackageManager().hasSystemFeature("android.hardware.type.watch"));
                }
                sendBroadcast(new android.content.Intent("com.ironpath.app.WORK_CHANGED").setPackage(getPackageName()));
                WorkClient.flush(this);
                if (ack != null) Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(),
                    WorkProtocol.PATH, ack.encode()).addOnFailureListener(error -> Log.w("IronpathWork", "Acknowledgement failed"));
            } catch (Exception error) {
                Log.w("IronpathWork", "Workout packet rejected", error);
            }
            return;
        }
        if (!LinkProtocol.PATH.equals(event.getPath())) return;
        try {
            LinkProtocol message = LinkProtocol.decode(event.getData());
            try (LinkStore store = new LinkStore(this)) {
                store.record(event.getSourceNodeId(), message);
            }
            // Only acknowledge after the native receipt is durably committed.
            if (message.type.equals("ping")) {
                Wearable.getMessageClient(this).sendMessage(event.getSourceNodeId(),
                    LinkProtocol.PATH, message.pong().encode())
                    .addOnFailureListener(error -> Log.w("IronpathLink", "Reply failed", error));
            }
        } catch (Exception error) {
            // Invalid messages or failed writes are never acknowledged as saved.
            Log.w("IronpathLink", "Diagnostic message rejected", error);
        }
    }
}
