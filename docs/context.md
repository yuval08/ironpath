# Context

## What this is

A four-week "Movement & Joint Resilience" training block, tracked in a local-first PWA.
It is a **bridge phase** before a four-day hypertrophy routine — not a strength program
in its own right. Everything about the design follows from that.

## The person using it

Non-obvious facts that constrain the program. These came from the owner directly and are
not derivable from the code:

- **Knee sensitivity.** Could not tolerate reverse lunges. Depth on any squat pattern is
  dictated by comfort, never by a standard.
- **History of lower-back flare-ups.** Hence no conventional deadlifts and no heavy
  spinal loading anywhere in the block.
- **Recently completed the first strict pull-up of their life.** Pull-up progress is a
  headline goal, and the four-week target of 3–5 clean reps is displayed as a _target,
  not a promise_.
- Already does ~15 min of stretching plus the McGill Big Three most mornings.
  **That is deliberately not in the app** — it would double-count and inflate session time.
- Works at a farm on weekends. **Not tracked as a workout**; Sat/Sun are rest days.
- Trains Monday–Friday, ~60 minutes per gym session.
- Previous training logged in `../workout_tracker_12wk.xlsx` (12-week upper/lower/full
  split). Its `Bodyweight (kg)` header is the only reliable statement of units — **the
  loads are kg**.

## Device and units

- **Samsung Galaxy S22, Android Chrome.** This matters: `navigator.vibrate` works, so the
  rest timer buzzes; `navigator.storage.persist()` is auto-granted once installed. The iOS
  caveats scattered through the code comments do not apply to this user.
- **Units are kg** throughout.

## Programming constraints (hard requirements)

These are encoded in `src/data/program.ts` and asserted by tests in `program.test.ts`:

| Constraint                            | Where enforced                                                    |
| ------------------------------------- | ----------------------------------------------------------------- |
| No conventional deadlifts             | Test: "never programs a conventional deadlift or a reverse lunge" |
| No reverse lunges                     | Same test                                                         |
| No heavy spinal loading               | Goblet squat only; hip thrust instead of loaded squats            |
| ~60 min per session                   | `estimatedMinutes` ≤ 60, asserted per day                         |
| Supersets throughout                  | Encoded as `restSeconds: 0` on the first item of each pair        |
| Low-moderate load, higher reps        | 8–25 rep ranges, 2–3 reps in reserve                              |
| Substitution for every risky movement | `src/data/substitutions.ts`                                       |

## Why the Excel import exists but is no longer used

The original spec asked for an importer that reads a previous tracker and suggests
40–60% starting loads. It was built (`src/utils/excelImport.ts`, `ImportScreen.tsx`) and
works, but the owner correctly rejected it in practice: a fuzzy name matcher translating
across movement patterns produced nonsense — a 145 kg box squat became a _72.5 kg goblet
squat_, a barbell deadlift became a load for a bodyweight single-leg RDL.

**Starting weights are now seeded directly in `program.ts`** with judgement applied.
See [decisions.md](decisions.md#starting-weights-are-seeded-not-derived).

The import code is still present and tested, and is reachable from More → Import. It is
optional. If it is ever removed, note that the `importedWeights` Dexie table and its zod
schema are referenced by the backup format — leave those in place or bump the schema
version.
