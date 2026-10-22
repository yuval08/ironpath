# Ironpath Galaxy Watch companion specification

Status: Shared-mode pair (phone 1.0.6 / watch 0.5.0, protocol v2) implemented and verified on emulators; final physical-device smoke workout pending. See [phase tracker](galaxy-watch-phases.md), [user guide](galaxy-watch-user-guide.md) and [sync v2 design](galaxy-watch-sync-v2-design.md).
Date: 2026-10-19 (updated 2026-10-22)
Target device: Samsung Galaxy Watch7, paired with the existing Android phone app
Distribution: Direct APK installation only; no app store dependency

## Goal

Let the user follow and log an active workout from their wrist while their phone
stays locked in a pocket or gym bag. Show the current exercise, next set, prescribed
targets, and rest countdown. Preserve work during brief disconnections and phone
WebView suspension.

The first release requires starting and finishing the workout on the phone. It
does not promise a full workout started independently with the phone left at home.

## Original application baseline and constraints

- The phone app is React/TypeScript packaged through Capacitor. Its Android
  application ID is `com.ironpath.app`.
- Workout records live in Dexie/IndexedDB (`src/db/db.ts` and
  `src/db/repository.ts`). Android native code cannot directly read that database.
- `src/screens/WorkoutScreen.tsx` currently edits and saves complete session
  documents. Introducing another writer without changing that path risks lost
  updates when a phone edit overwrites a watch edit.
- Rest state currently uses JavaScript deadlines in `src/hooks/useTimers.ts`,
  coordinated by `src/state/WorkoutAlertsProvider.tsx`. Android native local
  notifications exist, but an onscreen countdown does not survive a full reload.
- The existing `android:apk` script produces a debug APK. Before installation,
  identify and retain the certificate used by the user's installed phone APK.
- A usable watch companion needs its own native interface and APK; the phone
  interface is not suitable for the round watch screen.

## Delivered version and remaining acceptance

Phone **1.0.6 (code 7)** and watch **0.5.0 (code 5)** are the current compatible
pair (commits `94164b4` and `efcf001`, artifacts in `artifacts/watch-phase6/`). They speak sync
protocol v2 and still accept v1. Both screens stay usable during the same
workout: the routine **Take control on phone** handoff is gone, and **Send
workout to watch** remains only for choosing which workout the watch shows.

The pair passed the automated suite, native tests, lint and signing checks, and
was exercised on emulators. The final smoke workout on the physical Galaxy Watch7
and phone (both screens, reconnect, finish, several screen-off rests) is still
pending, so the physical acceptance matrix below is not yet established.
Extended battery/Doze monitoring is a post-release operational follow-up.

The previous pair, phone **1.0.5 (code 6)** and watch **0.4.0 (code 4)**, was the
first working sideloaded version. The user confirmed its installation, real
workout handoff, and returning to phone control/sync before finishing.

The scope below records the original target specification; where it describes
exclusive control ownership, shared mode (next section) now replaces it. Watch
progress shows completed/total working sets, elapsed time and sync state.
Conflicting values are never silently overwritten: they go to an explicit review
on either device. Independent workout start/finish on the watch and a full
workout without the paired phone remain outside this version.

## Protocol v2 and shared mode

Full contract: [sync v2 design](galaxy-watch-sync-v2-design.md). Implementation
notes beyond that design: `android/wear-link/API_NOTES.md`.

- **Capability negotiation.** Both apps exchange a `hello` with their versions and
  supported protocols. Shared mode starts only when both sides support v2. Mixed
  versions keep the old compatible (v1) workflow, including its control handoff,
  and both screens show **Update needed**. Existing v1 queues keep draining without
  resetting device identity or sequence history.
- **Shared mode replaces control ownership.** Phone and watch edit the same active
  session at once. Every edit is a mutation carrying the touched fields' expected
  values and the new values. The phone applies watch mutations and its own edits
  with the same per-field three-way merge: untouched or different fields merge,
  identical repeats are no-ops, and the same field changed differently on both
  sides becomes a **review**. Open editors rebase untouched fields when an update
  arrives.
- **Reviews.** A review lists every field of the change, marks which ones
  conflict, and shows the phone value next to the requested value. It can be
  resolved on either device. Applying the other value is a new conditional
  mutation, so newer work is never silently overwritten. A set with an open review
  is locked; other sets stay usable.
- **Sync states.** Synced, Saved on watch (queued, not yet received by the phone),
  Waiting for phone (received natively, not yet committed to history), Needs
  review, and Update needed.
- **Finish barrier.** Finishing on the phone freezes mutations on both devices,
  imports through the watch's acknowledged sequence checkpoint, requires open
  reviews to be resolved, then completes once. Cancel or failure unfreezes.
  Switching the watch to another workout runs the same freeze and drain. Closed or
  restored sessions cannot be revived by delayed packets.
