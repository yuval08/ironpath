# JSON plan import standard

Use **Settings → Your plans → Import plan from JSON** and select a UTF-8 `.json`
file, at most 1 MiB. The same control is available on the Plan screen.
A successful import creates a new, active plan, starting on the next Monday at
week 1. Existing plans and workout history are retained. Reimporting creates
another independent plan; it does not update the previous import.

This is a **program definition**, not an app backup. Use **Import JSON backup**
only for exported full-device backups (that operation replaces local data).
Imported plans, their warm-up checklists, and progress key lifts are included in
normal JSON backups. Imports are snapshots and do not receive built-in program
updates. Set your weight unit before importing; it is locked while imported plans
remain on the device because load steps are compiled in that unit.

## Generate a file

1. Copy [plan-import-example.json](plan-import-example.json), or the more extensive
   [built-in hypertrophy definition](../src/data/programs/definitions/hypertrophy-14wk.json).
2. Choose exercise IDs from [the exercise library](../src/data/exercises.ts).
   Use the exact `id`, not the display name. See [supported IDs](exercise-ids.md) for the full list and accepted aliases. Custom exercise definitions are not supported.
3. Define one canonical training week in `days`, then its phases in `weeks`.
4. Save as JSON with double quotes, no comments, and no trailing commas.
5. Import the file. Errors identify the invalid field or exercise; failed imports
   save nothing. Check the Plan screen before starting training.

For an AI generator, give it this document, the example, and the exercise library.
Ask for a single JSON object matching this format, using only library IDs and
supported enums. Do not ask it to generate database rows or workout history.

The strict field definitions live in
[`programSchema.ts`](../src/data/programs/programSchema.ts). Unknown fields are
rejected; field names and enum values are case-sensitive. There is no file
`schemaVersion` field in this format. The example is checked by automated tests.

## Root fields

| Field               | Required / default        | Meaning                                                                                             |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                | Required nonempty string  | Source identifier; import replaces it with an isolated custom-program identity.                     |
| `idPrefix`          | Required nonempty string  | Source prefix; import generates isolated day/prescription IDs.                                      |
| `name`, `shortName` | Required nonempty strings | Full and compact plan names.                                                                        |
| `description`       | Required string           | Plan description; empty is allowed.                                                                 |
| `loadSteps`         | Required object           | Both `kg` and `lb` maps, even if empty: `{"kg":{},"lb":{}}`. Named values must be positive numbers. |
| `days`              | Required nonempty array   | Canonical training days, in workout order. At most five days.                                       |
| `weeks`             | Required nonempty array   | Phase schedule, expanded in array order; at most 52 weeks including repeats.                        |
| `warmUp`            | `[]`                      | Checklist objects: unique nonempty `id`, nonempty `label`, optional library `exerciseId`.           |
| `keyLifts`          | `[]`                      | Library IDs to summarize in Progress, in display order. Each must be prescribed in `days`.          |
| `timing`            | `{}`                      | Session estimate settings, described below.                                                         |

Do not supply stored-plan fields such as `currentWeek`, `programId`, `startDate`,
`recommendedWeight`, `sessions`, or `builtFingerprint`.

## Training days and blocks

Each day requires `weekday`, `dayType`, `title` (nonempty), `focus` (string), and
`blocks` (nonempty array). Allowed weekdays: `monday`, `tuesday`, `wednesday`,
`thursday`, `friday`. Each weekday must be unique. Weekend days are unsupported.

Allowed `dayType` keys: `upperA`, `lowerA`, `mobility`, `upperB`, `lowerB`.
Each may appear once. These are internal slots: use `title` to label the actual
workout. Days run in array order; put them in calendar order for a normal schedule.

Each block requires a nonempty `key`, nonempty `label`, and nonempty `exercises`
array. Keys must be unique within the day. A day may contain at most 100 exercise
entries. `superset` defaults to `false`. `restSeconds` is optional on straight-set
blocks if every exercise provides its own rest.

### Rest times and supersets

- All rest values are nonnegative **integer seconds**. Zero means no rest.
- Straight sets: exercise `restSeconds` overrides block `restSeconds`. At least
  one must be provided for every exercise. These explicit rests take precedence
  over the default-rest setting.
- Supersets: set `superset: true`, include at least two exercises, and put
  `restSeconds` **only on the block**. Member rest fields are rejected, even zero.
- Superset members are performed in array order. The app generates slots such as
  `A1`, `A2`, `A3`, sets intermediate member rest to zero, and uses block rest
  after the round. Two, three, or more members are supported. Separate supersets
  need separate block keys. Member set counts may differ; equal counts provide
  the clearest round structure.
