# Finish phone/watch sync from A to Z

Date: 2026-10-22
Status: Implemented; final physical-device smoke workout pending.

> **Delivered** in commits `94164b4` and `efcf001` as phone **1.0.6 (code 7)** and watch **0.5.0 (code 5)**, protocol v2
> (v1 still accepted for mixed versions). Phases B–G are implemented per the
> [Sync v2 design](galaxy-watch-sync-v2-design.md), with the small deviations recorded in
> `android/wear-link/API_NOTES.md`; the APK pair, `SHA256SUMS` and `build.json` are in
> `artifacts/watch-phase6/`. Automated checks pass (568 vitest tests in 39 files, 102 wear-link JUnit tests,
> 33 watch unit tests, typecheck, ESLint, Android lint for app/wear/wear-link, matching signing certificate).
> Behaviour was verified on emulators only. The final smoke workout on the physical Galaxy Watch7 and phone
> (both screens, reconnect, finish, several screen-off rests) is still pending; extended battery/Doze
> monitoring is a post-release operational follow-up. See the [phase tracker](galaxy-watch-phases.md).

## Summary

Deliver a matching APK pair where **both screens remain usable during the same workout**, without routine “Take control” handoffs.

Confirmed decisions:

- Start and finish workouts on the phone.
- Log sets, undo, and control rest from either device.
- Keep watch actions safe while disconnected; commit them to phone history when the phone app reopens.
- Prefer wrist alerts. Retain a phone backup until watch confirmation, accepting a possible duplicate during an uncertain disconnect.
- Include delivery diagnostics in the final product. Extended background-alert monitoring follows release rather than blocking it.

The existing implementation remains the foundation. This work extends phase 4’s synchronization model and closes phase 5’s delivery requirements.

## Implementation phases

### A. Preserve current work and establish the baseline

- Preserve and integrate the existing uncommitted phone countdown, lock-screen notification, and next-exercise changes.
- Run current checks before implementation and record the latest user results accurately: reconnect and undo passed; battery appears acceptable; screen-off alerts have not been properly tested.
- Keep IndexedDB as canonical workout history and native SQLite as durable transport/timer storage. No backend, account, or app store dependency.

**Exit:** a recorded baseline and one agreed shared-workout model.

### B. Make workout editing work from either screen

- Replace exclusive phone/watch ownership with a shared active session. Keep the initial **Send workout to watch** action for choosing the workout, but remove ownership locks during normal logging.
- Route active-workout edits through transactional mutations with stable operation/set IDs and explicit changed fields. Phone and watch use the same acceptance rules.
- Merge independent changes, including different fields on the same set. Conflicting changes to the same field require review; identical repeated changes succeed without duplicating their effects.
- Preserve durable queues, sequence checks, replay protection, backup epochs, and acknowledgement only after canonical commit.
- Refresh both screens automatically. Rebase untouched editor fields when updates arrive while preserving unsaved user input.
- Apply structural guards to substitutions, skipped exercises, and added/deleted sets so stale watch commands cannot target a different exercise or set.

**Exit:** alternating between devices requires no handoff and loses no edits.

### C. Share one rest timer and coordinate its alert

- Introduce a native rest coordinator on the phone that can process timer messages while its WebView is suspended. Workout-history commits still wait for the phone app to reopen.
- Give every rest an identity, revision, originating set operation, deadline, and alert destination. Both screens display that timer; either can extend or skip it.
- Serialize connected timer operations through the native phone coordinator. Watch timers remain locally usable while disconnected and reconcile on reconnect without replaying expired rests.
- Mirror deadlines using fresh monotonic-clock measurements scoped to each device boot. Never compare the devices’ raw uptime values or restart a countdown from its original duration after a delayed message.
- Schedule locally before network work. Keep phone backup delivery until the watch confirms it has armed the alert. Cancellation, undo, replacement, and closure invalidate older timer revisions.
- Integrate the phone’s countdown/next-exercise notification work into this single timer path, avoiding parallel schedulers for the same alert.

**Exit:** both screens show the same connected timer, and skip/extend operations propagate without routine ownership transfers.

### D. Finish the normal workflow and recovery