- **Shared rest timer.** A native phone rest coordinator (wear-link
  `RestCoordinator`, with `PhoneRestAlerts` for Android effects) owns one timer
  with an id and revision on a separate rest stream, so it works while the phone
  WebView is suspended. Either device can start, −15/+15 or skip it; only durations
  cross devices, never raw clock values. The wrist alert is preferred; the phone
  keeps a backup alert until the watch confirms it armed the current revision. A
  duplicate alert is possible during an uncertain disconnect and is accepted.
- **Diagnostics.** Each device keeps its latest 500 events for up to 14 days,
  separate from pending work. The phone pulls watch events on reconnect and offers
  view and export in Settings. Nothing is uploaded.

## Release-one scope

### Workout handoff

1. Start or resume a workout on the phone and complete any required warm-up and
   pre-workout inputs there.
2. Choose **Send workout to watch**. If multiple sessions are in progress, explicitly choose
   one; never infer the session from whichever record was updated last.
3. Transfer the active workout snapshot. Enable watch logging only after the
   watch confirms that the snapshot is saved locally.
4. The phone may now lock. The watch continues with its cached session.
5. Resume the phone app to reconcile pending actions and finish the workout.
   If actions remain only on the watch, show that fact before finishing.

### Watch screens

| Screen | Required content and actions |
| --- | --- |
| Ready | App connection status; start/resume a workout on the phone instruction |
| Current set | Exercise name, working-set position, targets and units, editable actual values, Complete set |
| Rest | Large countdown, next exercise/set preview, +15 seconds, Skip rest |
| Exercise list | Ordered exercises, completion state, explicit selection |
| Session progress | Completed/total working sets, elapsed workout time, pending sync count |
| Recovery | Cached workout, disconnected/pending/conflict status, retry or open-phone instruction |

- Show targets separately from actual logged values. Do not silently turn a
  recommended load, rep range, or timed target into a measured result.
- Provide compact editing for actual reps and weight, including left/right reps
  when required. Preserve existing values and units; zero and missing differ.
- Support rep-based sets and rest timers first. Other entry styles must display
  their correct targets and use an explicit **Log on phone** state until their
  actual-value editor is implemented. Never coerce time, distance, steps, or
  treadmill fields into reps. Unsupported input must not block viewing or rest.
- Mirror bodyweight, band, load, and per-side labels from the phone snapshot.
- Completing a set advances to the next eligible set. Apply existing superset
  ordering and rest rules, including zero rest and ramp sets. Do not start rest
  after every superset slot or count ramp sets as working volume.
- Allow undo of the most recent watch completion through a new durable command;
  it must not merely erase a previously transmitted event. Cancel its associated
  rest only if that rest is still current.
- Use large touch targets, readable text, and a dark layout that fits Watch7's
  round screen. Routine logging must not require a keyboard or phone unlock.

### Timer behavior

- Run countdowns on the watch, without per-second phone messages.
- Persist timer ID, revision, duration, originating action, and deadline before
  showing a started timer. Use monotonic time while running to resist wall-clock
  changes; retain an explicit recovery policy for process death and reboot.
- Start rest only after the completion action is saved locally. If local storage
  fails, report failure and do not claim the set was saved.
- +15 seconds updates the current timer; Skip rest cancels it. Old callbacks and
  retries cannot cancel or vibrate for a newer timer.
- Vibrate once when rest ends, subject to device settings. Request required
  permissions through explicit setup actions and explain unavailable alerts.
- Use a native, OS-supported scheduling/lifecycle approach for screen-off alerts.
  Validate repeated short intervals on Watch7; do not assume an Activity coroutine
  or unrestricted exact alarms will keep working in ambient mode or Doze.
- On same-boot process recovery, restore the running countdown. After reboot,
  reconstruct from persisted wall-clock information, show expired rest as ended,
  and never replay historical vibrations. If timing is uncertain, disclose it.
- While watch control is active, suppress duplicate phone rest alerts. On return
  to phone control, explicitly transfer the current timer and cancel the old
  owner's alert. Connectivity changes alone do not change timer ownership.
  *Superseded in shared mode:* one shared timer, wrist alert preferred, phone
  backup until the watch confirms it is armed (see Protocol v2 and shared mode).

## Architecture

### Watch application

- Add an Android Wear OS module (proposed path `android/wear`) using Kotlin and
  Compose for Wear OS.
- Use the same application ID and signing certificate as the phone app for Data
  Layer communication. Declare the watch hardware feature and companion status.
- Persist the snapshot, local projection, command outbox, timer, and sync status
  in native storage. Data Layer transport is not the only copy of user actions.
