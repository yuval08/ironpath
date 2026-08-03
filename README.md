# Movement & Joint Resilience — 4-Week Tracker

A mobile-first, installable PWA for tracking a four-week movement and joint resilience training
block. Works fully offline, stores everything locally in IndexedDB, and exports the complete history
to a formatted Excel workbook. No backend, no login, no account.

The block is a bridge into a four-day hypertrophy routine, built around upper chest, shoulders, knee
strength, joint health, pull-up progress, movement quality and lower-back safety.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command           | What it does                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `npm run dev`     | Vite dev server                                                        |
| `npm run build`   | Type-check (`tsc -b`) then production build into `dist/`               |
| `npm run preview` | Serve the production build locally (needed to test the service worker) |
| `npm run lint`    | ESLint                                                                 |
| `npm run format`  | Prettier                                                               |
| `npm test`        | Vitest unit tests                                                      |
| `npm run e2e`     | Playwright end-to-end tests (builds + previews automatically)          |
| `npm run icons`   | Regenerate the placeholder PWA icons in `public/icons/`                |

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

## The training block

Monday–Friday, four weeks, ~60 minutes per gym session. Saturday and Sunday are rest days — farm
work is deliberately not tracked as a workout.

| Day       | Session             | Focus                                              |
| --------- | ------------------- | -------------------------------------------------- |
| Monday    | Upper Body A        | Pull-up skill, upper back, shoulder health         |
| Tuesday   | Lower Body A        | Single-leg strength, knee tolerance, hip control   |
| Wednesday | Mobility & Movement | Joint control, balance, movement quality           |
| Thursday  | Upper Body B        | Chin-ups, pressing volume, carries                 |
| Friday    | Lower Body B        | Squat pattern, posterior chain, anti-rotation core |

Weekly intent: **1** technique and tolerance → **2** volume → **3** control and difficulty →
**4** consolidation and assessment.

Programming constraints baked into the seed data: no conventional deadlifts, no reverse lunges, no
heavy spinal loading, most sets finishing with 2–3 reps in reserve, and a programmed substitution for
every movement that commonly provokes knee or shoulder pain.

The pre-workout warm-up (treadmill walk, arm circles, shoulder/hip CARs, band pull-aparts, scapular
push-ups, bodyweight squats, ankle rocks) is tracked separately — the session timer only starts once
you mark the warm-up done, so it never eats into the 60 minutes. The morning stretching and McGill
Big Three routine is intentionally **not** part of the gym session.

### Scheduling and the trip

Workouts are never locked to calendar dates; the dates on the Plan screen are projections that skip
any active pause window. A **Travel** pause covering 10–16 August is seeded by default, and you can
add more on the Plan screen.

When you come back, the Plan screen offers three choices — resume where you stopped, restart the
current week, or restart the full block. The recommendation shown in the UI is:

> After your trip, restart Week 1 and complete the full four-week block.

---

## Feature map

| Screen               | What's there                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**        | Current week/day, completion %, pull-up & chin-up records, best dead hang, total push-ups, average knee/shoulder/back pain, next session, pause status, start/resume buttons                       |
| **Plan**             | All four weeks, per-day exercise lists, resume/restart choices, pause manager, full prescription editing (exercise, sets, reps, weight, band, rest, treadmill minutes, order, video, substitution) |
| **Workout**          | Warm-up checklist, pain before/after, superset-grouped exercise cards, per-set logging, RPE/RIR, notes, per-exercise pain, substitutions, skip reasons, session + rest timers                      |
| **Library**          | 44 movements — instructions, common mistakes, safety notes, tempo, regression, progression, targets, video links, "new movement" flags, search and category filters                                |
| **Progress**         | Completion, pull-up/chin-up max, push-up volume, dead hang, backward treadmill duration & speed, knee/shoulder/back pain trends, bodyweight, average RPE, weekly volume, progression suggestions   |
| **Pull-Up Goal**     | First-pull-up date, max/total strict pull-ups, chin-ups, negative lowering time, band assistance, dead hang, scapular quality                                                                      |
| **Settings**         | Name, kg/lb, theme, rest defaults, vibration/beep, video overrides, Excel export, JSON backup/restore, storage status, four levels of reset                                                        |
| **Import**           | Upload a previous Excel tracker, confirm detected exercise mappings, edit and apply suggested starting weights                                                                                     |
| **Final Assessment** | End-of-block test form plus an on-screen summary, included in the Excel export                                                                                                                     |

