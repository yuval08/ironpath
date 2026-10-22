# wear-link API notes (WP1)

Additions to, and precise readings of, `plan/galaxy-watch-sync-v2-design.md` §6.1.2 / §6.4.
Every signature in the design is kept exactly. This file lists only what the design leaves open.

## Build
- Gradle needs JDK 21: `JAVA_HOME=/mnt/stuff/yuval/.jdks/jdk-21.0.11+10`. The system default (JDK 25)
  fails with "Unsupported class file major version 69".

## For WP3 (watch)

### Calling the store
- **`logSet` / `updateSet` arguments.** They accept either the full editor `base`/`draft` or sparse maps.
  - The store sends only the fields whose new value differs from what the user saw.
  - If `expected` lacks a key, the projected value counts as "seen".
  - It throws `SyncError("stale")` only when a sent field's seen value differs from the projection.
  - `completed` in `changes` is ignored: `logSet` always sends `completed: true`, and `updateSet` never sends it.
- **Editor helpers** (additions). You can use them instead of passing raw maps:
  - `EditorRebase.open(actual)` and `EditorRebase.edit(editor, field, value)`.
  - `EditorRebase.expected(editor, complete)` and `EditorRebase.changes(editor, complete)`.

### `SyncError.code` values
- All codes in the design are used.
- Two codes are added: `invalid` (bad arguments, or nothing to update) and `noUndo`.
- `updateSet` and `resolveConflict` in legacy mode throw `legacy`.

### Undo
- `undoLast()` refuses locally with `stale` when the phone changed the set after the original action.
- **Deviation:** the design would send the undo and let the phone create a review. Refusing locally avoids
  creating that review noise.

### Rest
- **Full rest queue.** `logSet` never fails because of the rest-op queue. When 50 rest ops are pending, the
  rest still runs locally and `sync.queueFull` is recorded. `editRest` and `skipRest` throw `queueFull` instead.
- **After `RestRuntime.arm()`.** Call `reportArmed(timerId, localRev, armed, reason, exact)`, then
  `WorkClient.flush`.
  - `reason` should be one of the wire values: ok | notificationsOff | channelOff | exactDenied | serviceFailed.
  - The store substitutes `pendingOps` while local rest ops are unconfirmed.
  - It sends nothing until the phone has assigned the timer a revision. The next `restState` triggers
    `RestEffects.apply` again, so `arm()` then reports again.
- **`RestEffects.apply(context, view)` on the watch.** `view` is `inspect().rest`, which may be null.
  - It is called after any `restState`.
  - It is also called after work packets that changed the stored rest (a session switch or a `closed` control).
  - It is safe to ignore `view` and re-arm from `inspect()`.

### `inspect()` view
- `inspect()` keeps every v1 key, because the phone bridge uses the same method. The §6.3 keys are added on top.
- `rest` is the §6.3 view and also carries `id`, `active` and `vibrate`.
- `rest.alert.reason` is `"pending"` until `reportArmed` has been called for the current `(id, localRev)`.
- **Destination on the watch:**
  - `watch` when armed and the phone has confirmed this revision (or the phone backup is suppressed or off, or
    the phone is unreachable);
  - `both` when armed but not yet confirmed;
  - `phone` or `none` when not armed (`none` if the phone backup is off).
- `closed.reason` maps the control reasons: `finish` → `completed`, `switch` → `replaced`.
- **Legacy pair key.** For a phone that sends no hello (1.0.5), `peer.updatePairKey` is `"<watchVersion>|legacy"`,
  because a v1 snapshot carries no phone version.
- `workout.steps[i].pending` is true while an unconfirmed local action targets that set.
- `WorkStore.rest()` still returns the raw stored timer record.

## For WP2 (phone TS)

### WatchLink
- **`inspectWorkout()`:**
  - `inbox` contains v1 `command` rows and v2 `mutation` rows, in arrival order. Sort by sequence yourself.
  - `pending` contains the watch's v1 and v2 actions.
  - `watchStatus` is the last watch `status` body plus `receivedAtWall`, or null.
  - `compat` is the same object that `compat()` returns.
- **`completeWorkoutCommand`** takes a v1 result for a command, or a v2 result for a mutation. The result's
  envelope version decides which.
- **`flushWorkout`** also sends a hello when the last one is older than 60 s.
- **Diagnostics:** `diagnostics()` returns events newest first. `recordDiagnostic` rejects types that do not
  start with `js.` or are longer than 40 characters.

### Freeze, unfreeze and closed
- The watch remembers released freeze ids (the last 8). A delayed `freeze`, or a snapshot `freeze`, carrying a
  released id is ignored: the ack is `stale`, or the snapshot's freeze is dropped.
- Please still send `controlRevision + 1` with `unfreeze` and `closed`. A freeze older than the highest control
  revision is refused with `stale`.

### Control ACKs
- Every v2 control ACK carries `freezeId`, which is null for `closed`.
- A received `freeze` ACK also carries `deviceId` and `sequence` (the checkpoint).
- The bridge exposes the ACK as `inspectWorkout().controlConfirmation.body`.