- Show clear **Synced**, **Saved on watch**, **Waiting for phone**, and **Needs review** states. Do not equate native receipt with committed history.
- Provide conflict review showing current phone values and requested watch values. Applying recovered values creates a new conditional mutation; it never silently overwrites newer work.
- Preserve the finish barrier: briefly freeze new mutations on both devices, import through the watch’s confirmed sequence, resolve outstanding conflicts, then complete once.
- Cancelled or failed finishing restores normal shared editing. An explicit offline finish retains later arrivals for recovery.
- Use the same drain/freeze protection when switching workouts. Closed or restored sessions cannot be revived by delayed packets.

**Exit:** the user can train, reconnect, review exceptions, and finish without understanding the synchronization machinery.

### E. Add final-product diagnostics and verification

- Keep a bounded local diagnostic history: the latest 500 events per device, retained for at most 14 days. Pending workout actions are stored separately and are never pruned as diagnostics.
- Record timer scheduling, expected deadline, callback time, delivery delay, notification permission, alert destination, fallback, suppression, and failures.
- Distinguish **notification posted / vibration requested** from physical vibration actually observed.
- Add a phone Settings diagnostics view and export through the existing share flow. Retrieve watch diagnostics on reconnect; no automatic cloud upload.
- Retain application-level retries because the current message transport has no built-in retry guarantee. See [Android Data Layer documentation](https://developer.android.com/training/wearables/data/client-types).

**Exit:** delayed or missing alerts can be investigated from the installed product without requiring continuous ADB access.

### F. Package and deliver

- Introduce protocol v2 for shared mutations and timer coordination. Continue draining existing v1 queues without resetting device identity or sequence history.
- Enable shared mode only after both APKs confirm v2 support; mixed versions retain the existing compatible workflow and show an update instruction.
- Deliver phone **1.0.6** and watch **0.5.0**, using increasing version codes and the existing signing identity.
- Build and verify both APKs, checksums, and source/build metadata. Install in place without clearing data.
- Update the specification, phase tracker, and user guide; commit and push the completed change to `master`.

### G. Final watch UI

The current single-scroll watch screen gets replaced by the redesign in [Galaxy Watch UI redesign](galaxy-watch-ui.md):

- a pager with Current set or Rest, then Exercises, then Progress;
- an EdgeButton "Done set" that logs an accepted target in one tap;
- rotary value pickers;
- a full-screen rest arc with −15 / +15 / Skip and a next-up preview;
- a TimeText sync indicator;
- a conflict review screen;
- test and permission controls moved into Settings.

The protocol and storage contract that supports it is in [Sync v2 design](galaxy-watch-sync-v2-design.md).

**Exit:** the watch is usable at arm's length mid-set, and no debug controls appear in the main flow.

## Interface changes

- **Workout mutations:** operation identity, device sequence, session/epoch/set identity, expected touched values, and sparse changes.
- **Rest operations:** start, adjust, skip, timer revision, originating operation, and confirmed alert destination. Use a separate stream from history mutations so suspended JavaScript cannot block native timer handling.
- **Sync status:** canonical revision, acknowledged sequences, pending counts, conflicts, and protocol compatibility.
- **Diagnostics:** bounded native inspection/export APIs exposed through the phone bridge.

Retain existing peer validation, packet-size limits, queue limits, and durable replay evidence.

## Tests and release acceptance

- Alternate phone/watch logging; edit different sets and different fields; test duplicate completion, conflicting edits, rapid undo, and stale editors.
- Disconnect either device, log independently, restart apps, reconnect, and verify each accepted action appears once.
- Test delayed/reordered/lost acknowledgements, full queues, storage failures, session switching, backup restore, and finish cancellation.
- Test timer start/extend/skip from either screen, clock skew, reboot, expired replay, alert-confirmation loss, and cancellation after undo.
- Run the full automated suite, native tests, typechecking, lint, APK builds, and signing checks.
- Perform one final-device smoke workout covering both screens, reconnect, finish, and several screen-off rests. Fix reproducible failures before delivery.

Extended battery, Doze, and background-delivery observation continues through the final product’s diagnostics. Android scheduling restrictions remain documented rather than treated as guaranteed delivery. See [Android alarm documentation](https://developer.android.com/develop/background-work/services/alarms).

## Definition of finished

Both screens support normal workout use without manual handoff; work survives disconnection; shared timer controls converge; finishing preserves pending work; matching APKs and current documentation are delivered. Extended background monitoring remains an operational follow-up, not unfinished synchronization development.
