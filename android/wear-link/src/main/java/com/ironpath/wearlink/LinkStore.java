package com.ironpath.wearlink;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded diagnostic receipts, independent of the Activity/WebView lifecycle. */
public final class LinkStore extends SQLiteOpenHelper {
    public LinkStore(Context context) { super(context, "wear-link-diagnostics.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE receipts (seq INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "peer TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL, "
            + "UNIQUE(peer,id,type))");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Missing database migration");
    }
    public void record(String peer, LinkProtocol message) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put("peer", peer); values.put("id", message.id);
            values.put("type", message.type); values.put("at", System.currentTimeMillis());
            db.insertWithOnConflict("receipts", null, values, SQLiteDatabase.CONFLICT_IGNORE);
            db.execSQL("DELETE FROM receipts WHERE seq NOT IN (SELECT seq FROM receipts ORDER BY seq DESC LIMIT 50)");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public JSONArray recent() throws Exception {
        JSONArray result = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT peer,id,type,at FROM receipts ORDER BY seq DESC LIMIT 50", null)) {
            while (cursor.moveToNext()) result.put(new JSONObject()
                .put("peer", cursor.getString(0)).put("id", cursor.getString(1))
                .put("type", cursor.getString(2)).put("receivedAt", cursor.getLong(3)));
        }
        return result;
    }
}
