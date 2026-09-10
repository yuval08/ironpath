# Ironpath — refactor + 14-Week Hypertrophy program

**Branch:** `ironpath-hypertrophy-14wk`

This is the single source of truth every agent builds against. Do NOT invent contracts;
if something here is wrong, report it, do not silently diverge.

## Goal

The app becomes **Ironpath**, a multi-program workout tracker. The existing
"Movement & Joint Resilience" 4-week block stays as a *selectable program* with its
history intact. A new **14-Week Hypertrophy — Upper / Lower** program (2 reload weeks +
12 hypertrophy weeks + 1 deload week = 15 stored weeks) becomes the default active plan.

Reuse the existing architecture. Do not rebuild. Do not create parallel duplicate systems.

## Hard rules

- Dexie database name stays `movement-resilience`. Renaming it orphans real data. Comment why.
- No deadlift variation of any kind, ever.
- No strict pull-up singles, no "max pull-up test" prescriptions.
- Progression is performance-based double progression, never calendar-driven, never auto-applied.
- Session length target 45–55 min. General warm-up happens OUTSIDE the app timer.
- Mobile-first, large touch targets, minimal typing. PWA/offline stays working.
- Every persisted shape change goes through `SCHEMA_VERSION` + `src/db/migrations.ts` and must be
  backward compatible with v1 rows.

## Ownership map (do NOT edit files you do not own)

| Agent | Owns |
|---|---|
| foundation (wave 1, runs alone) | `src/types/index.ts`, `src/db/db.ts`, `src/db/migrations.ts`, `src/db/repository.ts`, `src/state/AppDataProvider.tsx`, `src/db/repository.test.ts`, `src/test/factories.ts`, empty `src/styles/workout.css` + `src/styles/shell.css` stubs imported from `index.css` |
| program | `src/data/**` (programs/, exercises.ts, substitutions.ts, exerciseVideos.ts, program.test.ts) |
| engine | `src/utils/doubleProgression.ts` (new), `src/utils/progression.ts`, `src/utils/stats.ts` + their tests |
| workout-ui | `src/components/**`, `src/screens/WorkoutScreen.tsx`, `src/styles/workout.css` |
| shell | `src/App.tsx`, `src/main.tsx`, `src/screens/{Dashboard,PlanScreen,ProgressScreen,MoreScreen,SettingsScreen,PullUpScreen,ImportScreen,FinalAssessmentScreen}.tsx`, `src/styles/shell.css`, `index.html`, `vite.config.ts`, `package.json`, `public/**`, `README.md` |
| export | `src/utils/{excelExport,excelImport,backup}.ts` + their tests |

`src/styles/index.css` is owned by nobody — add new styles to `workout.css` / `shell.css`.
`e2e/` is the lead's.

---

## 1. Schema v2 (`src/types/index.ts`)

`SCHEMA_VERSION = 2`.

Additions/widenings — all backward compatible:

```ts
export const programIdSchema = z.enum(['movement-resilience', 'hypertrophy-14wk']);
export type ProgramId = z.infer<typeof programIdSchema>;

export const weekPhaseSchema = z.enum(['base', 'reload', 'hypertrophy', 'deload']);
export const exerciseRoleSchema = z.enum(['prep', 'main', 'accessory', 'finisher']);
export const progressionTypeSchema = z.enum(['double', 'bandAssist', 'reps', 'time', 'fixed']);
```

**WorkoutDay / WeekPlan** — `weekNumber` widen `.min(1).max(52)`.
**WeekPlan** adds:
- `phase: weekPhaseSchema.default('base')`
- `blockWeek: z.number().int().nullable().default(null)` — 1..12 inside the hypertrophy block, else null
- `pushUpGoalLow` / `pushUpGoalHigh` become `.optional()`

**WorkoutPlan**:
- `currentWeek: z.number().int().min(1)` (drop `.max(4)`)
- `programId: programIdSchema.default('movement-resilience')`
- `archived: z.boolean().default(false)`

**ExercisePrescription** adds:
- `slot: z.string().optional()` — `'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'`
- `supersetKey: z.string().optional()` — prescriptions sharing this key are one superset
- `role: exerciseRoleSchema.default('accessory')`
- `progressionType: progressionTypeSchema.default('fixed')`
- `targetRirLow: z.number().nullable().default(null)`
- `targetRirHigh: z.number().nullable().default(null)`
- `weightIncrement: z.number().nullable().default(null)` — load step suggested on progression,
  in the unit the plan was built in (the app defaults to lb; nothing converts stored weights)
