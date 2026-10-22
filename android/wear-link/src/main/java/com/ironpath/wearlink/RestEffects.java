package com.ironpath.wearlink;

import android.content.Context;
import org.json.JSONObject;

/**
 * Android side effects of a committed rest change (alarms, notifications). Implementations must be
 * idempotent: they re-arm from the stored state. Phone passes RestCoordinator.view(); the watch
 * passes inspect().rest (or null).
 */
public interface RestEffects {
    void apply(Context context, JSONObject restView);

    interface Provider { RestEffects restEffects(); }

    RestEffects NONE = (context, view) -> { };

    /** The Application's effects when it implements Provider, otherwise a no-op. */
    static RestEffects of(Context c) {
        Context app = c.getApplicationContext();
        Object owner = app != null ? app : c;
        return owner instanceof Provider ? ((Provider) owner).restEffects() : NONE;
    }
}
