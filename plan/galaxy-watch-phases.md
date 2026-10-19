# Galaxy Watch implementation phases

Updated: 2026-10-19
Specification: [Galaxy Watch companion](galaxy-watch-companion.md)

Each phase has a delivery gate. Desktop checks do not substitute for Watch7 tests.

## Wrap-up status

The first working version is delivered as **phone 1.0.5 (code 6)** and **watch
0.4.0 (code 4)**. Development for the initial usable version is wrapped. The user
confirmed the real workout handoff and, after the phase-four update, the **Take
control on phone / sync watch** flow before finishing. These are user-reported
checks, in addition to the recorded ADB installation and automated validation.

The current pair passed 464 TypeScript tests and 32 native tests, typechecking,
ESLint, Android lint, APK builds, and certificate verification. Artifacts and
checksums were delivered under `artifacts/watch-phase4/`; build outputs and
signing keys stay outside Git. See the [user guide](galaxy-watch-user-guide.md)
for current installation/use instructions. Phase sections below retain historical
implementation milestones and their test counts.

Remaining physical qualification:

- Repeated rest alerts/vibration with the screen off, including ambient mode,
  relevant permissions, DND, and power saving.
- A representative workout with the phone locked/disconnected, followed by
  reconnect and verification that sets appear once in canonical phone history.
- Undo, same-set conflicts, application restart/recovery, and backup restore with
  queued actions on the actual devices.
- A normal workout's battery use and unexpected background-process termination.

These checks are follow-up qualification, not completed tests. Current watch
progress has working-set counts/pending sync; elapsed workout time remains on the
phone. Independent watch workout start/finish remains outside this version.

| Phase | Deliverable | Current state |
| --- | --- | --- |
| 0 — Feasibility and signing | Architecture, certificate baseline, device test procedure | Desktop audit complete; Watch7 connectivity confirmed; timer spike pending |
| 1 — Native foundation | Installable Kotlin/Compose app, native phone bridge, durable diagnostic receipts, round-trip connection test | Installed on both devices; user confirmed watch-to-phone connection |
| 2 — Workout protocol and persistence | Stable set IDs, shared command reducer, transactional import/ledger, durable command queues, handoff | Implemented; automated checks pass; user confirmed real workout handoff works |
| 3 — Watch workout controls | Snapshot-driven screens, actual-value editing, complete/undo, execution order, local timers | Implemented; automated checks pass; installed on Watch7; physical qualification in progress |
| 4 — Reconnection and phone integration | Ownership, conflict review, backup epochs, finish safeguards, alert handoff | Implemented; APK pair delivered; user confirmed return-to-phone sync/control; broader physical qualification pending |
| 5 — Device qualification and delivery | Failure testing, battery assessment, signed APK pair and user documentation | APK delivery and user documentation complete; broader device qualification remains open |

## Phase 0 — Feasibility and signing

Completed desktop work:

- Confirmed a separate Wear OS module can share the phone's application ID,
  certificate, and native communication library.
- Identified IndexedDB as canonical history and whole-document writes as a
  concurrency risk. A native listener cannot commit directly to IndexedDB.
- Verified the existing distributed artifact `artifacts/ironpath-1.0.2-android.apk`
  uses an Android Debug certificate. Its SHA-256 certificate fingerprint is
  `38255a7568a4da49089841c3d0550c2504dce46ceb109b477e253e6870261843`.
- Added a packaging script that refuses to package builds with a certificate
  different from each other or the supplied previous phone APK. It does not copy
  signing keys. Confirm the user's installed phone build matches that baseline
  before using a different historical APK as the reference.
- Selected Kotlin 2.2.20, Compose for Wear OS 1.5.0, a Wear OS minimum Android API
  of 30, and the existing Android SDK 36 / Gradle / AGP setup. Build with JDK 21.
- Regenerated Capacitor settings to remove stale machine-specific module paths.

Pending device gates:

- Record Watch7 model/display size, Wear OS/One UI version, paired phone Android
  version, Google Play services availability, and installed phone certificate.
- Install the phase-one APK pair; test both directions with the phone locked,
  its WebView suspended, and after reopening each app.
- Before implementing production timers in phase 3, spike repeated short
  screen-off countdown alerts on Watch7. Record permission and power-saving limits
  and select the supported native scheduler/lifecycle design.

The user's physical Watch7 (ADB model SM-L310) is now accessible over wireless
ADB. The phase-one watch APK installed successfully and its native screen was
visually verified. The user installed the phone companion and reported
**Connection verified** on the watch. Locked-phone/reconnection checks and timer
feasibility gates remain open.

