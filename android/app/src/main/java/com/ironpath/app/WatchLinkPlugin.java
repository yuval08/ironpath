package com.ironpath.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.ironpath.wearlink.LinkClient;
import com.ironpath.wearlink.LinkProtocol;
import com.ironpath.wearlink.WorkClient;
import com.ironpath.wearlink.WorkStore;
import com.ironpath.wearlink.WorkProtocol;

@CapacitorPlugin(name = "WatchLink")
public final class WatchLinkPlugin extends Plugin {
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
                JSObject packet = call.getObject("packet");
                if (packet == null) throw new IllegalArgumentException("Missing control packet");
                store.control(WorkProtocol.decode(packet.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                WorkClient.flush(getContext()); call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void inspectWorkout(PluginCall call) {
        getBridge().execute(() -> {
            try (WorkStore store = new WorkStore(getContext())) {
                call.resolve(new JSObject(store.inspect().toString()));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void flushWorkout(PluginCall call) {
        getBridge().execute(() -> {
            try { WorkClient.flush(getContext()); call.resolve(); }
            catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void completeWorkoutCommand(PluginCall call) {
        getBridge().execute(() -> {
            try (WorkStore store = new WorkStore(getContext())) {
                String peer = call.getString("peer");
                JSObject packet = call.getObject("packet");
                if (peer == null || packet == null) throw new IllegalArgumentException("Missing command result");
                store.complete(peer, WorkProtocol.decode(packet.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                WorkClient.flush(getContext());
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage()); }
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