- `rampSets: z.number().int().default(0)` — optional non-working ramp sets

**SetResult** adds:
- `isWarmUp: z.boolean().default(false)`

**UserSettings** adds:
- `activePlanId: z.string().nullable().default(null)`
- `bandLabels: z.record(bandResistanceSchema, z.string()).default(DEFAULT_BAND_LABELS)` — user-editable band names

```ts
export const DEFAULT_BAND_LABELS: Record<BandResistance, string> = {
  extraHeavy: 'Extra heavy (most assistance)',
  heavy: 'Heavy',
  medium: 'Medium',
  light: 'Light',
  extraLight: 'Extra light',
  none: 'No band (bodyweight)',
};
```

**backupFileSchema**: `app: z.union([z.literal('movement-resilience'), z.literal('ironpath')])`.
New exports write `'ironpath'`; old files still import.

**personalRecordKindSchema** adds `'assistedPullUpBestBand'` is NOT needed — skip. Leave the enum as is.

## 2. Migration to v2 (`src/db/migrations.ts`)

One `{ to: 2 }` entry. `migrateRecord` runs over EVERY table, so the migration must sniff the
row shape rather than blindly spreading:

- row has `weeks` array → it's a plan: add `programId ?? 'movement-resilience'`, `archived ?? false`,
  and map each week to add `phase ?? 'base'`, `blockWeek ?? null`, and each prescription to add
  `role ?? 'accessory'`, `progressionType ?? 'fixed'`, `targetRirLow/High ?? null`,
  `weightIncrement ?? null`, `rampSets ?? 0`.
- row has `results` array → it's a session: map every `results[].sets[]` to add `isWarmUp ?? false`.
- row has `weightUnit` → it's settings: add `activePlanId ?? null`, `bandLabels ?? DEFAULT_BAND_LABELS`.

Everything else passes through untouched.

`db.ts` gets a `.version(2).stores({...})` block; `plans` index becomes
`'id, startDate, currentWeek, programId, archived'`, all other stores unchanged.

## 3. Multi-plan repository (`src/db/repository.ts`)

New / changed API:

```ts
export async function getPlans(): Promise<WorkoutPlan[]>;
export async function getPlan(): Promise<WorkoutPlan | undefined>;      // the ACTIVE plan
export async function getPlanById(id: string): Promise<WorkoutPlan | undefined>;
export async function setActivePlan(planId: string): Promise<void>;     // writes settings.activePlanId
export async function createPlanFromProgram(programId: ProgramId, startDate?: string): Promise<WorkoutPlan>;
export async function archivePlan(planId: string, archived: boolean): Promise<void>;
export async function deletePlan(planId: string): Promise<void>;        // + its sessions, in one txn
export async function updatePlan(patch: Partial<WorkoutPlan>): Promise<void>;  // active plan
export function totalSessionsFor(plan: WorkoutPlan): number;            // weeks * days
```

Active-plan resolution: `settings.activePlanId` → else first non-archived plan → else first plan.

`ensureSeeded()`:
- creates settings as today, plus `activePlanId: null`, `bandLabels: DEFAULT_BAND_LABELS`
- if there are **no** plans: create the `hypertrophy-14wk` plan and set it active
- if plans exist but none has `programId === 'hypertrophy-14wk'` **and** meta key
  `ironpathPlanSeeded` is unset: create the hypertrophy plan (non-destructive — the old plan and
  all its sessions stay), set it active, set the meta key. Never runs twice.
- still fully transactional + re-checked after acquiring the transaction (StrictMode / two tabs).

`createSession(plan, day, weightOverrides)`:
- warm-up items come from `programFor(plan.programId).warmUp` (NOT the global `WARM_UP` import)
- for each prescription, emit `rampSets` sets with `isWarmUp: true` FIRST (setNumber 1..n),
  then `sets` working sets. `plannedSets` stays the WORKING set count.

`completeSession`: last-week check becomes `plan.currentWeek >= plan.weeks.length`.

`applyResumeChoice('restartBlock')`: **must scope deletions to the active plan's ids** — it
currently calls `db.sessions.clear()` / `db.suggestions.clear()`, which would now wipe another
program's history. Same for `restartWeek` (already dayId-scoped, keep).

