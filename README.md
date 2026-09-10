# Ironpath

A mobile-first, installable PWA for tracking strength training. Works fully offline, stores
everything locally in IndexedDB, and exports the complete history to a formatted Excel workbook. No
backend, no login, no account.

Ironpath is **multi-program**. It ships with two programs, keeps a separate plan (and separate
history) for each, and lets you switch between them at any time:

| Program                                 | Length                       | What it is                                                                                                       |
| --------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **14-Week Hypertrophy — Upper / Lower** | 15 stored weeks, 4 days/week | 2 reload weeks → 12 hypertrophy weeks → 1 deload week, run on performance-based double progression. The default. |
| **Movement & Joint Resilience**         | 4 weeks, 5 days/week         | The original joint-first block: pull-up skill practice, push-up volume, single-leg work, a mobility day.         |

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command             | What it does                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server                                                         |
| `npm run build`     | Type-check then production build into `dist/`                           |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.app.json` — no emit, no stray `.js` in `src/` |
| `npm run preview`   | Serve the production build locally (needed to test the service worker)  |
| `npm run lint`      | ESLint                                                                  |
| `npm run format`    | Prettier                                                                |
| `npm test`          | Vitest unit tests                                                       |
| `npm run e2e`       | Playwright end-to-end tests (builds + previews automatically)           |
| `npm run icons`     | Regenerate the placeholder PWA icons in `public/icons/`                 |

The service worker only runs in a real build. To test install/offline behaviour:

```bash
npm run build && npm run preview
```

### Installing on a phone

- **Android / Chrome** — open the site, then menu → _Install app_ / _Add to Home screen_.
- **iPhone / Safari** — open the site, then Share → _Add to Home Screen_. iOS only registers service
  workers over HTTPS (or `localhost`), so host the build over HTTPS for offline use on iOS.

Once installed the app runs standalone, works with no network, and asks the browser for _persistent_
storage so the workout history is not evicted under storage pressure. Settings → Storage shows
whether persistence was granted.

---

## The 14-week hypertrophy program

Four training days a week, weekday-mapped, 45–55 minutes per session. Wednesday and the weekend are
rest days.

| Day      | Session                               | Focus                                              |
| -------- | ------------------------------------- | -------------------------------------------------- |
| Monday   | Upper A · Pull-Up + Chest Emphasis    | Assisted pull-ups, incline pressing, rows, delts   |
| Tuesday  | Lower A · Smith Squat Emphasis        | Squat pattern, hamstrings, quads, glutes, calves   |
| Thursday | Upper B · Pull-Up + Shoulder Emphasis | Assisted pull-ups, overhead pressing, lats, chest  |
| Friday   | Lower B · Leg Press Emphasis          | Leg press, split squat, hamstrings, glutes, calves |

Week structure: **1–2** reload (technique, then establishing starting loads) → **3–14** the twelve
hypertrophy weeks → **15** deload. Week phases drive set counts and target RIR; each week carries its
own guidance text.

Programming constraints baked into the seed data: **no deadlift variation of any kind**, no strict
pull-up singles and no max-rep pull-up tests, no reverse lunges, and a programmed substitution for
every movement that commonly provokes knee or shoulder pain. The general warm-up is done **outside**
the app so it never eats into the session timer.

### Double progression

Load is moved by your performance, never by the calendar and never automatically. An exercise is
ready to progress when, in a single session, every planned working set was completed with good form
and every one of them reached the **top** of its rep range. Ramp sets never count.

- Loaded exercises → the suggestion is one weight increment up.
- The assisted pull-up → the suggestion is one band lighter, walking down
  `Extra heavy → Heavy → Medium → Light → Extra light → No band`.

RIR deliberately does **not** gate readiness — hitting the top of the range at RIR 3 argues more
strongly for adding load, not less. It only colours the wording. You confirm every change.

### Bands

Band colours and resistances vary by manufacturer, so the six ladder positions are fixed but their
names are yours: Settings → **Band names**. Renaming never changes the progression order.

---

## Plans

The Plan screen (and Settings) lists every plan on the device with its program, week progress and
session count. From there you can:

- **switch** which plan you are training,
- **start a fresh plan** from any program, keeping everything already logged,
- **archive** a plan you are done with,
- **delete** a plan — behind a typed confirmation, because deleting a plan also deletes every session
  logged against it.

Workouts are never locked to calendar dates; the dates on the Plan screen are projections that skip
any active pause window.

---

## Feature map

| Screen               | What's there                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**        | Today's day, active plan + week label with phase badge, completion, last session's length against the 45–55 min target, pending progression suggestions, next session, pause status |
| **Plan**             | Plan switcher, every week with phase badges, per-day exercise lists with superset slots, resume/restart choices, pause manager, full prescription editing                           |
| **Workout**          | Superset-grouped cards, ramp sets, per-set logging with RIR, previous-session history line, progression banners, band picker, pain before/after, session + rest timers              |
| **Library**          | Every movement — instructions, common mistakes, safety notes, tempo, regression, progression, targets, video links, search and category filters                                     |
| **Progress**         | Completion, per-exercise weight & rep progression, band-assistance ladder, RIR trend, workout-duration trend, weekly volume, pain trends and flags, 7-day rolling bodyweight        |
| **Pull-Ups**         | Band-assistance ladder and assisted-pull-up progress on the hypertrophy plan; strict pull-up records and dead hang on the resilience plan                                           |
| **Settings**         | Plan switcher, name, kg/lb, theme, rest defaults, band names, video overrides, Excel export, JSON backup/restore, storage status, four levels of reset                              |
| **Import**           | Upload a previous Excel tracker, confirm detected exercise mappings, edit and apply suggested starting weights                                                                      |
| **Final Assessment** | End-of-plan test form plus an on-screen summary, included in the Excel export                                                                                                       |

### Pain tracking

Before and after every session: left/right knee, left/right shoulder, lower back, general fatigue,
each 0–10. Colour bands are 0–2 green, 3–4 yellow, 5+ red. The Progress screen flags a joint whose
latest score runs materially above **its own** trailing average. That is a description of your own
recorded numbers moving — the app never suggests a cause and never offers a diagnosis.

---

## Importing your old Excel tracker

More → _Import Old Excel Tracker_, or Settings → _Import old workout Excel_.

The parser is header-driven rather than layout-driven: on every sheet it looks for a row containing a
cell reading `Exercise`, then reads the `S1 Wt` / `S1 Reps` style columns beneath it. That handles
the bundled `workout_tracker_12wk.xlsx` (sheets `Wk01`–`Wk12`) and any tracker with a different
number of sets or extra columns.

For each detected exercise it takes the heaviest working weight seen, fuzzy-matches it to a library
movement, and suggests **50%** of that load as a starting point (rounded to the nearest 2.5). Every
mapping and weight is editable, nothing is applied until you confirm it, and confirmed weights remain
editable everywhere afterwards.

---

## Export and backup

Settings → _Export workout history to Excel_ produces `ironpath-workout-YYYY-MM-DD.xlsx`. Per-set
rows carry the program, program week number, week label and phase, date, weekday and day title,
superset slot, exercise, set number, set type (`Ramp` / `Work`), weight, reps, band, RIR, RPE,
completion and notes. Session rows carry the workout duration and the pain entries.

Every sheet has a frozen bold header row, an auto-filter, sensible column widths and number formats.
Days are separated by a tinted section row rather than merged cells, so filtering keeps working.

JSON backup (`ironpath-backup-YYYY-MM-DD.json`) round-trips everything — plans, sessions, records,
settings, suggestions, assessments and imported weights. Restoring **replaces** local data and is
validated with Zod first; an invalid or newer-schema file is rejected without touching what you
already have. Backups written before the rename still import.

---

## Replacing or verifying the YouTube video links

**Read this before trusting any video link in the app.**

Videos live in [`src/data/exerciseVideos.ts`](src/data/exerciseVideos.ts). Every shipped entry has
`verified: false` and points at a **YouTube search URL**, not a specific video. The UI labels those
buttons "Search YouTube" rather than "Watch video" precisely so that an unchecked link never
masquerades as a verified demonstration. Nothing is embedded; links always open externally.

### Option A — pin a video from inside the app (no code, survives rebuilds)

1. Settings → Videos → _Manage_.
2. Filter for the exercise, paste a YouTube URL, tap away from the field.
3. The override is stored in IndexedDB and is included in JSON backups. Clear the field to fall back
   to the default search link.

### Option B — edit the config file (ships with the app for everyone)

1. Open the search link, pick a clip from a creator you trust.
2. Replace that entry in `EXERCISE_VIDEOS`, setting `verified: true` only after you have watched it.
3. Re-run `npm run build`.

Preferred creators, already used in the search queries: Squat University, Tom Merrick (Bodyweight
Warrior), Strength Side, Precision Movement, Knees Over Toes Guy, Renaissance Periodization,
E3 Rehab, FitnessFAQs, Calisthenicmovement.

---

## Project structure

```
src/
  components/     ExerciseCard, SetRow, WarmUp, PainScale, BandPicker, HistoryLine,
                  ProgressionBanner, VideoLink, Charts, Sheet, PauseManager, …
  data/
    programs/     index.ts (registry) · hypertrophy14.ts · movementResilience.ts · timing.ts
    exercises.ts · exerciseVideos.ts · substitutions.ts
  db/             db.ts (Dexie) · repository.ts (all persistence) · migrations.ts
  hooks/          useTimers.ts (stopwatch + rest timer) · useTheme.ts
  screens/        Dashboard, Plan, PlanSwitcher, Workout, Library, Progress, More, Settings,
                  Import, FinalAssessment, PullUp · progress/ (extracted charts)
  state/          AppDataProvider (live IndexedDB queries) · ToastProvider
  styles/         index.css (design tokens) · shell.css · workout.css
  types/          Zod schemas + inferred TypeScript types
  utils/          stats.ts · progression.ts · doubleProgression.ts · excelExport.ts ·
                  excelImport.ts · backup.ts
