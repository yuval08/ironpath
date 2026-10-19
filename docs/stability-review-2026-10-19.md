# Workout stability review — 2026-10-19

All findings below have fixes in this changeset. Regression tests use synthetic
data. The supplied backup was also restored and checked in an isolated test
database; neither the original file nor its historical blanks were rewritten.

## 1. Completing sets discards displayed history hints

- **Severity:** High
- **Location:** `src/components/ExerciseCard.tsx`, `src/components/SetRow.tsx`
- **Failure Scenario:** Accepting the displayed weight without typing it leaves a
  null in saved history, so later workouts lose that hint.
- **Why It Happens:** HTML placeholders are not input values, and completion only
  changed the completed flag.
- **Reproduction Steps:** Log a weighted set; open another session; check its set
  complete without retyping the weight; inspect the saved weight.
- **Impact:** Missing loads and reps accumulate across workouts and affect progress
  calculations.
- **Suggested Fix / Implemented:** Accept visible weight/rep hints when completing
  individual sets or all working sets. Preserve explicit values, including zero,
  completed rows, and effort fields. Recover missing hints from earlier completed
  matching rows without changing historical records.

## 2. Untouched exercises hide performed history

- **Severity:** Medium
- **Location:** `src/utils/doubleProgression.ts`
- **Failure Scenario:** An unfinished exercise in a completed workout replaces the
  last useful result with blank or prescribed defaults.
- **Why It Happens:** History included any unskipped result, even with no completed
  working sets.
- **Reproduction Steps:** Log an exercise; finish a later workout leaving it
  untouched; open its next workout.
- **Impact:** Placeholders disappear and history displays work that was not done.
- **Suggested Fix / Implemented:** Require a completed working set before a result
  can supply history. Keep warm-up and working row positions separate.

## 3. Uncompleted rows inflate performance summaries

- **Severity:** Medium
- **Location:** `src/utils/doubleProgression.ts`
- **Failure Scenario:** A heavy weight entered in an unperformed row becomes the
  chart's top weight for that session.
- **Why It Happens:** Snapshots summarized all working rows.
- **Reproduction Steps:** Complete a 30-weight set; enter 90 in another row without
  completing it; inspect the session snapshot.
- **Impact:** Misleading chart peaks and last-performance summaries.
- **Suggested Fix / Implemented:** Summarize completed working rows only.

## 4. Workout completion can commit only half its changes

- **Severity:** High
- **Location:** `src/db/repository.ts`
- **Failure Scenario:** Saving completion succeeds but updating the plan cursor
  fails; retry then sees an already-completed workout and never advances.
- **Why It Happens:** Session completion and cursor updates used separate writes,
  and concurrent finishers could both pass the initial guard.
- **Reproduction Steps:** Inject a plan write failure while completing a workout;
  retry completion. Alternatively, finish the same workout concurrently.
- **Impact:** Stuck scheduling or overwritten completion data.
- **Suggested Fix / Implemented:** Commit the session and cursor in one transaction;
  return the actual committed session on duplicate completion.

## 5. Switching programs detaches an existing workout from its plan

- **Severity:** High
- **Location:** `src/screens/WorkoutScreen.tsx`, `src/db/repository.ts`
- **Failure Scenario:** Opening an unfinished workout after switching programs can
  render no exercise cards; finishing it fails to advance its owning plan.
- **Why It Happens:** The screen and completion used the currently active plan
  rather than the session's plan ID.
- **Reproduction Steps:** Start a workout in plan A; activate plan B; open and
  complete the earlier workout.
- **Impact:** Inaccessible logging UI and incorrect plan scheduling.
- **Suggested Fix / Implemented:** Load and advance the workout's owning plan.

## 6. Finish failures leave the workout UI permanently disabled

- **Severity:** Medium
- **Location:** `src/screens/WorkoutScreen.tsx`
- **Failure Scenario:** A storage failure disables Finish indefinitely. A failure
  generating suggestions also traps an already-saved workout on that screen.
- **Why It Happens:** The finish guard had no error recovery.
- **Reproduction Steps:** Reject completion storage, or reject suggestion loading
  after successful completion; attempt to finish again.
- **Impact:** Users cannot retry or cannot tell that their workout saved.
- **Suggested Fix / Implemented:** Re-enable retry after a completion failure;
  report derived-data failures separately and leave successfully saved workouts.
  Reject missing/abandoned sessions instead of claiming completion succeeded.

## 7. Stale autosaves reopen terminal or deleted workouts