`AppDataProvider` exposes `plans: WorkoutPlan[]` alongside `plan` (active), resolves the active
plan through settings, and keeps `sessions` unfiltered (screens filter by `planId` themselves;
export needs them all).

## 4. Program registry (`src/data/programs/`)

```ts
// src/data/programs/index.ts
export interface ProgramDefinition {
  id: ProgramId;
  name: string;              // '14-Week Hypertrophy — Upper / Lower'
  shortName: string;         // 'Hypertrophy 14'
  description: string;
  weekCount: number;
  daysPerWeek: number;
  warmUp: WarmUpItem[];      // [] for hypertrophy — general warm-up is done outside the app
  dayLabels: Record<DayType, string>;
  buildWeeks: () => WeekPlan[];
}
export const PROGRAMS: Record<ProgramId, ProgramDefinition>;
export function programFor(id: ProgramId): ProgramDefinition;   // falls back to movement-resilience
export const DEFAULT_PROGRAM_ID: ProgramId = 'hypertrophy-14wk';
```

- `src/data/programs/movementResilience.ts` — the current `src/data/program.ts`, moved verbatim
  (plus `role`/`progressionType` defaults on its prescriptions). `src/data/program.ts` is deleted;
  update every importer.
- `src/data/programs/timing.ts` — `estimateSessionMinutes`, `supersetGroups`, `WarmUpItem`,
  shared by both programs. Ramp sets add `rampSets * 25s` to a group.
- `src/data/programs/hypertrophy14.ts` — the new program (section 6).

## 5. Double-progression engine (`src/utils/doubleProgression.ts`, new)

Pure, no React, no Dexie. Exact API (workout-ui, shell and export all consume this):

```ts
export const BAND_LADDER: BandResistance[]; // ['extraHeavy','heavy','medium','light','extraLight','none'] — descending assistance
export function nextLighterBand(b: BandResistance): BandResistance | null;

export function workingSets(result: ExerciseResult): SetResult[];       // sets.filter(s => !s.isWarmUp)
export function rampSetsOf(result: ExerciseResult): SetResult[];

export interface PerformanceSnapshot {
  date: string;
  weight: number | null;
  band: BandResistance | null;
  reps: number[];
  rir: (number | null)[];
}
export function snapshotFor(session: WorkoutSession, result: ExerciseResult): PerformanceSnapshot;
export function lastPerformance(sessions: WorkoutSession[], exerciseId: string): PerformanceSnapshot | null;
export function performanceHistory(sessions: WorkoutSession[], exerciseId: string): PerformanceSnapshot[];
export function formatPerformance(s: PerformanceSnapshot | null, unit: string, bandLabels?: Record<BandResistance,string>): string;
//   '32 kg · 10 / 9 / 8 · RIR 2 / 1 / 1'   |   'Medium band · 9 / 8 / 8'   |   'No history yet'

export type ProgressionStatus = 'ready' | 'hold' | 'noData';
export interface ProgressionVerdict {
  status: ProgressionStatus;
  kind: 'weight' | 'assistance' | 'reps' | 'none';
  /** 'Ready to increase load next session' | 'Ready to reduce band assistance' */
  message: string;
  suggestedWeight: number | null;   // currentWeight + weightIncrement
  suggestedBand: BandResistance | null;
}
export function evaluateDoubleProgression(
  prescription: ExercisePrescription,
  result: ExerciseResult | null | undefined,
): ProgressionVerdict;
```

Readiness gate (double / bandAssist):
1. `result` exists, not skipped, `formGood !== false`
2. `workingSets(result).length >= prescription.sets` and every working set `completed`
3. every working set's rep count (`reps`, or `min(repsLeft, repsRight)` when `perSide`) `>= repsHigh`

RIR does **not** gate readiness — hitting the top of the range at a high RIR argues *more* strongly
for a load increase, not less. RIR only colours the message.

Nothing here mutates. Nothing auto-applies. The user confirms the new load.

`src/utils/progression.ts` keeps the existing suggestion pipeline but:
- ignores warm-up sets everywhere
- for `progressionType: 'double' | 'bandAssist'` prescriptions, uses `evaluateDoubleProgression`
  instead of the RPE≤7 / two-clean-sessions heuristic, and needs only **one** qualifying session
