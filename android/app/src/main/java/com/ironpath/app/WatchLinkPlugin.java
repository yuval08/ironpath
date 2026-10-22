package com.ironpath.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ironpath.wearlink.Diagnostics;
import com.ironpath.wearlink.LinkClient;
import com.ironpath.wearlink.LinkProtocol;
import com.ironpath.wearlink.WorkClient;
import com.ironpath.wearlink.WorkStore;
import com.ironpath.wearlink.WorkProtocol;
import org.json.JSONObject;

@CapacitorPlugin(name = "WatchLink")
public final class WatchLinkPlugin extends Plugin {
    private BroadcastReceiver workChanged;

    /** workChanged: the native inbox, a control ACK or the watch status changed. */
    @Override public void load() {
        workChanged = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) { notifyListeners("workChanged", new JSObject()); }
        };
        ContextCompat.registerReceiver(getContext(), workChanged, new IntentFilter("com.ironpath.app.WORK_CHANGED"),
            ContextCompat.RECEIVER_NOT_EXPORTED);
    }
    @Override protected void handleOnDestroy() {
        if (workChanged != null) try { getContext().unregisterReceiver(workChanged); } catch (IllegalArgumentException ignored) { /* already gone */ }
        workChanged = null;
        super.handleOnDestroy();
    }
    private static WorkProtocol packet(JSObject packet, String missing) throws Exception {
        if (packet == null) throw new IllegalArgumentException(missing);
        return WorkProtocol.decode(packet);
    }

    @PluginMethod public void publishWorkout(PluginCall call) {
        getBridge().execute(() -> {
            try {
                JSObject packet = call.getObject("packet");
                if (packet == null) throw new IllegalArgumentException("Missing snapshot");
                WorkClient.publish(getContext(), packet);
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void controlWorkout(PluginCall call) {
        getBridge().execute(() -> {
            try (WorkStore store = new WorkStore(getContext())) {
                store.control(packet(call.getObject("packet"), "Missing control packet"));
                WorkClient.flush(getContext()); call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    /** v1 report + {watchStatus, compat}. */
    @PluginMethod public void inspectWorkout(PluginCall call) {
        getBridge().execute(() -> {
            try {
                JSONObject report;
                try (WorkStore store = new WorkStore(getContext())) {
                    report = store.inspect();
                    JSONObject status = store.watchStatus();
                    report.put("watchStatus", status == null ? JSONObject.NULL
                        : status.getJSONObject("status").put("receivedAtWall", status.getLong("receivedAtWall")));
                }
                report.put("compat", WorkClient.cachedCompat(getContext())); // never blocks on the network
                call.resolve(new JSObject(report.toString()));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void flushWorkout(PluginCall call) {
        getBridge().execute(() -> {
            try { WorkClient.helloIfStale(getContext()); WorkClient.flush(getContext()); call.resolve(); }
            catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void completeWorkoutCommand(PluginCall call) {
        getBridge().execute(() -> {
            try (WorkStore store = new WorkStore(getContext())) {
                String peer = call.getString("peer");
                if (peer == null) throw new IllegalArgumentException("Missing command result");
                store.complete(peer, packet(call.getObject("packet"), "Missing command result"));
                WorkClient.flush(getContext());
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void compat(PluginCall call) {
        getBridge().execute(() -> {
            try { call.resolve(new JSObject(WorkClient.compat(getContext()).toString())); }
            catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void diagnostics(PluginCall call) {
        getBridge().execute(() -> {
            try {
                int limit = Math.max(1, Math.min(1000, call.getInt("limit", 500)));
                call.resolve(new JSObject(new JSONObject().put("events", Diagnostics.recent(getContext(), null, limit))
                    .put("summary", Diagnostics.summary(getContext())).toString()));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void recordDiagnostic(PluginCall call) {
        getBridge().execute(() -> {
            try {
                String type = call.getString("type");
                if (type == null || !type.startsWith("js.") || type.length() > 40) throw new IllegalArgumentException("Diagnostic type must start with js.");
                JSONObject data = call.getData().optJSONObject("data");
                Diagnostics.record(getContext(), type, new JSONObject().put("data", data == null ? new JSONObject() : data)
                    .put("sessionId", call.getData().opt("sessionId")).put("timerId", call.getData().opt("timerId")));
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void requestWatchDiagnostics(PluginCall call) {
        getBridge().execute(() -> {
            try { call.resolve(new JSObject(WorkClient.requestDiagnostics(getContext()).toString())); }
            catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void inspect(PluginCall call) {
        getBridge().execute(() -> {
            try { call.resolve(new JSObject(LinkClient.inspect(getContext(), LinkProtocol.WATCH).toString())); }
            catch (Exception error) { call.reject("Watch connection unavailable: " + error.getMessage()); }
        });
    }
    @PluginMethod public void ping(PluginCall call) {
        getBridge().execute(() -> {
            try { call.resolve(new JSObject().put("id", LinkClient.ping(getContext(), LinkProtocol.WATCH))); }
            catch (Exception error) { call.reject("Watch test failed: " + error.getMessage()); }
        });
    }
}