### Snapshot ACK codes on the watch
| Code | Meaning |
| --- | --- |
| `closed` | The session is in the watch's closed list. |
| `stale` | Older revision or control revision, or legacy control. |
| `pending` | A switch while the watch has unimported actions. This is `inspectWorkout().confirmation.body.code`. |

### RestCoordinator
- `start` trims `next.title` to 120 characters and `next.text` to 200.
- `restChanged` is emitted, retained, from every effects apply. That covers each commit, `claimBackup`,
  `configure` and app start.
- A running timer whose time is up reads as `state: "ended"` with `remainingMs: 0`.
- **Adding time at zero restarts the rest.** A positive `adjust` on the current timer after it ran out (state
  running with 0 left, or ended) restarts it with exactly that many seconds, as a new revision with the backup
  scheduled. The same rule applies to a watch `editRest(+15)`. A negative adjust at zero, or any adjust on a
  skipped, cancelled or replaced rest, is `stale`.
- **Natural expiry is not a revision.** No `restState` is sent at the deadline, so the wrist alert is never
  cancelled by the phone's own expiry.
- Errors reject with the `SyncError` code as the Capacitor error code. For example, `stale` means the timer
  already ended, and `closed` means a start for a closed session.
- `restAlertTapped` is retained, so it also reaches JS after a cold start from the alert.

### Notification ids
- The backup alert is posted natively with id 71001 on channel `ironpath-rest`.
- `cancelNativeRestAlert()` (LocalNotifications) also removes it if it has been delivered. That is fine for the
  one-time migration.

## Review fix round
- **Review fields** (snapshot `reviews[].fields` and result v2 `fields`) are strict
  `{field, phone, requested, conflict: boolean}`.
  - They list EVERY field of the op's changes, and `conflict` marks the ones that actually conflicted.
  - A watch resolve with `keep:'watch'` re-sends all fields, so a conflicting complete keeps `completed:true`.
  - `inspect().conflicts[].fields[]` now also carries `conflict`.
- **`closeSession`.** `RestCoordinator.closeSession(ctx, id, finished)`; the plugin takes
  `closeSession({sessionId, finished?})`, default true.
  - `reason: 'switch'` (alias `finished:false`) only cancels the running rest; reasons finish | removed | restored, or no reason, also block the session.
  - Publishing a snapshot for a session lifts its block.
- **`RestCoordinator.applyEffects(ctx)`** applies effects under the coordinator lock, from the state as stored at
  that moment. All entry points use it.
- **Watch reboot recovery** keeps a shared rest's authoritative `revision`.
- **Watch closed sessions** are keyed by `epoch|sessionId`, so a restored session (new epoch) can be sent again.

## Storage and compat
- **One shared database.** `WorkStore` is now an `AutoCloseable` facade over one process-wide database per
  file.
  - `close()` releases only the handle; the database stays open.
  - The listener, the plugins and the watch UI share a single connection, so transactions are serialized.
  - `WorkStore(ctx).use { }` is unchanged.
- **Cached compat.** `inspectWorkout().compat` reads a cache and never touches the network.
  - The cache is refreshed in the background when it is older than 60 s.
  - It is refreshed immediately on a hello or a capability change (listener), and by explicit `compat()`.
- **`perm.snapshot`** is recorded at app start, on resume and on `configure()`, but only when the snapshot
  changed (`Diagnostics.recordIfChanged`).

## Wire details beyond the design (native only, invisible to TS)
- **Rest ACKs.** `restOp`, `restState` and `restArmed` are acknowledged on `/ironpath/rest/v2` with
  `ack{type, state, code, reason}`.
  - A watch `restOp` is marked `received` on its ACK and deleted only when a `restState` watermark covers it.
- **`restArmed` never bumps the coordinator revision.** If it did, the backup would be re-armed in a loop.
  - The watch applies `restState` watermarks on every packet.
  - It applies the timer only when the revision is newer.
- **Fresh-measurement anchors** live in `packets.meta`:
  - `restOp`: `{createdElapsed, createdWall, boot}` on the watch outbox; `{recvElapsed, recvBoot, ageMs, uncertain}`
    on the phone inbox;
  - `restState`: `{startElapsed, endsElapsed, boot, running}`.

## Additional public API
| Class | Additions |
| --- | --- |
| `Clock` | `boot(Context)` |
| `RestCoordinator` | `recover(Context)` (boot / process start) |
| `WorkClient` | `isWatch`, `send(ctx, peer, packet)`, `helloIfStale`, `requestDiagnostics`, `compat` |
| `WorkStore` | `hello(...)`, `peerHello`, `watchStatus`, `phoneShared`, `state` / `putState`, `outgoing(Clock)` |
| `Diagnostics` | `TYPES`, `device`, `lastSeq`, `chunk`, `importEvents`, a `record` overload |
| `NextUp` | `label(step)` |
| `RestRules` | `Result` |
| `RestEffects` | `NONE` |