- a suggestion for an exercise may be **re-raised** once a qualifying session occurs strictly
  after an existing accepted/dismissed suggestion's `detectedAt` (otherwise a user could only ever
  be told to add weight once per exercise, forever). Pending suggestions still suppress duplicates.
- `detectProgressions` needs the plan/day prescriptions to know the type — change its signature to
  `detectProgressions(sessions, existing, plan?)` and resolve the prescription from the plan by
  `session.dayId` + `result.prescriptionId`. Falling back to the old heuristic when no plan is given
  keeps the existing tests meaningful.

## 6. `src/data/programs/hypertrophy14.ts`

**Name:** `14-Week Hypertrophy — Upper / Lower`. 15 stored weeks.

| weekNumber | phase | blockWeek | title |
|---|---|---|---|
| 1 | reload | null | `Reload Week 1 — Technique & Load Reintroduction` |
| 2 | reload | null | `Reload Week 2 — Establish Starting Loads` |
| 3–14 | hypertrophy | 1–12 | `Hypertrophy Week {blockWeek}` |
| 15 | deload | null | `Deload Week — Recover & Reset` |

Four training days, weekday-mapped: monday=`upperA`, tuesday=`lowerA`, thursday=`upperB`,
friday=`lowerB`. `warmUp: []`.

Set scaling by phase, applied to a single canonical template (no duplicated week data):

| phase | main (`role: 'main'`) | accessory / prep / finisher | target RIR |
|---|---|---|---|
| reload (wk 1) | `min(base, 2)` | `min(base, 2)` | 3 |
| reload (wk 2) | `base` | `min(base, 3)` | 2–3 |
| hypertrophy | `base` | `base` | 1–2 (isolation last set may reach 0–1) |
| deload (wk 15) | `min(base, 2)` | `min(base, 2)` | 3 |

Ramp sets are only offered from reload week 2 onward (`rampSets` as listed below), and are
suppressed in reload week 1 where loads are deliberately conservative.

Guidance strings per phase go in `WeekPlan.guidance` and must state the RIR rule and, for
reload week 1, "do not reduce band assistance this week even if the reps feel easy".

### Monday — Upper A · Pull-Up + Chest Emphasis (`upperA`)

| slot | exercise | role | sets | reps | rest s | ramp | progression | RIR |
|---|---|---|---|---|---|---|---|---|
| — | `scapular-pull-up` | prep | 2 | 8–12 | 60 | 0 | reps | — |
| A1 | `band-assisted-pull-up` | main | 3 | 6–10 | 0 | 0 | bandAssist | 1–2 |
| A2 | `incline-dumbbell-press` | main | 5 | 6–10 | 90 | 1 | double | 1–2 |
| B1 | `chest-supported-row` | accessory | 3 | 8–12 | 0 | 0 | double | 1–2 |
| B2 | `cable-lateral-raise` | accessory | 3 | 12–20 | 70 | 0 | double | 1–2 |
| — | `cable-face-pull` | accessory | 2 | 12–20 | 60 | 0 | double | 2–3 |
| — | `cable-crunch` | finisher | 3 | 10–15 | 45 | 0 | double | 1–2 |

`incline-dumbbell-press` substitutes to `incline-smith-press`.
`cable-lateral-raise` substitutes to `dumbbell-lateral-raise`.
Superset A pairs only its first 3 rounds (derived: `min(sets)` across the group); the remaining
2 incline-press sets are performed straight, with 90 s rest.

### Tuesday — Lower A · Smith Squat Emphasis (`lowerA`)

| slot | exercise | role | sets | reps | rest s | ramp | progression | RIR |
|---|---|---|---|---|---|---|---|---|
| — | `smith-machine-squat` | main | 3 | 6–10 | 135 | 2 | double | 1–2 |
| B1 | `seated-leg-curl` | accessory | 4 | 10–15 | 0 | 0 | double | 1–2 |
| B2 | `leg-extension` | accessory | 3 | 10–15 | 85 | 0 | double | 1–2 |
| C1 | `hip-thrust` | accessory | 3 | 8–12 | 0 | 0 | double | 1–2 |
| C2 | `standing-calf-raise` | accessory | 3 | 10–15 | 90 | 0 | double | 1–2 |
| — | `tibialis-raise` | finisher | 2 | 15–20 | 45 | 0 | reps | — |

Smith squat is **never** supersetted (no `supersetKey`).
`seated-leg-curl` substitutes to `lying-leg-curl`.

