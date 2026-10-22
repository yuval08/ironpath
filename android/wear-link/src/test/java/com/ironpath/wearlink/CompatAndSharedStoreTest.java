package com.ironpath.wearlink;

import static org.junit.Assert.*;
import android.content.Context;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 30, manifest = Config.NONE)
public class CompatAndSharedStoreTest {
    private Context context;
    private WorkStore phone;

    @Before public void setUp() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("phone-compat.db");
        phone = new WorkStore(context, "phone-compat.db");
    }
    private static Map<String, String> nodes(String... ids) {
        Map<String, String> map = new LinkedHashMap<>();
        for (String id : ids) map.put(id, "Galaxy Watch");
        return map;
    }

    @Test public void compatReasonsFollowReachabilityAndHello() throws Exception {
        assertEquals("noWatch", WorkClient.compatFrom(phone, nodes(), Collections.emptySet()).getString("reason"));
        assertEquals("multipleWatches", WorkClient.compatFrom(phone, nodes("a", "b"), Collections.emptySet()).getString("reason"));
        assertEquals("watchUpdateRequired", WorkClient.compatFrom(phone, nodes("a"), Collections.emptySet()).getString("reason"));
        assertEquals("helloPending", WorkClient.compatFrom(phone, nodes("a"), new HashSet<>(Collections.singleton("a"))).getString("reason"));
        phone.receive("a", V2.hello("watch", V2.uuid(), true), false);
        JSONObject ok = WorkClient.compatFrom(phone, nodes("a"), Collections.emptySet());
        assertEquals("ok", ok.getString("reason"));
        assertTrue(ok.getBoolean("sharedMode"));
        assertEquals("0.5.0", ok.getJSONObject("peer").getString("versionName"));
    }

    @Test public void pollingReadsTheCacheUntilItIsStaleOrAHelloArrives() throws Exception {
        JSONObject cold = WorkClient.cachedCompat(phone, 1_000);
        assertTrue("no cache yet: provisional and stale", cold.getBoolean("stale"));
        WorkClient.refreshCompat(phone, nodes("a"), Collections.emptySet(), 1_000);
        JSONObject fresh = WorkClient.cachedCompat(phone, 1_000 + WorkClient.COMPAT_TTL_MS);
        assertFalse(fresh.getBoolean("stale"));
        assertEquals("watchUpdateRequired", fresh.getJSONObject("compat").getString("reason"));
        assertTrue(WorkClient.cachedCompat(phone, 2_000 + WorkClient.COMPAT_TTL_MS).getBoolean("stale"));
        phone.receive("a", V2.hello("watch", V2.uuid(), true), false); // invalidates
        assertTrue(WorkClient.cachedCompat(phone, 1_500).getBoolean("stale"));
    }

    @Test public void handlesShareOneDatabaseAndCloseDoesNotCloseIt() throws Exception {
        WorkStore other = new WorkStore(context, "phone-compat.db");
        other.close();
        assertSame(phone.getWritableDatabase(), other.getWritableDatabase());
        assertTrue(phone.getWritableDatabase().isOpen());
        phone.putState("k", "v");
        assertEquals("v", other.state("k"));
    }

    @Test public void concurrentWritersFromTwoHandlesNeverRace() throws Exception {
        int threads = 4, each = 50;
        CountDownLatch done = new CountDownLatch(threads);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        for (int t = 0; t < threads; t++) {
            new Thread(() -> {
                try (WorkStore store = new WorkStore(context, "phone-compat.db")) {
                    for (int i = 0; i < each; i++) store.write(db -> {
                        String value = store.value(db, "counter");
                        WorkStore.set(db, "counter", Integer.toString(value == null ? 1 : Integer.parseInt(value) + 1));
                        return null;
                    });
                } catch (Throwable error) { failure.set(error); }
                finally { done.countDown(); }
            }).start();
        }
        done.await();
        assertNull(failure.get());
        assertEquals(Integer.toString(threads * each), phone.state("counter"));
    }
}