ADB reports Android 16 / API 36 on this Watch7.

## Phase 1 — Native foundation

Implemented:

- `android/wear`: native Kotlin and Compose for Wear OS launcher with a
  **Test phone connection** action; no workout logging enabled yet.
- `android/wear-link`: shared Java Data Layer library, versioned/size-limited
  diagnostic protocol, capability discovery, and manifest listener.
- Native SQLite storage persists up to 50 diagnostic receipts, deduplicating by
  peer/message ID/type. A ping is answered only after its receipt is committed.
  This is bounded diagnostic history, not the workout command queue of phase 2.
- `WatchLink` Capacitor plugin exposes native inspection and ping actions. It is
  registered before the bridge loads. Native work runs off the UI thread.
- Phone Settings exposes **Galaxy Watch → Test watch connection** only when the
  native plugin is available. Both interfaces verify a matching pong rather than
  treating successful send as proof of a working companion.
- Protocol unit tests reject unsupported versions/types, malformed input, invalid
  IDs, oversized messages, and trailing content. UI tests cover stale replies,
  timeout, failure recovery, and hiding native controls in a browser.
- Repeatable paired builds and certificate-verified artifact packaging.

Gate: both APKs build, protocol/UI checks pass, signatures match the baseline,
and the real Watch7 round-trip checks below pass. The user confirmed the
watch-to-phone test; locked-phone and reconnection checks remain pending.

Desktop verification on 2026-10-19:

- Phone and watch debug APK builds passed.
- Three native protocol unit tests passed; all 438 TypeScript tests passed.
- TypeScript checking and ESLint passed.
- Android lint passed for phone, watch, and shared library (warnings remain,
  including newer dependency versions and existing phone resource warnings).
- Both APK certificates match the previous distributed 1.0.2 phone APK.
- Packaged diagnostic APKs and SHA-256 checksums under `artifacts/watch-phase1/`.
- Installed the watch APK on the physical Watch7 and verified its launcher screen.
  The user subsequently confirmed the watch-to-phone round trip. Locked-phone
  behavior remains unverified.

Local development note: other applications occupy TCP ports 5037 and 5038 on this
computer. Use `adb -P 15037 ...` here for the separate ADB server; pairing and
installation succeeded through that server. This local server port is distinct
from the watch's pairing and connection ports.

### Build and package

Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to the installed Android SDK.

```bash
npm run android:pair-apks
npm run watch:test
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner" \
  node scripts/package-watch-apks.mjs artifacts/ironpath-1.0.2-android.apk
```

The packaging script produces `artifacts/watch-phase1/ironpath-phone.apk`,
`ironpath-watch.apk`, `SHA256SUMS`, and `build.json`. These are debug diagnostic
builds. They retain the existing phone version in phase 1; bump app versions/codes
before the phase-five release. Do not distribute a build from a fresh machine's
different default debug key. The script fails instead of suggesting an uninstall.

### Watch7 device validation

Use the Wi-Fi pairing/install instructions in the main specification. Install the
phone APK as well as the watch APK; the old phone APK has no companion listener.

1. Open both apps. In phone Settings, test the watch connection; expect
   **Watch replied. Connection verified.**
2. On the watch, choose **Test phone connection**; expect **Phone replied.
   Connection verified.**
3. Lock the phone and repeat the watch test. Repeat after the phone app has been
   backgrounded long enough to suspend its WebView. Android Settings force-stop
   is a separate restriction and is not equivalent to ordinary suspension.
4. Reopen the phone and inspect `WatchLink.inspect()` through the bridge if
   diagnostics are needed; persisted receipts should include the locked-phone
   test. Native DB process-death durability still needs device validation.
5. Disconnect the watch. Test should fail or time out, never report a stale pong
   as success. Reconnect and retry successfully.
6. Restart apps and confirm new request IDs are checked against new replies.

This phase has no background workout command retries, workout sync, countdowns,
or wrist alerts. Those require the later phases' persistence and timer rules.

## Phase 2 — Workout protocol and persistence

Implemented in phone version 1.0.3 (code 4), watch version 0.2.0 (code 2):

- Schema v6 adds optional durable set IDs and edit revisions while continuing to
  import old backups. Legacy IDs are deterministic; newly created sets get IDs
  immediately. Snapshot creation persists identities before sending them.