### Thursday — Upper B · Pull-Up + Shoulder Emphasis (`upperB`)

| slot | exercise | role | sets | reps | rest s | ramp | progression | RIR |
|---|---|---|---|---|---|---|---|---|
| — | `scapular-pull-up` | prep | 2 | 8–12 | 60 | 0 | reps | — |
| A1 | `band-assisted-pull-up` | main | 3 | 6–10 | 0 | 0 | bandAssist | 1–2 |
| A2 | `seated-dumbbell-shoulder-press` | main | 3 | 6–10 | 90 | 1 | double | 1–2 |
| B1 | `neutral-grip-lat-pulldown` | accessory | 3 | 8–12 | 0 | 0 | double | 1–2 |
| B2 | `flat-dumbbell-press` | main | 5 | 6–10 | 90 | 0 | double | 1–2 |
| — | `cable-lateral-raise` | accessory | 3 | 12–20 | 60 | 0 | double | 1–2 |
| — | `captains-chair-leg-raise` | finisher | 3 | 10–15 | 45 | 0 | reps | — |

`flat-dumbbell-press` substitutes to `chest-press-machine`; first 3 rounds pair with the pulldown,
last 2 are straight sets.
`captains-chair-leg-raise` substitutes to `lying-leg-raise`. No hanging leg raises.

### Friday — Lower B · Leg Press Emphasis (`lowerB`)

| slot | exercise | role | sets | reps | rest s | ramp | progression | RIR |
|---|---|---|---|---|---|---|---|---|
| — | `leg-press` | main | 3 | 6–10 | 135 | 2 | double | 1–2 |
| B1 | `supported-split-squat` | accessory | 2 | 8–12 per side | 0 | 0 | double | 2 |
| B2 | `seated-leg-curl` | accessory | 4 | 10–15 | 85 | 0 | double | 1–2 |
| C1 | `hip-thrust` | accessory | 3 | 8–12 | 0 | 0 | double | 1–2 |
| C2 | `standing-calf-raise` | accessory | 3 | 10–15 | 90 | 0 | double | 1–2 |
| — | `tibialis-raise` | finisher | 2 | 15–20 | 45 | 0 | reps | — |

`supported-split-squat` uses `entryStyle: 'repsPerSide'`, `perSide: true`, substitutes to `step-up`
(never reverse lunges), and is marked `optional: true` — it is the documented first set to drop if
sessions consistently run past 55 minutes. Say so in its `notes`.
Leg press is **never** supersetted.

### Weekly volume this must produce (assert in `program.test.ts`)

chest 10 · back/lats 12 (scapular pull-ups excluded) · lateral delts 6 · quads 10–11 ·
hamstrings 8 · calves 6 · tibialis 4 · abs 6. No direct arm work at launch.

Also assert: no exercise id matching `/deadlift|rdl/i` anywhere in the program; no
`strict-pull-up` / `chin-up` prescription; every day's `estimatedMinutes` ≤ 55 in every phase;
every superset group's non-final member has `restSeconds === 0`.

### New exercise definitions needed in `src/data/exercises.ts`

`incline-dumbbell-press`, `incline-smith-press`, `chest-supported-row`, `cable-lateral-raise`,
`dumbbell-lateral-raise`, `cable-face-pull`, `cable-crunch`, `smith-machine-squat`,
`seated-leg-curl`, `lying-leg-curl`, `leg-extension`, `leg-press`,
`seated-dumbbell-shoulder-press`, `neutral-grip-lat-pulldown`, `flat-dumbbell-press`,
`chest-press-machine`, `captains-chair-leg-raise`, `lying-leg-raise`.

Already present, reuse as-is: `scapular-pull-up`, `band-assisted-pull-up`, `hip-thrust`,
`standing-calf-raise`, `tibialis-raise`, `supported-split-squat`, `step-up`.

Follow the existing `Draft` shape exactly: full `instructions`, `commonMistakes`, `safetyNotes`,
`targets`, correct `entryStyle` / `loadType` (`machine` for cable & machine work, `dumbbell` for DBs,
`bodyweight` for the leg raises), `isNewMovement: true`. Add `searchTerms` and add a
`exerciseVideos.ts` entry (search URL, `verified: false`) for each new id.

## 7. Workout UI (`workout-ui`)