- Use separate straight-set blocks when consecutive zero-rest exercises should
  not visually chain together. The app groups zero-rest runs within a block.

## Exercise fields

| Field          | Required / default           | Meaning                                                                                                |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `exercise`     | Required                     | Exact exercise-library ID.                                                                             |
| `sets`         | Required                     | Integer 1–50 working sets.                                                                             |
| `reps`         | At least `reps` or `seconds` | `[low, high]`, nonnegative integers, low ≤ high. Fixed target: `[10,10]`.                              |
| `seconds`      | At least `reps` or `seconds` | Duration `[low, high]` in nonnegative integer seconds. Required for timed entry styles.                |
| `entryStyle`   | `"reps"`                     | `reps`, `repsPerSide`, `time`, `timePerSide`, `distance`, `stepsPerDirection`, or `treadmill`.         |
| `perSide`      | `false`                      | Marks per-side work and doubles its work-duration estimate. Set explicitly with per-side entry styles. |
| `restSeconds`  | Inherit block                | Straight sets only; see above.                                                                         |
| `role`         | `"accessory"`                | `prep`, `main`, `accessory`, `finisher`; controls which weekly set cap applies.                        |
| `progression`  | `"fixed"`                    | `double`, `bandAssist`, `reps`, `time`, `fixed`.                                                       |
| `rir`          | `null`                       | Target reps in reserve `[low, high]`, nonnegative numbers, low ≤ high.                                 |
| `loadStep`     | `null`                       | Named load increment; must exist in **both** unit maps.                                                |
| `rampSets`     | `0`                          | Integer 0–20 non-working ramp sets before working sets.                                                |
| `band`         | Omitted                      | `none`, `extraLight`, `light`, `medium`, `heavy`, `extraHeavy`.                                        |
| `optional`     | `false`                      | Marks an optional exercise.                                                                            |
| `notes`        | Omitted                      | Plain-text coaching notes.                                                                             |
| `alternatives` | `[]`                         | Library IDs added to the exercise's normal substitutions.                                              |

For loaded exercises, use `progression: "double"`, `reps`, `rir`, and a named
`loadStep`. Load increments are equipment steps, not unit conversions. For example,
`"dumbbell": 2` in kg and `"dumbbell": 5` in lb. Actual working weights are entered
in the workout; this format does not prefill weights.

For assisted pull-ups, use `bandAssist` and `band`. For holds, use `entryStyle:
"time"`, `seconds`, and optionally `progression: "time"`. Reps/seconds are numeric
ranges, never strings such as `"8-12"` or `"30s"`.

Distance and treadmill entries can be logged, but this definition format has no
prescribed-distance, treadmill speed/incline, or minutes fields. It still requires
`reps` or `seconds`; use `seconds` for a duration estimate and explain other targets
in `notes`. Tempo has no dedicated field here; put tempo instructions in `notes`.
Library metadata, exercise videos, and app substitutions remain available.

## Week schedule and deloads

Each week entry requires `phase`, nonempty `title`, and `focus` (string).

| Field      | Default                      | Meaning                                                                                                                     |
| ---------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `phase`    | Required                     | `base`, `reload`, `hypertrophy`, or `deload`. A label alone does not change sets or effort.                                 |
| `repeat`   | One week                     | Positive integer; repeats the canonical week. `{n}` in the title becomes 1, 2, … inside this entry.                         |
| `guidance` | `[]`                         | Array of coaching strings.                                                                                                  |
| `setCap`   | `{"main":null,"other":null}` | Positive integer caps or null; `main` applies to main-role exercises, `other` to all other roles. Caps never increase sets. |
| `rir`      | `null`                       | Replaces exercise RIR targets for this phase **only where the exercise already has a non-null RIR**.                        |
| `rampSets` | `true`                       | False suppresses all ramp sets for this phase.                                                                              |

The same days and exercises repeat across phases. This format does not support
entirely different exercise menus for individual weeks. Use set caps and RIR for
reload/deload changes; for different menus, import separate plans.

## Timing estimates

Optional `timing` fields: `secondsPerRep` (positive number, default 3),
`transitionSeconds` (nonnegative number, default 30), and `intraSupersetSeconds`
(nonnegative number, default 0). These affect estimated session duration;
`intraSupersetSeconds` does not start a rest timer between superset members.
Estimates use the top rep/duration target, include prescribed rest and ramps,
and exclude the warm-up checklist.
