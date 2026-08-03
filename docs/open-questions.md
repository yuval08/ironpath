# Open questions

Deliberately unresolved. Each is a judgement call the owner owns, not a defect — the code
does exactly what was specified. Left as-is rather than silently rewriting the training
content.

## ~~1. Week 4 overruns the 60-minute target~~ — RESOLVED

## ~~2. Week 4 is the highest-volume week~~ — RESOLVED

Both fixed together. See [decisions.md](decisions.md#session-length-is-computed-not-declared)
for the mechanism and the before/after numbers.

## 1. The weekly push-up goal always reads as already exceeded

The Plan screen shows "Push-up goal: 45–60 reps this week" for Week 1. Actual prescribed
volume counted by `PUSH_UP_EXERCISE_IDS` (standard + decline + pike) is **72–120** in W1
and **90–141** in W4, against a stated goal of 60–80.

Both numbers were specified: the per-exercise sets/reps _and_ the weekly goals. They
disagree. Either the goal is a floor (and should be relabelled), or the prescribed volume
is higher than intended.

## 2. The "Weekly volume" chart stays empty early on

`sessionVolume` is `Σ weight × reps`. Most of this block is bodyweight and band work, and
weight fields are now hidden for those movements by design. The chart only populates from
the seven loaded exercises once weights are logged.

Options: keep it (it fills in as loaded work accumulates), relabel it to make the scope
explicit, or drop the card for this block.

## 3. Backward treadmill progresses ~25% per week

Monday 8 → 10 → 12 → 15, Lower A 10 → 12 → 12 → 15, Lower B 10 → 12 → 15 → 15 — close to
doubling over the block. It is simultaneously the most knee-focused modality and the
largest single time cost per session. Progression is per spec; flagged because it is the
most likely place to feel too much, too soon.

## 4. The Import screen is now redundant

Starting weights are seeded directly (see [decisions.md](decisions.md)). The importer
still works and is reachable from More → Import. It can be removed, but note the
`importedWeights` table and zod schema are part of the backup format — removing those
needs a schema version bump. The project is under git, so removal is recoverable from history.