- **Superset rendering**: group by `supersetKey`; header reads `Superset A · rest 90 s after both`.
  Each card shows its `slot` badge (`A1`, `A2`). After completing a set of a non-final member,
  show an inline `Next: {name of the next slot}` hint and do **not** start the rest timer.
  After the final member's set, start the programmed rest. `restSeconds === 0` already means
  "no rest here" — keep that as the mechanism.
- Once a superset group's paired rounds (`min(sets)` across the group) are done, render a
  `Remaining {n} sets — straight sets` divider inside the longer exercise's card.
- **Ramp sets**: rendered above the working sets under a `Ramp — not counted` label, visually muted,
  excluded from the `x/y` counter and from `sessionProgress`. Weight/reps optional.
- **Set entry**: reps, weight, RIR and completed must all be reachable for loaded exercises. The
  current `fieldsFor` drops RIR for loaded `reps` exercises — add RIR back so the hypertrophy
  program can record it (keep RPE for the resilience program's exercises).
- **History line** on every card: `Last session: 32 kg · 10 / 9 / 8 · RIR 2 / 1 / 1` and
  `Target: 6–10 @ RIR 1–2`, via `lastPerformance` / `formatPerformance`.
- **Progression banner**: when `evaluateDoubleProgression` on the previous session returns `ready`,
  show `Ready to increase load next session` (or `Ready to reduce band assistance`) with a
  one-tap "apply to this session" that only prefills the set weights/band — never rewrites history.
- **Band picker** on `band-assisted-pull-up`: a select of `BAND_LADDER` labelled with
  `settings.bandLabels`. Every option needs a non-empty `value`.
- **Warm-up section**: when the program's `warmUp` is empty, render a single
  `Start workout` card instead of a checklist, and note that the general warm-up is done outside.
- New styles go in `src/styles/workout.css`.

## 8. Shell / screens (`shell`)

- Rename everywhere user-facing: **Ironpath**. `index.html` title/meta, PWA manifest
  (`name: 'Ironpath'`, `short_name: 'Ironpath'`), `package.json` name `ironpath`, README.
  Keep the theme colours and the existing icon files. Dexie DB name is NOT renamed.
- **Plan switcher**: Plan screen (and Settings) lists all plans with program name, week progress,
  and lets the user switch active plan, start a fresh plan from any program in `PROGRAMS`,
  archive, or delete (with a typed confirmation, since deleting drops its sessions).
- `PlanScreen` must render 15 weeks with phase badges (`Reload`, `Hypertrophy W7`, `Deload`) and
  stop assuming 4 weeks / 5 days anywhere.
- `Dashboard` shows: today's day, active plan + week label, workout duration of the last session,
  the 45–55 min target, and pending progression suggestions.
- `ProgressScreen` adds, alongside what exists: per-exercise weight & rep progression over time,
  band-assistance ladder for `band-assisted-pull-up` (`Heavy → Medium → Light → …`), RIR trend,
  workout duration trend, completion, and per-session pain flags. Filter to the active plan.
- Bodyweight: keep the existing per-session `bodyweight` field, and add a 7-day rolling average
  to the progress screen. Do not couple it to progression.
- Pain/joint: keep `PainScale`; flag visually when knee / lower back / shoulder rises materially
  above the trailing average. Do not diagnose.
- Anything currently hardcoded to `TOTAL_SESSIONS = 20` uses `totalSessionsFor(plan)`.
- `PullUpScreen` must stop talking about strict pull-up singles for the hypertrophy plan; it
  becomes the band-assistance progression view. Keep the resilience behaviour when that plan
  is active.
- New styles go in `src/styles/shell.css`.

## 9. Export (`export`)

Keep every existing capability. Per-set rows must carry: program name, program week number,
week label/phase, date, weekday + day title, superset slot, exercise, set number, set type
(`Ramp`/`Work`), weight, reps (incl. per-side), band label, RIR, RPE, completed, notes.
Session rows carry workout duration and the pain/joint entries. Backup JSON writes
`app: 'ironpath'` and imports both literals. Excel import keeps working against old files.

## 10. Definition of done

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all clean; `npm run e2e` green.
Verified: old data still loads · new plan selectable · reload weeks 1–2 · hypertrophy 1–12 ·
deload 15 · no strict pull-ups · no deadlifts · band progression · double progression ·
superset navigation · RIR recorded · previous values visible · timers work · 45–55 min ·
abs on both upper days · export works · PWA installable.