### Progression suggestions

Nothing changes on its own. A suggestion appears only after **two** sessions where an exercise had
all sets completed, form marked clean, pain 0–2 and every recorded RPE ≤ 7. You accept or dismiss it
on the Progress screen; the workout is never modified automatically.

### Pain tracking

Before and after every session: left/right knee, left/right shoulder, lower back, general fatigue,
each 0–10. Colour bands are 0–2 green, 3–4 yellow, 5+ red. Hitting 5 or higher shows a warning and
points at the programmed substitution — it never suggests a cause or a diagnosis, and the warning is
not repeated on every exercise.

---

## Importing your old Excel tracker

More → _Import Old Excel Tracker_, or Settings → _Import old workout Excel_.

The parser is header-driven rather than layout-driven: on every sheet it looks for a row containing a
cell reading `Exercise`, then reads the `S1 Wt` / `S1 Reps` style columns beneath it. That handles
the bundled `workout_tracker_12wk.xlsx` (sheets `Wk01`–`Wk12`) and any tracker with a different
number of sets or extra columns.

For each detected exercise it takes the heaviest working weight seen, fuzzy-matches it to a library
movement, and suggests **50%** of that load as a starting point (rounded to the nearest 2.5) — inside
the 40–60% range appropriate for a technique and tolerance block. Every mapping and weight is
editable, nothing is applied until you confirm it, and confirmed weights remain editable everywhere
afterwards. Exercises with no previous data start at bodyweight, the lightest band, or light
dumbbells.

---

## Excel export

Settings → _Export workout history to Excel_ produces
`movement-resilience-workout-YYYY-MM-DD.xlsx` with eight sheets:

1. **Summary** — name, dates, completion, pull-up/chin-up/dead-hang start vs finish, push-up record, average pain scores, session notes, final assessment
2. **Week 1** – 5. **Week 4** — date, day, superset, exercise, planned sets/reps, recommended and actual weight, actual reps by set, band, duration, RPE, RIR, pain, completed, notes, clickable video link
3. **Exercise Library** — instructions, video, regression, progression, safety notes
4. **Pain & Recovery** — before/after entries per session with average RPE and comments
5. **Personal Records** — pull-up, chin-up, push-up, dead hang, backward treadmill, single-leg balance

Every sheet has a frozen bold header row, an auto-filter, sensible column widths and number formats.
Days are separated by a tinted section row rather than merged cells, so filtering keeps working.

JSON backup (`movement-resilience-backup-YYYY-MM-DD.json`) round-trips everything — plans, sessions,
records, settings, suggestions, assessments and imported weights. Restoring **replaces** local data
and is validated with Zod first; an invalid or newer-schema file is rejected without touching what
you already have.

---

## Replacing or verifying the YouTube video links

**Read this before trusting any video link in the app.**

Videos live in [`src/data/exerciseVideos.ts`](src/data/exerciseVideos.ts). Each entry is:

```ts
type ExerciseVideo = {
  exerciseId: string;
  title: string;
  creator: string;
  url: string;
  duration?: string;
  isShort?: boolean;
  verified: boolean; // true only for a link you have personally watched
  unavailable?: boolean;
  userProvided?: boolean;
};
```

Every shipped entry has `verified: false` and points at a **YouTube search URL**, not a specific
video. The UI labels those buttons "Search YouTube" rather than "Watch video" precisely so that an
unchecked link never masquerades as a verified demonstration. Nothing is embedded; links always open
externally in YouTube or the browser.

### Option A — pin a video from inside the app (no code, survives rebuilds)

1. Settings → Videos → _Manage_.
2. Filter for the exercise, paste a YouTube URL, tap away from the field.
3. The override is stored in IndexedDB and is included in JSON backups. Clear the field to fall back
   to the default search link.

You can also copy a link or mark a video unavailable from the video row on any exercise.

### Option B — edit the config file (ships with the app for everyone)

1. Open the search link, pick a clip from a creator you trust.
2. Replace that entry in `EXERCISE_VIDEOS`:

