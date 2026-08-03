# Review findings

Five parallel review agents audited the app before real use: persistence, live workout
runtime, Excel/backup I/O, PWA/mobile, and calculation correctness. Every finding below
was reproduced by running code, not reasoned about. All are **fixed and covered by tests**.

Kept as a record of what has already been checked, so it is not re-audited, and because
several fixes look arbitrary without the failure they prevent.

## Data loss and corruption

| Defect                                                    | Failure                                                                                                                                   | Fix                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Double-tapping Finish skipped a training day              | Finishing takes ~10 async round-trips with no guard; a second tap advanced the plan cursor twice, silently dropping a day                 | `completeSession` re-reads the stored row and bails if already completed; Finish button disables while saving |
| Out-of-order day drifted the cursor                       | Completing W2D4 from the Plan screen advanced W1D0→D1, marking a day done that was never trained                                          | Cursor only advances when the finished session _is_ the current day                                           |
| A second invisible plan could be created                  | StrictMode double-invoke or two tabs both saw an empty table and each wrote a plan; the winner was decided by random UUID ordering        | `ensureSeeded` runs in one transaction and re-checks inside it                                                |
| Resets left foreign-plan sessions behind                  | Scoped by `planId` while the confirmation promised everything                                                                             | Scoped by `dayId`; whole operation in one transaction                                                         |
| Two windows destroyed each other's sets                   | Whole-document writes, last writer wins, local state never re-synced                                                                      | Re-reads from IndexedDB on `focus`/`visibilitychange`                                                         |
| A set was dropped when two taps landed in one React batch | Writers rebuilt from a stale render closure                                                                                               | All writes go through a `sessionRef`-backed patch helper                                                      |
| Elapsed time never persisted while the timer ran          | The debounce was keyed on `elapsed`, which changes every second, so its own timeout could never fire — a reload rewound the clock to 0:00 | Ref-based 5 s flush plus `pagehide`/`visibilitychange`                                                        |
| A DB failure trapped the app on "Loading your plan…"      | No catch; Settings never mounted, so intact data was unreachable                                                                          | Recovery screen whose first button is _Export all data as JSON_                                               |
| No error boundary anywhere                                | Any render throw white-screened the app mid-workout                                                                                       | `ErrorBoundary` showing the same export-first recovery card                                                   |

## Wrong numbers

| Defect                                                | Failure                                                                                                                                                           | Fix                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Substituted work credited to the wrong exercise       | Every stats function matched the planned slot, so band-assisted reps appeared as the strict pull-up record while the Progress chart showed 0 for the same session | All comparisons resolve through `performedExerciseId()` |
| Progression suggested for an exercise never performed | Same root cause, in `detectProgressions`                                                                                                                          | Keyed by performed exercise                             |
| Dismissed suggestions returned and duplicated         | `handled` set excluded dismissed ones, contradicting the docstring                                                                                                | Dismissed are included in `handled`                     |
| Skipped exercises still fed records                   | No stats function checked `skippedReason`                                                                                                                         | Excluded everywhere                                     |
| A finished plan offered W4 Friday forever             | Cursor pinned to the last day; could reach "21 of 20 sessions"                                                                                                    | `plan.completedAt` ⇒ no current day                     |

## Excel and backup

| Defect                                          | Failure                                                                                                                         | Fix                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Repeating a day deleted it from the export      | The week sheet took only the _first_ session per day while the Summary counted them all — the file contradicted itself          | One labelled section per attempt                                                                                                |
| Orphaned results vanished                       | Results whose `prescriptionId` no longer joined were never emitted                                                              | Emitted under "Unmatched (not in current plan)"                                                                                 |
| Plan edits retroactively relabelled logged sets | Rows used the plan's _current_ exercise                                                                                         | Labelled by what was performed                                                                                                  |
| Import read reps from the wrong set             | A filtered index used against an unfiltered column list                                                                         | Column carried alongside the value                                                                                              |
| A non-finite weight poisoned everything         | Propagated `NaN` into every future session, and `JSON.stringify` turned it into `null`, making the backup silently unrestorable | Finiteness guards at both entry points                                                                                          |
| Export threw outright                           | Unparseable `startDate` or duplicate week numbers from a restored backup gave zero output from the only export path             | Defensive date formatting, unique sheet names                                                                                   |
| An empty backup bricked the UI                  | Cleared every table; seeding only runs at startup                                                                               | Rejected before the transaction opens                                                                                           |
| Fuzzy matcher produced nonsense mappings        | "Leg press" → Standard Push-Up via a partial "floor press" alias; "DB Lateral Raise" → Standing Calf Raise on the token "raise" | Aliases must match in full; generic tokens (`press`, `row`, `raise`…) cannot match alone; no load carried to bodyweight targets |

## PWA and mobile

| Defect                                             | Failure                                                                                                                       | Fix                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Update button dead on the first session            | No SW controls the page, so workbox's `controlling` event never fires — while the new worker had already purged the old cache | Explicit `location.reload()` fallback                                 |
| The offline-ready toast ate the first tap          | Fixed-position, no auto-dismiss, overlapping the primary button at 320 px                                                     | `pointer-events: none` + auto-dismiss                                 |
| Pain buttons 20 px wide; mid-set buttons 38 px     | Mis-taps feed a wrong pain score into progression                                                                             | Pain scale wraps at `minmax(44px, 1fr)`; `.btn.small` raised to 44 px |
| Hourly `registration.update()` unhandled rejection | Every hour in a gym with no signal                                                                                            | `.catch()`                                                            |

## Checked and found clean — do not re-audit

- `restoreBackup` transaction atomicity, including a mid-transaction throw.
- Backup round-trip losslessness through the zod schema.
- Production ExcelJS lazy-load interop, verified against the built chunk.
- Export with empty/partial data: zero sessions, null pain entries, all-null sets.
- Malformed import files (plain text, zero bytes) — clean rejection with a toast.
- `Charts.tsx` at 0, 1 and 2 points and with an all-zero series; no `-Infinity` or `NaN`
  reachable anywhere in `stats.ts`.
- Manifest and installability; offline deep-linking to `#/workout/<id>`.
- Stopwatch accuracy across backgrounding — the wall-clock anchor design is correct.
- Layout at 320 px and 375 px: no horizontal overflow, safe-area insets applied,
  16 px inputs so iOS never zooms on focus.

## Known and accepted

- **Rest timer is silent on iPhone** (no `navigator.vibrate` in Safari; the beep cannot
  start outside a gesture). Irrelevant on the S22 — Android supports both.
- **Excel export fires after an `await`**, outside the original tap gesture. iOS Safari is
  strict about this. Untested on a device; if export ever "does nothing" on an iPhone,
  start here. Not a problem on Android.
