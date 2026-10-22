package com.ironpath.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ironpath.wearlink.RestCoordinator;
import com.ironpath.wearlink.SyncError;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

/** JS bridge for the native rest coordinator (design §6.4). Every method resolves to a RestView. */
@CapacitorPlugin(name = "RestCoordinator")
public final class RestCoordinatorPlugin extends Plugin {
    private static volatile WeakReference<RestCoordinatorPlugin> live = new WeakReference<>(null);
    private static volatile boolean resumed;

    @Override public void load() {
        live = new WeakReference<>(this);
        if (getActivity() != null) tapped(getActivity().getIntent());
    }
    @Override protected void handleOnNewIntent(Intent intent) { super.handleOnNewIntent(intent); tapped(intent); }
    @Override protected void handleOnResume() {
        super.handleOnResume();
        resumed = true;
        getBridge().execute(() -> IronpathApplication.recordPermissions(getContext()));
    }
    @Override protected void handleOnPause() { super.handleOnPause(); resumed = false; }
    static boolean foreground() { return resumed; }

    /** Retained so a listener added later still receives the latest RestView. */
    static void emit(JSONObject view) {
        RestCoordinatorPlugin plugin = live.get();
        if (plugin == null || view == null) return;
        try { plugin.notifyListeners("restChanged", new JSObject(view.toString()), true); }
        catch (Exception ignored) { /* bridge gone */ }
    }
    private void tapped(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(PhoneRestAlerts.EXTRA_TAPPED, false)) return;
        intent.removeExtra(PhoneRestAlerts.EXTRA_TAPPED);
        notifyListeners("restAlertTapped", new JSObject(), true);
    }

    interface Work { JSONObject run() throws Exception; }
    private void run(PluginCall call, Work work) {
        getBridge().execute(() -> {
            try {
                JSONObject view = work.run();
                call.resolve(new JSObject(view == null ? "{}" : view.toString()));
            } catch (SyncError error) {
                call.reject(error.getMessage(), error.code);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Rest coordinator failed" : error.getMessage(), "storage");
            }
        });
    }
    private static String optionalString(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        return value instanceof String ? (String) value : null;
    }

    @PluginMethod public void getState(PluginCall call) { run(call, () -> RestCoordinator.view(getContext())); }
    @PluginMethod public void start(PluginCall call) {
        run(call, () -> {
            Double seconds = call.getDouble("durationSeconds");
            if (seconds == null || seconds < 1 || seconds > 86400) throw new SyncError("invalid", "durationSeconds must be 1–86400");
            Object next = call.getData().opt("next");
            return RestCoordinator.start(getContext(), optionalString(call, "sessionId"), Math.round(seconds * 1000),
                optionalString(call, "sourceOp"), next instanceof JSONObject ? (JSONObject) next : null);
        });
    }
    @PluginMethod public void adjust(PluginCall call) {
        run(call, () -> {
            String timerId = optionalString(call, "timerId");
            Double seconds = call.getDouble("deltaSeconds");
            if (timerId == null || seconds == null || seconds == 0 || Math.abs(seconds) > 3600) throw new SyncError("invalid", "Invalid rest change");
            return RestCoordinator.adjust(getContext(), timerId, Math.round(seconds * 1000));
        });
    }
    @PluginMethod public void skip(PluginCall call) {
        run(call, () -> {
            String timerId = optionalString(call, "timerId");
            if (timerId == null) throw new SyncError("invalid", "Missing timerId");
            return RestCoordinator.skip(getContext(), timerId);
        });
    }
    @PluginMethod public void closeSession(PluginCall call) {
        // reason 'switch' (or finished:false) only cancels the running rest; any other reason, or none,
        // also blocks later rest starts for that session.
        run(call, () -> {
            String reason = optionalString(call, "reason");
            if (reason != null && !java.util.Arrays.asList("finish", "removed", "restored", "switch").contains(reason))
                throw new SyncError("invalid", "Unknown close reason");
            boolean finished = reason != null ? !reason.equals("switch") : call.getBoolean("finished", true);
            return RestCoordinator.closeSession(getContext(), optionalString(call, "sessionId"), finished);
        });
    }
    @PluginMethod public void configure(PluginCall call) {
        run(call, () -> {
            Boolean notify = call.getBoolean("notify"), vibrate = call.getBoolean("vibrate");
            if (notify == null || vibrate == null) throw new SyncError("invalid", "notify and vibrate are required");
            RestCoordinator.configure(getContext(), notify, vibrate);
            IronpathApplication.recordPermissions(getContext());
            return new JSONObject();
        });
    }
}