- Phone saves compare edit revisions transactionally and reject stale document
  replacements. Elapsed-time updates are independent, monotonic field updates.
- Shared prescription grouping drives phone cards and watch execution order.
  Snapshots include targets separately from actuals, units, per-side styles,
  ramps, and superset/extra-set rest rules.
- The native workout protocol uses its own path and size/schema limits. Separate
  SQLite inbox/outbox tables preserve pending user actions across helper/process
  lifecycle changes; diagnostic pruning never touches user commands.
- Device IDs and per-epoch sequences are allocated atomically with outbox writes.
  Receipt ACKs retain watch actions until the canonical phone result is saved.
  Received actions do not starve new unsent actions. Resume/capability changes
  retry them; foreground flushing pauses with the watch Activity lifecycle.
- The phone atomically commits a field-level set change and a command-result
  ledger. Duplicate IDs replay cached results; changed payloads are rejected.
  Unrelated phone edits can merge; same-set edits produce explicit conflicts.
  Missing sequence numbers defer application without consuming the command ID.
- Backup restore rotates the sync epoch in the same transaction as restored
  records. Old native pending actions remain available for explicit rejection,
  rather than mutating a restored session with coincidentally matching IDs.
- Startup reconciliation runs before the normal app becomes ready. Foreground
  polling imports later arrivals and updates the workout screen through live data.
- **Send workout to watch** publishes a selected session after warm-up. The phone
  reports success only after the watch confirms durable receipt. The watch shows
  the saved workout title and next set/target, including unsupported-style fallback.

Validation: 455 TypeScript tests, 13 native tests (including SQLite persistence,
capacity, retry and acknowledgement behavior under Robolectric), typechecking,
ESLint, Android lint, and both debug APK builds passed. These native tests do not
substitute for real OS process-death and screen-off delivery tests.

Phase-two boundaries (historical): this was a cached, read-only workout preview. Send again to
refresh phone edits. The command queue/reducer is implemented but no watch set
logging buttons are enabled yet. General phone control ownership, conflict review
screens, comprehensive background retry scheduling, and rest alerts remain in
phases 3–4. No workout mutations are performed just by sending a preview.

To package the phase-two pair after `npm run android:pair-apks`:

```bash
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner" \
  node scripts/package-watch-apks.mjs artifacts/ironpath-1.0.2-android.apk watch-phase2
```

Artifacts go to `artifacts/watch-phase2/`. Update the phone APK and watch APK.
Then open an existing workout, finish its warm-up on the phone, choose **Send
workout to watch**, and verify the real session/next set appears on the Watch7.
This end-to-end device handoff is the remaining phase-two delivery gate.

The final 0.2.0 watch APK was installed on the user's Watch7 through ADB and
`am start -W` reported a successful launch. The user installed the phone update
and confirmed the real workout handoff works. Later phases added wrist logging and phone control transfer.

Original phase requirements:

- Introduce stable set identity, a data epoch, and session revisions with a safe
  migration/backfill. Maintain existing backup compatibility.
- Extract tested execution order and field-level commands from phone UI behavior,
  covering ramp sets, supersets, supported entry styles, hints, and actual values.
- Route affected phone writes and elapsed saves through serialized/transactional
  mutations; reject stale whole-document replacements.
- Build separate durable native inbox and watch outbox for user commands. Do not
  reuse the diagnostic store's pruning policy for uncommitted user actions.
- Commit IndexedDB mutations and command ledger together. Distinguish native
  receipt acknowledgements from final committed results.
- Add explicit handoff and snapshot confirmation, without enabling full watch
  workout controls until their state transitions are verified.

Gate: tests reproduce and prevent duplicate application, crash-after-commit replay,
out-of-order mutations, stale phone overwrite, queue exhaustion, and schema mismatch.

## Phase 3 — Watch workout controls and timers

Implemented in phone 1.0.4 (code 5) and watch 0.3.0 (code 3):

- Native reps, per-side reps, and load controls; explicit target shortcuts never
  silently fill measured values. Unsupported measurement styles remain phone-only.
- Completion atomically saves the command, projected set state, undo information,
  and rest deadline in SQLite. Capacity failure does not show an unsaved set as
  completed. Stale onscreen inputs and duplicate completion are rejected.
- Undo creates a sequenced inverse command and cancels only its own rest. Local
  progress survives process recreation and phone suspension.
- Canonical snapshots carry per-device sequence watermarks. Watch projection
  combines pending and committed effects in sequence order, preventing delayed
  replies/snapshots from reapplying an already undone set.
