# Galaxy Watch7: install, train, and sync

Current pair: **phone 1.0.5 (code 6)** and **watch 0.4.0 (code 4)**.
The watch app is native Wear OS software. Both apps install directly from APKs;
an app store is not part of installation or normal operation.

## Install or update

Install `ironpath-phone.apk` on the phone through the existing file-manager/browser
installation flow. Install `ironpath-watch.apk` on the watch using wireless ADB.
Use matching APKs from `artifacts/watch-phase4/`, with `SHA256SUMS` and `build.json`
for verification. These are debug-signed builds using the existing signing
identity, not store releases. Build outputs are ignored by Git; a source checkout
does not contain the delivered APKs or the private signing key.

For the watch:

1. Enable Developer options, ADB debugging, and Wireless debugging on the watch.
   Keep the computer and watch on the same Wi-Fi network.
2. If the computer is not paired, open **Pair new device** and run
   `adb pair WATCH_IP:PAIRING_PORT`. Enter the displayed pairing code.
3. Return to the main Wireless debugging screen. Run
   `adb connect WATCH_IP:CONNECTION_PORT` using that screen's port. Pairing and
   connection ports are different and can change. Existing pairing can be reused.
4. Run `adb -s WATCH_IP:CONNECTION_PORT install -r ironpath-watch.apk`.
5. Open Ironpath from the watch app list. Turn debugging off when finished;
   phone/watch workout synchronization does not use ADB.

On this development computer, use `adb -P 15037 ...` for every command because
other applications occupy the default ADB server port. This computer-side port
is separate from the watch-side pairing/connection ports. `adb mdns services`
can discover an enabled watch's current connection endpoint.

Update in place and retain the same signing key on both devices. Do not uninstall
the phone app to work around a signature mismatch: its workout history is local.
Back up that history before changing devices or signing configurations.

## Normal workout

1. Start or resume the workout on the phone. Complete its warm-up and any needed
   phone-only inputs. Finish or skip any active phone rest.
2. Tap **Send workout to watch** and wait for confirmation that it was saved.
3. Open Ironpath on the watch. Enter actual reps/per-side reps and weight, then
   tap **Complete set**. Targets are hints; **Use … reps** explicitly copies the
   target. Unsupported exercise styles are logged on the phone.
4. Follow the local rest countdown. **+15 seconds**, **Skip rest**, **Exercises**,
   **Progress & sync**, and **Undo last set** are available as appropriate.
5. Reopen the phone app. Tap **Take control on phone / sync watch** and wait for
   **Phone has control** before editing or finishing on the phone.
6. If offered, **Resume paused watch rest** starts its saved remainder on the
   phone after the wrist alert was cancelled. Finish the workout on the phone.

The phone keeps canonical workout history. Watch actions are saved locally and
remain queued until the phone app imports them and returns a final result.
Keeping the phone app closed can therefore leave actions waiting to sync.
Starting and finishing a workout independently on the watch is outside this
version. Watch progress shows working-set counts and pending actions; use the
phone for elapsed workout time.

## Alerts and recovery

On the watch, enable **Wrist alerts** and allow **Precise rest alerts** where
available. **Test wrist alert** uses a three-second test without changing workout
sets; it cannot replace an active workout rest. Notification permission, DND,
power saving, and OS scheduling can affect alerts.

If synchronization waits, reconnect the paired devices, open both apps, and retry
**Take control on phone / sync watch**. The explicit offline override warns that
the watch may still accept actions until it reconnects. Finishing offline can
exclude those later actions from the completed workout; they are retained for
review rather than automatically changing closed history.

Conflicting, closed-workout, or pre-restore actions appear under **Saved watch
actions need review** in the workout or phone Settings. Compare the requested
values with current history and copy them manually into an open workout if
needed. **Reviewed · keep current phone values** acknowledges the review while
retaining the original evidence. Once pending sync finishes, choose **Use phone
values** on the watch to clear its conflict block. Do not uninstall or clear app
data to resolve pending actions.

## Verification status

The user confirmed installation, real workout handoff, and returning to phone
control/sync before finishing. Automated validation passed 464 TypeScript tests
and 32 native tests, typechecking, ESLint, Android lint, APK builds, and matching
signing-certificate checks.

Remaining real-device checks are repeated screen-off vibration, locked/disconnected
logging and reconnect without duplicates, undo/conflict/restart/restore recovery,
and workout-length battery use. Development of this first usable version is
wrapped; these qualification checks remain open. See the
[phase tracker](galaxy-watch-phases.md) and
[defect analysis](galaxy-watch-phase4-validation.md).

## Rebuild the APK pair

Use Node 22+, JDK 21, and the Android SDK 36 setup described in the main README.
The existing signing key must be available outside the repository.

```bash
npm ci
npm run android:pair-apks
npm run watch:test
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner" \
  node scripts/package-watch-apks.mjs /path/to/previous-phone.apk watch-phase4
```

The packaging step refuses mismatched phone/watch/baseline certificates and
writes the pair, hashes, and build metadata to `artifacts/watch-phase4/`.