- **Severity:** High
- **Location:** `src/db/repository.ts`
- **Failure Scenario:** An old tab writes its in-progress copy after another tab
  completes or deletes the workout.
- **Why It Happens:** Autosave unconditionally replaced the entire stored row.
- **Reproduction Steps:** Retain an in-progress session copy; complete or delete
  the stored session; save the old copy.
- **Impact:** Completed results are overwritten or deleted workouts reappear.
- **Suggested Fix / Implemented:** Check stored existence and terminal status in
  the same transaction as the write.

## 8. Schema-valid backups can silently discard or disable data

- **Severity:** High
- **Location:** `src/utils/backup.ts`
- **Failure Scenario:** Duplicate IDs silently overwrite records during restore;
  an invalid singleton settings ID leaves settings unreadable.
- **Why It Happens:** Individual row validation did not enforce database identity
  constraints before replacing local data.
- **Reproduction Steps:** Duplicate a session ID or change the settings row ID in
  an otherwise valid backup; restore it.
- **Impact:** Silent history loss or an unusable settings/workout screen.
- **Suggested Fix / Implemented:** Validate uniqueness, singleton settings identity,
  and supported record versions before replacement. Export tables in one read
  transaction for a consistent snapshot.

## 9. Excel imports pair weights with another set's reps

- **Severity:** Medium
- **Location:** `src/utils/excelImport.ts`
- **Failure Scenario:** Headers `Exercise / S1 Wt / S2 Wt / S2 Reps` associate
  the S2 reps with S1's weight, or lose the S2 reps when S2 is heaviest.
- **Why It Happens:** Weight and reps columns were paired by array position.
- **Reproduction Steps:** Import a tracker with missing or reordered rep columns.
- **Impact:** Incorrect imported weight/reps references.
- **Suggested Fix / Implemented:** Match columns by their set number.

## 10. Changing units silently relabels saved weights

- **Severity:** High
- **Location:** `src/screens/SettingsScreen.tsx`, `src/db/repository.ts`
- **Failure Scenario:** A saved 40 lb entry becomes labeled 40 kg after changing
  the global unit, while plan increments retain their earlier units.
- **Why It Happens:** Historical weight fields have no per-record unit, and the
  setting changed without conversion.
- **Reproduction Steps:** Log a weighted workout; change lb to kg; inspect history.
- **Impact:** Incorrect load interpretation and progression recommendations.
- **Suggested Fix / Implemented:** Lock unit changes while workouts, recorded or
  prescribed weights, or custom plans depend on the current unit. Before logging,
  allowed unit changes rebuild pristine plan increments atomically. Cross-unit
  conversion of existing history is not implemented.

## 11. Historical workout screens can use future sessions as hints

- **Severity:** Medium
- **Location:** `src/screens/WorkoutScreen.tsx`
- **Failure Scenario:** Opening an older session displays values from workouts
  that happened after it.
- **Why It Happens:** Prior-session selection only excluded the current ID.
- **Reproduction Steps:** Log two dated sessions of an exercise; reopen the first.
- **Impact:** Misleading historical context and progression advice.
- **Suggested Fix / Implemented:** Scope history to the same plan and earlier
  session start times.

## 12. Finish uses the wrong progression rules and omits the final workout

- **Severity:** Medium
- **Location:** `src/screens/WorkoutScreen.tsx`
- **Failure Scenario:** A newly completed hypertrophy workout is evaluated using
  an in-progress local copy and generic rules instead of its prescription.
- **Why It Happens:** Completion saved a separate completed object, while detection
  received the old object without the owning plan.
- **Reproduction Steps:** Complete a qualifying double-progression workout; inspect
  the finish-time suggestion detection arguments.
- **Impact:** Missing or incorrect progression suggestions.
- **Suggested Fix / Implemented:** Use the committed completed session, history
  scoped to its plan, and the owning plan's progression rules.

## Validation

- 390 unit/integration tests and 17 browser tests pass. TypeScript, lint, and the
  production build pass. Browser tests used the installed Google Chrome because
  this environment lacks the Playwright-configured headless-shell version.
- Unit/integration coverage includes placeholder acceptance, multi-week holes,
  untouched defaults, warm-up separation, explicit zeros, transaction rollback,
  switched plans, stale saves, unit integrity, backup rejection, and Excel pairing.
- Browser coverage checks the multi-week history workflow, accepted hints surviving
  reload, completing and resuming workouts, program switching, exports, restoration,
  and the offline shell.
- Real-backup verification checks restoration and recovered hints in an isolated
  test database. It does not infer or rewrite the weights actually used on dates
  whose exported fields are blank.