- Phone foreground reconciliation refreshes confirmed handoffs after session edits
  and command imports. A handoff confirmation cannot be replaced by an automatic
  refresh before the user's confirmation UI sees it.
- Rejected/conflicting actions remain stored. Logging stops until pending actions
  finish syncing and the user explicitly chooses **Use phone values** on the
  watch. Full phone-side conflict review remains phase 4.
- Native rest service with an ongoing Wear activity/notification, one deadline
  callback, a bounded CPU wake lock (up to ten minutes), and an AlarmManager
  fallback. There is no per-second phone messaging. The visible countdown uses
  monotonic time and continues without a phone connection.
- +15 seconds, Skip rest, and timer replacement use timer IDs/revisions. Expiry
  claims are transactional, so service/alarm/foreground callbacks cannot vibrate
  twice or dismiss a later countdown. Haptics honor the handed-off preference,
  notification permission/channel settings, and OS notification vibration policy.
- Same-boot recovery uses elapsed time; reboot recovery reanchors from the saved
  wall deadline only when plausible, ending expired/uncertain rests without
  replaying old alerts. The backup alarm survives ordinary process death.
- The watch exposes **Enable wrist alerts**, **Allow precise rest alerts**, and
  **Test wrist alert**. The test uses a three-second local timer and changes no
  workout data; it refuses to replace an active workout rest.

Phone handoff requires finishing/skipping an existing phone rest first. Watch set
imports do not start phone rest alerts. General control ownership/transfer,
closed-session invalidation while disconnected, and background retry qualification
remain phase 4. A gym-length battery assessment remains phase 5.

Background accuracy depends on the OS. Short rests primarily use the foreground
service and bounded wake lock; exact/inexact alarms provide fallback delivery.
Android Doze can ignore wake locks and throttle repeated idle alarms. The code
does not claim repeated exact screen-off delivery under forced Doze without the
physical Watch7 tests. Permission denial still permits onscreen countdowns.

Validation on 2026-10-19: 458 TypeScript tests and 26 native tests passed;
TypeScript checking, ESLint, phone/watch Android lint, and both debug APK builds
passed. Certificate verification matched the existing phone APK. Packaged APKs,
checksums, and build metadata are under `artifacts/watch-phase3/`.

Installed watch 0.3.0 on the physical Watch7 without clearing its data. Re-pairing
succeeded and mDNS discovered connection endpoint `192.168.88.37:38261` (these
ports can change). The native workout screen was inspected and the notification
permission was enabled through the OS prompt. Device logcat recorded two local
rest completions before notification permission and a rest completion at
14:19:13 with notifications enabled. The foreground rest service was observed
running with its ongoing notification. These observations do not establish
physical vibration, repeated screen-off accuracy, or forced-Doze reliability.
Precise-alarm permission was not verified as enabled.

Remaining phase-three device gate (use the current phone 1.0.5/watch 0.4.0 pair): enable precise alerts if
available, run repeated short rest tests with the screen off, verify ten set/undo
transitions with the phone locked, and reopen the phone to verify one canonical
application per action. Active workout data was not deliberately changed for QA;
the isolated alert control is intended for countdown testing.

