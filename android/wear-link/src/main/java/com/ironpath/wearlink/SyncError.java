package com.ironpath.wearlink;

/**
 * A refused sync action with a stable machine code. Codes: noWorkout frozen closed review stale
 * alreadyCompleted unsupported queueFull storage legacy noRest test pending (plus invalid, noUndo).
 */
public final class SyncError extends IllegalStateException {
    public final String code;
    public SyncError(String code, String message) { super(message); this.code = code; }
}