e2e/              Playwright specs
scripts/          generate-icons.mjs
```

### Data model & migrations

Every persisted record carries `id`, `createdAt`, `updatedAt` and `schemaVersion`. Dexie handles
index/store upgrades in `src/db/db.ts`; record-shape changes go through `src/db/migrations.ts`, which
also runs on data arriving from an old JSON backup that Dexie never sees. To add a migration:

1. Bump `SCHEMA_VERSION` in `src/types/index.ts`.
2. Add `{ to, describe, migrate }` to `MIGRATIONS`.
3. Add a Dexie `.version()` block in `db.ts` if indexes changed.

The IndexedDB database is still named `movement-resilience`. Renaming it would orphan every existing
install's real data, so the name is deliberately left alone — only the app is called Ironpath.

### Program seeding

Each program owns one canonical day template and generates all of its weeks from it, so there is no
duplicated week data to drift. The hypertrophy program scales sets and target RIR per week phase;
the resilience program applies per-week deltas. Everything stays editable per-day from the Plan
screen.

On first run Ironpath creates a hypertrophy plan and makes it active. On an install that predates
Ironpath, the hypertrophy plan is added **once**, non-destructively, alongside the existing plan and
all its history.

---

## Testing

```bash
npm test     # unit tests
npm run e2e  # end-to-end tests
```

Unit tests cover the calculation layer (pain bands, rep/volume/completion maths, unit conversion,
trends), the double-progression engine, the progression suggestion rules, program generation
(including the weekly volume targets and the no-deadlift / no-strict-pull-up guarantees), the
repository (seeding, multi-plan resolution, scheduling around pauses, session lifecycle, resume
choices, personal records), Excel export via a real write/read round-trip, the legacy Excel importer,
and JSON backup/restore including rejection paths.

End-to-end tests cover completing a workout, resuming an unfinished one, pausing the plan, restarting
Week 1, exporting Excel, restoring a JSON backup, and PWA installability (manifest, service worker
control, offline reload).

---

## Icons

`public/icons/*.png` are generated placeholders produced by `npm run icons`. Replace them with real
artwork at 192×192, 512×512, a 512×512 maskable variant with safe padding, and a 180×180 Apple touch
icon — the filenames are referenced from `vite.config.ts` and `index.html`.

---

## Safety

> This app is a workout tracking tool and does not provide medical diagnosis. Stop any exercise that
> causes sharp, worsening, or unusual pain. Seek evaluation from a qualified medical professional when
> needed.

The hypertrophy program does not prescribe strict pull-ups and never asks you to test them. The
resilience block shows a target of 3–5 clean consecutive strict pull-ups; that is a direction to
train toward, not a promise, and the app labels it as such.