- Support one selected session and one controlling watch in release one.

### Phone integration

- Add a native Capacitor bridge and Wearable listener backed by a durable inbox.
  The listener must work without the React screen executing and must not rely on
  starting an Activity silently from the background.
- Native receipt saves commands and acknowledges **received**, not **committed**.
  A received command is not yet part of workout history in IndexedDB.
- On app startup/resume, reconcile the inbox before enabling edits to the selected
  session. Commit through the shared session mutation layer and publish results
  back to the watch.
- Route phone edits and watch imports through transactional, field-level session
  mutations that read the latest record. Replace stale whole-document writes for
  the affected session paths, including periodic elapsed-time saves.
- IndexedDB remains the canonical workout history. The watch maintains a durable
  provisional projection while the WebView sleeps. No native shadow database may
  silently replace or independently overwrite that history.
- Browser/PWA use remains supported without Wear OS dependencies.

### Transport and protocol

Use Wear OS Data Layer over the paired devices' supported connection. It requires
Google Play services, but neither a backend nor Play Store publication of our apps.

Define a versioned protocol with these payloads:

| Payload | Required fields |
| --- | --- |
| Snapshot | Protocol version, data epoch, session ID, revision, status, ordered prescriptions/results, stable set identity, units, display targets, execution order, timer ownership |
| Command | Protocol version, data epoch, command UUID, device ID, sequence, session ID, base revision, action type, stable target identity, validated field changes, diagnostic timestamp |
| Result | Command UUID, received/committed/rejected/conflict state, resulting revision or reason |
| Timer update | Session ID, owner, timer ID/revision, originating command, remaining duration and timing reference |

- Assign stable set identity before handoff; mutable array indices alone are not
  sufficient. Do not couple watch cursors to display order.
- Use DataItems for replaceable snapshots/status. Use messages for low-latency
  notifications with a persisted outbox and explicit retries/acknowledgements.
- Never assume delivery ordering or exactly-once delivery. Apply each command at
  most once using its UUID; a retry with the same UUID and different content is
  rejected. Preserve per-device sequence across reconnects and restarts.
- Commit the mutation and applied-command ledger in one IndexedDB transaction.
  A crash after commit but before acknowledgement must not duplicate the action.
- Retain uncommitted watch commands until a final result is durably saved. Bound
  message size, batch size, and queue capacity. On capacity or storage exhaustion,
  disable new logging with a visible error; never silently discard pending work.
- Validate schemas, enums, ranges, units, peer capability, and supported protocol
  versions on both ends. Unknown versions get an actionable update message.
- Prevent replay after restore/reset using a new data epoch; require a fresh
  handoff and preserve incompatible pending actions for user recovery.

## Concurrency and recovery rules

- While watch control is active, the phone workout screen displays that status
  and offers **Take control on phone**. Reconcile first when reachable. If the
  watch is unreachable, warn that its cached session may still accept actions;
  reconcile those explicitly later rather than promising an exclusive lock.
  A reachable transfer durably pauses watch mutations, records its sequence
  checkpoint, and imports through that checkpoint before reporting success.
  Rest pauses during transfer; the phone offers an explicit resume of its saved
  remainder after the old wrist alert has been cancelled.
  *This applies only to the legacy v1 workflow (mixed versions). Shared mode has
  no ownership transfer; see Protocol v2 and shared mode.*
- A global revision mismatch alone does not discard a command. Apply it if its
  targeted fields and preconditions are unchanged. Conflicting changes to the
  same set require review on the phone; no last-writer-wins timestamp policy.
- A completion command contains explicit actual fields, not a request to complete
  whichever set is current when the message arrives. Rapid double taps cannot
  accidentally complete two consecutive sets.
- Closed/deleted sessions reject further changes. Keep rejected local work visible
  for review; never resurrect a finished workout or advance the plan twice.
- Reconnect sends pending commands and obtains a fresh snapshot. Rebuild the watch
  projection from canonical state plus remaining pending commands without jumping
  the visible cursor unexpectedly or restarting an expired rest.
- Finishing on the phone must not silently exclude pending work. Normal finish
  waits for reconciliation; an explicit finish with an unreachable watch reports
  that later commands will require recovery instead of automatic application.
- Never erase pending commands during logout/reset, backup restore, or a session
  switch without an explicit recovery/discard decision.

## APK delivery and installation

- Produce two independently installable artifacts: `ironpath-phone.apk` and
  `ironpath-watch.apk`, with documented compatible protocol versions.
- Add repeatable build commands and installation documentation. Keep signing
  secrets outside Git and distribute neither private keys nor passwords.