```ts
{
  exerciseId: 'terminal-knee-extension',
  title: 'Terminal Knee Extension',
  creator: 'E3 Rehab',
  url: 'https://www.youtube.com/watch?v=REAL_VIDEO_ID',
  duration: '2:14',
  verified: true,   // set this only after you have watched it
}
```

3. Re-run `npm run build`.

Preferred creators, already used in the search queries: Squat University, Tom Merrick (Bodyweight
Warrior), Strength Side, Precision Movement, Knees Over Toes Guy, Renaissance Periodization,
E3 Rehab, FitnessFAQs, Calisthenicmovement.

### The Wednesday follow-along routine

The Mobility & Movement day shows a "Watch follow-along mobility routine" action alongside the
individual movement demonstrations. The default is a search URL. Two concrete candidates are listed
in `MOBILITY_FOLLOW_ALONG_CANDIDATES` for a 15–25 minute full-body routine covering shoulders,
thoracic spine, hips and ankles:

- `https://www.youtube.com/watch?v=BSkPVmh7-qA` — "20 Min Mobility Routine (FOLLOW ALONG)"
- `https://www.youtube.com/watch?v=lPKRiU9u_Hc` — "20 Minute Full Body Flexibility Routine (FOLLOW ALONG)"

Both are marked `verified: false`. The first URL resolved to a live page with a matching title at
authoring time, but the channel and duration were **not** independently confirmed, so neither is
hard-coded as the default. Watch one, then either promote it to `MOBILITY_FOLLOW_ALONG` with
`verified: true`, or pin it via Settings → Videos.

---

## Project structure

```
src/
  components/     ExerciseCard, SetRow, WarmUp, PainScale, VideoLink, Charts, Sheet, PauseManager, …
  data/           exercises.ts (44 movements) · program.ts (canonical template → 4 weeks)
                  exerciseVideos.ts · substitutions.ts
  db/             db.ts (Dexie) · repository.ts (all persistence) · migrations.ts
  hooks/          useTimers.ts (stopwatch + rest timer) · useTheme.ts
  screens/        Dashboard, Plan, Workout, Library, Progress, More, Settings, Import,
                  FinalAssessment, PullUp
  state/          AppDataProvider (live IndexedDB queries) · ToastProvider
  styles/         index.css (design tokens, light/dark)
  types/          Zod schemas + inferred TypeScript types
  utils/          stats.ts · progression.ts · excelExport.ts · excelImport.ts · backup.ts
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

### Program seeding

There is exactly one canonical five-day template (`DAY_TEMPLATES` in `src/data/program.ts`). All four
weeks are generated from it by applying per-week deltas (`weekly: { minutes: [8, 10, 12, 15] }`), so
there is no duplicated week data to drift. Everything stays editable per-day from the Plan screen.

---

## Testing

```bash
npm test     # 113 unit tests
npm run e2e  # 7 end-to-end tests
```

Unit tests cover the calculation layer (pain bands, rep/volume/completion maths, unit conversion),
the progression rules, program generation, the repository (seeding, scheduling around pauses, session
lifecycle, all three resume choices, personal records), Excel export (sheet structure, frozen headers,
filters, cell contents via a real write/read round-trip) and the legacy Excel importer (run against
the real `workout_tracker_12wk.xlsx`), plus JSON backup/restore including rejection paths.

End-to-end tests cover completing a workout, resuming an unfinished one, pausing the plan, restarting
Week 1, exporting Excel, restoring a JSON backup, and PWA installability (manifest, service worker
control, offline reload).

---

## Icons

`public/icons/*.png` are generated placeholders (a teal tile with a pull-up bar glyph) produced by
`npm run icons`. Replace them with real artwork at 192×192, 512×512, a 512×512 maskable variant with
safe padding, and a 180×180 Apple touch icon — the filenames are referenced from
`vite.config.ts` and `index.html`.

---

## Safety

> This app is a workout tracking tool and does not provide medical diagnosis. Stop any exercise that
> causes sharp, worsening, or unusual pain. Seek evaluation from a qualified medical professional when
> needed.

The pull-up section shows a four-week target of 3–5 clean consecutive strict pull-ups. That is a
direction to train toward, not a promise — the app labels it as such.
