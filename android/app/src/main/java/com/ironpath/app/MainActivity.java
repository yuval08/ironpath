package com.ironpath.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WatchLinkPlugin.class);
        registerPlugin(RestLivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