- Preserve the existing phone signing certificate for in-place updates. Inspect
  the installed/build certificate before choosing release signing; switching from
  the existing debug certificate to another certificate prevents a normal update.
  Do not require an uninstall that loses local workout history.
- Use increasing version codes per device artifact and the same signing identity
  across the phone/watch pair. Verify both APK signatures before delivery.
- Provide checksums and record source revision, build variant, and version.

Watch7 installation from a computer:

1. Download Android SDK Platform Tools. Connect computer and watch to the same
   Wi-Fi network.
2. On the watch, open Settings → About watch → Software information and tap
   Software version five times. Enable ADB debugging and Wireless debugging in
   Developer options. Menu wording can vary by One UI version.
3. Select Pair new device. Run `adb pair WATCH_IP:PAIRING_PORT` and enter its code.
4. Return to the main Wireless debugging screen. Use its connection port, which
   differs from the pairing port: `adb connect WATCH_IP:CONNECTION_PORT`.
5. Run `adb -s WATCH_IP:CONNECTION_PORT install -r ironpath-watch.apk`.
6. Launch Ironpath from the watch app list. Install the corresponding phone APK
   through the user's existing direct-install process and complete handoff.
7. Disable debugging after installation. Runtime synchronization does not use ADB.

Use `./adb` on macOS/Linux or `.\adb` in Windows PowerShell when running from the
extracted Platform Tools folder. Updates reuse the install command after reconnecting;
IP addresses and ports can change. No root, app store, or Android Studio is required.

## Acceptance and failure testing

Release requires physical Watch7 testing with the paired phone, in addition to
focused protocol/storage tests and emulator UI checks.

1. Install both APKs directly and update them in place without losing phone data.
2. Start a representative workout, hand it off, lock the phone, and complete at
   least ten working sets with correct targets, superset transitions, and rests.
3. Verify local countdown and a single wrist alert with the watch screen off and
   ambient mode enabled across repeated short rests. Record permission, DND,
   battery-saving, and OS restrictions observed on the actual device.
4. Disconnect Bluetooth/Wi-Fi mid-rest, complete multiple cached sets, reconnect,
   and resume the phone. Every action appears once with the correct values.
5. Suspend/kill the phone WebView. Native receipt persists commands without claiming
   history was committed; reopening imports them before accepting further edits.
6. Kill the watch process after a completion and restart it. Recover the pending
   action and timer. Test reboot recovery separately without replaying old alerts.
7. Inject duplicates, dropped acknowledgements, out-of-order delivery, and a crash
   between database commit and acknowledgement. Verify no duplicate set or rest.
8. Test rapid double taps, undo, +15, skip, and starting another timer near expiry.
   Old events must not alter the new timer or create duplicate vibrations.
9. Edit the same set on the phone, finish a session while the watch is unreachable,
   switch sessions, and restore a backup. Verify explicit conflicts/recovery and
   no lost phone edits, resurrected sessions, or duplicate plan advancement.
10. Verify kg/lb, bodyweight/bands, per-side inputs, optional and ramp sets, zero
    rest, unsupported entry styles, long names, and both Watch7 display sizes.
11. Reject malformed/oversized payloads and unsupported protocol versions. Simulate
    storage failure and queue exhaustion without reporting unsaved work as saved.
12. Exercise a normal gym-length session; inspect battery usage and confirm there
    is no per-second network traffic, permanent wake lock, or unbounded retry loop.

## Implementation sequence and sizing

1. Confirm signing identity, device versions, and supported entry styles. Spike
   native communication, durable receipt with the phone locked, and screen-off
   timer alerts on the real Watch7 before committing to the final schedule.
2. Extract transactional session commands and shared execution-order fixtures.
   Implement versioned snapshots, durable inbox/outbox, and reconciliation.
3. Build watch screens, input controls, local projection, timer, and recovery UI.
4. Add phone handoff/control status, pending-work review, and alert ownership.
5. Validate failure paths, build the two APKs, and document installation/update.

The earlier 3–5 working-day estimate is a provisional target for an initial
connected version. Reliable background behavior and recovery are the major sizing
risks; revise the estimate after the device spike rather than cutting persistence
or conflict handling to meet it.

## Deferred features

Starting and finishing workouts independently on the watch; a full session with
the phone absent; plan editing; complete editors for every entry style; videos;
pain assessments and notes; heart-rate/Health Connect integration; complications;
tiles; cloud accounts; store publication; automatic installation of watch updates.

## Reference documentation

- [Wear OS Data Layer overview](https://developer.android.com/training/wearables/data/overview)
- [Samsung Galaxy Watch wireless debugging setup](https://developer.samsung.com/health/sensor/guide/connect-watch.html)
- [Android Debug Bridge installation commands](https://developer.android.com/tools/adb)
- [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools)