Reference: [Wear ongoing activities](https://developer.android.com/training/wearables/notifications/ongoing-activity),
[foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types),
and [Android alarms](https://developer.android.com/develop/background-work/services/alarms).

- Add current set, rest, exercise list, and progress screens from saved snapshots.
- Implement supported actual-value editors, complete/undo, supersets, and explicit
  phone-only fallback for unsupported input styles.
- Save actions before showing completion; project pending changes locally.
- Implement monotonic countdowns, native screen-off scheduling validated in phase
  0, timer revision checks, cancellation, +15 seconds, and reboot recovery.

Gate: execute ten working sets from the wrist with the phone locked, including
superset and rest transitions; test process recovery and screen-off vibrations.

## Phase 4 — Reconnection and phone integration

Implemented in phone **1.0.5 (code 6)** and watch **0.4.0 (code 4)**:

- **Take control on phone / sync watch** queues a durable pause request to the
  previously selected watch, including while it is unreachable. Watch SQLite
  atomically freezes new set/undo commands, cancels its current rest, and returns
  its device sequence checkpoint. Receipt alone does not establish a completed
  transfer: the phone must import every sequence through that checkpoint.
- Normal workout completion waits for this barrier, outstanding phone saves, and
  explicit review of rejected/conflicting actions. It then reads the latest
  canonical session, preserving imports received while the screen was open.
  An unreachable-watch override requires a separate warning: later arrivals to a
  closed workout are rejected and retained for recovery, never silently applied.
- Phone workout input controls are disabled during watch control. Offline phone
  takeover explicitly reports that the cached watch may still accept actions.
  Reconnection alone does not transfer ownership or start a phone rest.
- Monotonic control generations prevent old snapshots or control requests from
  reopening/pausing a newer handoff. Pending watch commands survive pause, process
  recreation, and rejected session switches. Pause retries native-received work;
  native message/capability callbacks flush durable queued work without the UI.
- A verified transfer saves the paused watch rest remainder. **Resume paused watch
  rest** explicitly starts that remainder on the phone after the old wrist alert
  is cancelled. Transfer time is a visible pause, rather than comparing clocks on
  separate devices. A reboot with an unverified timer boot supplies no remainder.
- Closed/deleted workouts and obsolete backup epochs queue durable watch closure
  notifications. A disconnected watch can still cache actions until closure
  arrives, but canonical closed/epoch checks continue to reject those actions.
- Phone workout and Settings screens expose **Saved watch actions need review**,
  including requested values and rejection reasons. Review retains the evidence;
  it does not automatically apply conflicting or closed-workout values. Values can
  be copied manually to an open workout. Pre-restore actions use a separate
  recovery record so old committed replay evidence is preserved too.
- Both APKs must be updated together for pause/checkpoint support. An older watch
  cannot produce the new confirmation, so normal completion waits and offers the
  explicit unreachable/unsupported-watch path rather than claiming a clean sync.

Validation on 2026-10-19: all **464 TypeScript tests** and **32 native tests**
passed; the closure/receipt regression was reproduced as a failing test and then
passed after its fix. TypeScript checking, ESLint, phone/watch/shared Android
lint, and both final APK builds passed. Packaged APKs and SHA-256 sums are in
`artifacts/watch-phase4/`; both certificates match the installed baseline.

Watch **0.4.0 (code 4) installed successfully** on 2026-10-19 using `adb install -r`,
keeping existing app data. Re-pairing succeeded; mDNS discovered connection endpoint
`192.168.88.37:35685` (ports may change). Android package inspection confirmed the
installed version and `am start -W` returned success. UI inspection showed the
existing workout with **All sets completed. Finish on your phone.** and its undo /
exercise controls. No workout set was changed for this installation check. Recent
native-error inspection returned no matching failures. Display capture was unreliable
because the watch quickly went dark; the UI hierarchy confirmed the rendered app.
The matching phone 1.0.5 APK was delivered for manual installation. Following the
installation and **Take control on phone / sync watch** instructions, the user
confirmed the flow works. This confirms the basic return-to-phone path; offline
queue, conflict/restore, and timer-transfer variants remain unqualified on device.
See [phase-four defect analysis](galaxy-watch-phase4-validation.md) for the concrete
failure scenarios addressed. Remaining physical gates: phone/watch control
transfer with queued offline sets, paused-rest resume, closure after reconnect,
backup restore recovery, and the phase-three screen-off/ten-set tests.

- Reconcile before phone edits; expose pending count and conflicts.
- Implement take-control, unreachable-watch handling, alert ownership transfer,
  session switching, finish guards, and reset/restore epoch handling.
- Never silently discard local watch work or resurrect completed sessions.

Gate: intentional phone/watch conflicts, connectivity loss, finishing offline, and
backup restore preserve recoverable work and never double-advance plan progression.

## Phase 5 — Qualification and delivery

Delivered: compatible APK pair, signature/checksum checks, in-place Watch7 update,
and the [installation/use/recovery guide](galaxy-watch-user-guide.md). The user
confirmed the basic workflow and asked to wrap development. The physical checks
listed in the wrap-up status remain open; do not describe this as full device
qualification or a production reliability guarantee.

Original qualification requirements:

- Run the specification's complete failure matrix on the actual phone/Watch7.
- Assess a gym-length session for battery, ambient mode, DND, and power-saving
  behavior; document supported behavior and observed restrictions.
- Run regression checks, bump versions/codes, build and verify the APK pair,
  and record hashes, source revision, signing fingerprint, and protocol version.
- Deliver install/update instructions with two concrete APK artifacts.

Gate: all acceptance checks pass or a limitation is explicitly accepted and
documented. App store publication is not required at any phase.
