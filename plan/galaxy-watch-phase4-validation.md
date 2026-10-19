# Phase-four defect analysis

The first two findings describe the preceding phase-three implementation. The
final finding was caught during phase-four implementation. All fixes are in
phone 1.0.5 / watch 0.4.0. The user confirmed the basic return-to-phone sync/control
flow works. Broader physical qualification is still pending.

**Title:** Finishing can exclude sets still saved only on the watch

**Severity:** High

**Location:** `src/screens/WorkoutScreen.tsx`, workout finish / watch transport

**Failure Scenario:** The watch saves a set while disconnected or while the phone
WebView is suspended. The phone completes the workout before importing that set.
A later arrival is correctly rejected because the workout is already closed, but
its set is absent from completed history without a finish-time warning.

**Why It Happens:** Canonical completion did not pause wrist input or establish
which watch sequence numbers still needed importing. A native receipt or an empty
phone inbox cannot establish that the watch has no additional work.

**Reproduction Steps:** Send a workout; disconnect the watch; log a set on the
watch; complete on the phone; reconnect. The later set receives a closed-workout
rejection. The regression test additionally delivers the pause ACK before the
corresponding command, verifying that this ordering cannot permit a clean finish.

**Impact:** Completed workout history omits performed sets, affecting volume and
progression calculations.

**Suggested Fix:** Implemented a durable pause/checkpoint barrier, canonical import
through that checkpoint, latest-session read, review gate, and explicit offline
finish warning. Regression coverage: `src/watch/transport.test.ts` and native
`WorkStoreTest`.

**Title:** Pre-restore rejection loses recoverable requested values

**Severity:** High

**Location:** `src/watch/sessionSync.ts`, epoch rejection; native watch result handling

**Failure Scenario:** A set is saved offline, then the phone restores a backup.
The action arrives with the old epoch and is rejected. The watch saves the final
result and removes its outgoing command; the requested values can no longer be
reviewed on the phone.

**Why It Happens:** The epoch mismatch branch returned before recording the
command/recovery ledger. The final rejection packet contains identity and reason,
not the original requested values.

**Reproduction Steps:** Queue an unsent watch set, restore a phone backup (rotating
the epoch), reconnect and process the rejection. The phase-three phone creates no
recovery record for that request. A new regression performs the epoch rotation,
checks retained requested values, and verifies duplicate retries do not reopen an
already reviewed recovery action.

**Impact:** Actual measurements from the incompatible timeline become unavailable
for manual recovery after final acknowledgement.

**Suggested Fix:** Implemented a separate durable pre-restore recovery record
before final rejection, preserving earlier replay evidence and original requested
values. Phone review works even when the original session is closed or removed.

**Title:** Cached handoff acknowledgement can overwrite a newly closed selection

**Severity:** Medium

**Location:** `src/watch/transport.ts`, closure reconciliation

**Failure Scenario:** A workout closes while its original snapshot receipt remains
in native storage. The same reconciliation pass writes `owner=closed`, then uses
its stale local selection to process the receipt and writes `owner=watch` again.
The next workout can be blocked by the stale ownership record.

**Why It Happens:** The closure write did not update the local selection used by
the remaining receipt-handling branch. This was found during phase-four review.

**Reproduction Steps:** Return both a published snapshot and its original receipt
from native inspection, mark its session completed, and reconcile twice. The
regression initially failed with `owner=watch` where `closed` was expected.

**Impact:** Users can be prevented from handing the next workout to the watch.

**Suggested Fix:** Implemented the closed state transition in the local selection
before processing remaining acknowledgement logic. Regression is part of the
closure transport test.

# Qualification limits

Automated tests cover SQLite persistence, duplicate/late packets, checkpoint
ordering, wrong peers, paused-rest cancellation/transfer, canonical rejection,
review persistence, and stale screen state at completion. They do not establish
actual wrist vibration, Bluetooth reconnection behavior with both apps asleep,
forced-Doze precision, or gym-session battery usage. Those remain device gates.
