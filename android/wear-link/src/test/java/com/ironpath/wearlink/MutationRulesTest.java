package com.ironpath.wearlink;

import static org.junit.Assert.*;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Runs every case of the shared TS/Java fixture (design §2.7). */
public class MutationRulesTest {
    static JSONArray cases() throws Exception {
        try (InputStream in = MutationRulesTest.class.getClassLoader().getResourceAsStream("sync-v2/merge-cases.json")) {
            assertNotNull("fixture on the test classpath", in);
            return new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8)).getJSONArray("cases");
        }
    }
    @Test public void everyFixtureCaseMatches() throws Exception {
        JSONArray cases = cases();
        assertTrue(cases.length() >= 7);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            JSONObject merged = MutationRules.merge(c.getJSONObject("current"), c.getJSONObject("expected"), c.getJSONObject("changes"));
            String name = c.getString("name");
            assertEquals(name, c.getString("outcome"), merged.getString("outcome"));
            assertEquals(name, c.getJSONArray("conflicts").toString(), merged.getJSONArray("conflicts").toString());
            assertTrue(name, WatchProjection.equal(c.getJSONObject("result"), merged.getJSONObject("result")));
        }
    }
    @Test public void sameComparesNumbersByValueAndNullOnlyToNull() {
        assertTrue(MutationRules.same(60, 60.0));
        assertFalse(MutationRules.same(0, JSONObject.NULL));
        assertTrue(MutationRules.same(JSONObject.NULL, null));
        assertFalse(MutationRules.same(true, 1));
    }
    private JSONObject body(String op, JSONObject expected, JSONObject changes) throws Exception {
        return new JSONObject().put("op", op).put("expected", expected).put("changes", changes)
            .put("undoOf", JSONObject.NULL).put("resolves", JSONObject.NULL).put("keep", JSONObject.NULL);
    }
    @Test public void shapeRulesMirrorTheDesignTable() throws Exception {
        MutationRules.validateShape(body("complete", new JSONObject("{\"completed\":false,\"reps\":null}"), new JSONObject("{\"completed\":true,\"reps\":8}")));
        MutationRules.validateShape(body("edit", new JSONObject("{\"reps\":8}"), new JSONObject("{\"reps\":9}")));
        MutationRules.validateShape(body("resolve", new JSONObject(), new JSONObject()).put("resolves", V2.uuid()).put("keep", "phone"));
        MutationRules.validateShape(body("undo", new JSONObject("{\"reps\":9}"), new JSONObject("{\"reps\":8}")).put("undoOf", V2.uuid()));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("edit", new JSONObject(), new JSONObject())));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("edit", new JSONObject("{\"completed\":false}"), new JSONObject("{\"completed\":true}"))));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("edit", new JSONObject("{\"rpe\":1}"), new JSONObject("{\"reps\":9}"))));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("complete", new JSONObject("{\"reps\":null}"), new JSONObject("{\"reps\":8}"))));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("undo", new JSONObject("{\"reps\":9}"), new JSONObject("{\"reps\":8}"))));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("resolve", new JSONObject("{\"reps\":9}"), new JSONObject("{\"reps\":8}")).put("resolves", V2.uuid()).put("keep", "phone")));
        assertThrows(Exception.class, () -> MutationRules.validateShape(body("resolve", new JSONObject(), new JSONObject()).put("resolves", V2.uuid()).put("keep", "watch")));
    }
    @Test public void undoIsTheInverseOfTheOriginal() throws Exception {
        JSONObject inverse = MutationRules.undoOf(body("complete", new JSONObject("{\"completed\":false,\"reps\":null}"), new JSONObject("{\"completed\":true,\"reps\":8}")));
        assertEquals(8, inverse.getJSONObject("expected").getInt("reps"));
        assertTrue(inverse.getJSONObject("changes").isNull("reps"));
    }
}
