import type ExcelJS from 'exceljs';
import { loadExcelJS } from './excelModule';
import { format } from 'date-fns';
import { EXERCISES, exerciseName } from '@/data/exercises';
import { getVideo } from '@/data/exerciseVideos';
import { programFor, WEEKDAY_LABELS } from '@/data/programs';
import type {
  BandResistance,
  FinalAssessment,
  PersonalRecord,
  SetResult,
  UserSettings,
  WeekPlan,
  WorkoutDay,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';
import { bandName, workingSets } from './doubleProgression';
import {
  averageBackPain,
  averageKneePain,
  averageRpe,
  averageShoulderPain,
  completedSessions,
  completionPercent,
  exerciseReps,
  formatDuration,
  maxDurationForExercise,
  maxRepsForExercise,
  maxTreadmillMinutes,
  performedExerciseId,
  round1,
  sessionVolume,
  setReps,
  totalSessionsFor,
  workingSetsOf,
} from './stats';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F766E' },
};
const SECTION_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE6F4F1' },
};

export interface ExportInput {
  /** The active plan. Always exported; kept as its own field for single-plan callers. */
  plan: WorkoutPlan;
  /** Every plan to include. Defaults to `[plan]`; `plan` is always covered even if omitted here. */
  plans?: WorkoutPlan[];
  sessions: WorkoutSession[];
  records: PersonalRecord[];
  settings: UserSettings;
  assessment?: FinalAssessment | undefined;
}

interface ColumnSpec {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
}

function styleHeader(sheet: ExcelJS.Worksheet, columnCount: number, headerRow = 1): void {
  const row = sheet.getRow(headerRow);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: Math.max(1, columnCount) },
  };
}

function addColumns(sheet: ExcelJS.Worksheet, specs: ColumnSpec[]): void {
  sheet.columns = specs.map((s) => ({
    header: s.header,
    key: s.key,
    width: s.width,
    style: s.numFmt ? { numFmt: s.numFmt } : undefined,
  }));
}

/* ------------------------------------------------------------------ */
/* Sheet naming                                                        */
/* ------------------------------------------------------------------ */

/** Excel rejects these outright in a worksheet name, and 31 characters is the hard cap. */
const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;
const MAX_SHEET_NAME = 31;

export function sanitizeSheetName(name: string): string {
  const cleaned = name
    .replace(INVALID_SHEET_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Excel also refuses a name that starts or ends with an apostrophe.
    .replace(/^'+|'+$/g, '')
    .slice(0, MAX_SHEET_NAME)
    .trim();
  return cleaned || 'Sheet';
}

/**
 * A restored plan can carry duplicate week numbers, and two programs can produce
 * the same label. ExcelJS throws on a repeated worksheet name, which would kill
 * the whole export — so disambiguate, staying inside the 31-character cap.
 */
function uniqueSheetName(base: string, used: Set<string>): string {
  let name = sanitizeSheetName(base);
  for (let n = 2; used.has(name); n += 1) {
    const suffix = ` (${n})`;
    name = `${sanitizeSheetName(base)
      .slice(0, MAX_SHEET_NAME - suffix.length)
      .trim()}${suffix}`;
  }
  used.add(name);
  return name;
}

/* ------------------------------------------------------------------ */
/* Plan / week / session helpers                                       */
/* ------------------------------------------------------------------ */

/** Every plan the workbook covers, `input.plan` first, deduped by id. */
export function plansOf(input: ExportInput): WorkoutPlan[] {
  const out: WorkoutPlan[] = [input.plan];
  const seen = new Set([input.plan.id]);
  for (const p of input.plans ?? []) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function programName(plan: WorkoutPlan): string {
  return programFor(plan.programId).name;
}

const PHASE_LABELS: Record<WeekPlan['phase'], string> = {
  base: 'Base',
  reload: 'Reload',
  hypertrophy: 'Hypertrophy',
  deload: 'Deload',
};

/** `Hypertrophy W7` / `Reload` — the badge the Plan screen shows. */
export function phaseLabel(week: Pick<WeekPlan, 'phase' | 'blockWeek'>): string {
  const base = PHASE_LABELS[week.phase] ?? week.phase;
  return week.blockWeek != null ? `${base} W${week.blockWeek}` : base;
}

/**
 * Splits the sessions across the exported plans. A session whose `planId` matches
 * nothing in the workbook is attributed to the first plan rather than dropped —
 * losing real logged work from the export is worse than filing it imprecisely.
 */
function sessionsByPlan(
  plans: WorkoutPlan[],
  sessions: WorkoutSession[],
): Map<string, WorkoutSession[]> {
  const map = new Map<string, WorkoutSession[]>(plans.map((p) => [p.id, []]));
  const fallback = plans[0]?.id;
  for (const session of sessions) {
    const bucket = map.get(session.planId) ?? (fallback != null ? map.get(fallback) : undefined);
    bucket?.push(session);
  }
  return map;
}

interface DayLocation {
  week: WeekPlan;
  day: WorkoutDay;
}

function dayIndex(plan: WorkoutPlan): Map<string, DayLocation> {
  const map = new Map<string, DayLocation>();
  for (const week of plan.weeks) {
    for (const day of week.days) {
      if (!map.has(day.id)) map.set(day.id, { week, day });
    }
  }
  return map;
}

function byStart(sessions: WorkoutSession[]): WorkoutSession[] {
  return [...sessions].sort((a, b) =>
    `${a.date}${a.startedAt}`.localeCompare(`${b.date}${b.startedAt}`),
  );
}

function setsSummary(
  sets: { reps: number | null; repsLeft: number | null; repsRight: number | null }[],
): string {
  return sets
    .map((s) => {
      if (s.reps != null) return String(s.reps);
      if (s.repsLeft != null || s.repsRight != null)
        return `${s.repsLeft ?? 0}/${s.repsRight ?? 0}`;
      return '-';
    })
    .join(' · ');
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function numbersOf(
  sets: SetResult[],
  pick: (set: SetResult) => number | null | undefined,
): number[] {
  return sets.map(pick).filter((v): v is number => typeof v === 'number');
}

function bandOf(sets: SetResult[]): BandResistance | null {
  return sets.map((s) => s.band).filter((b): b is BandResistance => b != null)[0] ?? null;
}

/** Formats a date defensively — returns an em dash rather than throwing. */
function safeDate(value: string | number): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'yyyy-MM-dd');
}

function firstAndLast(values: number[]): { first: number | null; last: number | null } {
  if (values.length === 0) return { first: null, last: null };
  return { first: values[0] ?? null, last: values[values.length - 1] ?? null };
}

/** Best single working-set reps per session, in chronological order. */
export function progressionSeries(sessions: WorkoutSession[], exerciseId: string): number[] {
  const out: number[] = [];
  for (const session of sessions) {
    const best = session.results
      .filter((r) => performedExerciseId(r) === exerciseId)
      .flatMap((r) => workingSetsOf(r).filter((s) => s.completed))
      .reduce((max, s) => Math.max(max, setReps(s)), 0);
    if (best > 0) out.push(best);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function summarySheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const { sessions, settings, assessment } = input;
  const plans = plansOf(input);
  const done = completedSessions(sessions);
  const sheet = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF0F766E' } } });
  addColumns(sheet, [
    { header: 'Metric', key: 'metric', width: 38 },
    { header: 'Value', key: 'value', width: 46 },
  ]);
  styleHeader(sheet, 2);

  const pullUps = firstAndLast(progressionSeries(done, 'strict-pull-up'));
  const chinUps = firstAndLast(progressionSeries(done, 'chin-up'));
  const hangs = (() => {
    const values: number[] = [];
    for (const session of done) {
      const best = session.results
        .filter((r) => performedExerciseId(r) === 'dead-hang')
        .flatMap((r) => workingSetsOf(r).filter((s) => s.completed))
        .reduce((max, s) => Math.max(max, s.durationSeconds ?? 0), 0);
      if (best > 0) values.push(best);
    }
    return firstAndLast(values);
  })();

  const planned = plans.reduce((sum, p) => sum + totalSessionsFor(p), 0);
  const durations = done.map((s) => s.elapsedSeconds).filter((v) => v > 0);

  const rows: [string, string | number | null][] = [
    ['User name', settings.userName || '—'],
    ['Programs exported', plans.map(programName).join(' · ')],
    ['Total completed workouts', done.length],
    ['Planned workouts', planned],
    ['Completion percentage', `${completionPercent(sessions, planned)}%`],
    ['Average workout duration', durations.length ? formatDuration(mean(durations) ?? 0) : '—'],
    ['Weight unit', settings.weightUnit],
    ['Strict pull-ups — start', pullUps.first],
    ['Strict pull-ups — finish', pullUps.last],
    ['Chin-ups — start', chinUps.first],
    ['Chin-ups — finish', chinUps.last],
    ['Dead hang — start (s)', hangs.first],
    ['Dead hang — finish (s)', hangs.last],
    ['Push-up record (single set)', maxRepsForExercise(done, 'standard-push-up')],
    ['Average knee pain', averageKneePain(sessions)],
    ['Average shoulder pain', averageShoulderPain(sessions)],
    ['Average lower-back pain', averageBackPain(sessions)],
    ['First strict pull-up date', settings.firstStrictPullUpDate ?? '—'],
    ['Bodyweight', settings.bodyweight ?? '—'],
  ];
  for (const [metric, value] of rows) sheet.addRow({ metric, value: value ?? '—' });

  // One block per plan, so a workbook covering two programs still reports each
  // plan's own dates, week count and restarts rather than a merged average.
  const byPlan = sessionsByPlan(plans, sessions);
  for (const plan of plans) {
    sheet.addRow({});
    const header = sheet.addRow({ metric: plan.name, value: programName(plan) });
    header.font = { bold: true };
    header.fill = SECTION_FILL;

    const planSessions = byPlan.get(plan.id) ?? [];
    const weeks = plan.weeks.length;
    // A restored backup can carry any string here (startDate is only z.string()),
    // and an invalid Date would throw RangeError out of the user's only export path.
    const endDate = safeDate(
      plan.completedAt ?? new Date(plan.startDate).getTime() + (weeks * 7 - 1) * 86400000,
    );
    const planRows: [string, string | number | null][] = [
      ['Plan start date', plan.startDate],
      ['Plan end date (projected)', endDate],
      ['Weeks in program', weeks],
      ['Current week', plan.currentWeek],
      ['Planned workouts', totalSessionsFor(plan)],
      ['Completed workouts', completedSessions(planSessions).length],
      ['Completion percentage', `${completionPercent(planSessions, totalSessionsFor(plan))}%`],
      ['Restarts of the block', plan.restartCount],
      ['Archived', plan.archived ? 'Yes' : 'No'],
    ];
    for (const [metric, value] of planRows) sheet.addRow({ metric, value: value ?? '—' });
  }

  sheet.addRow({});
  const notesHeader = sheet.addRow({ metric: 'Session notes', value: '' });
  notesHeader.font = { bold: true };
  notesHeader.fill = SECTION_FILL;
  const dayLabelFor = (session: WorkoutSession): string => {
    const plan = plans.find((p) => p.id === session.planId) ?? plans[0];
    const labels = plan ? programFor(plan.programId).dayLabels : undefined;
    return labels?.[session.dayType] ?? session.dayType;
  };
  for (const session of done.filter((s) => s.sessionNotes.trim())) {
    sheet.addRow({
      metric: `${session.date} — ${dayLabelFor(session)}`,
      value: session.sessionNotes,
    });
  }

  sheet.addRow({});
  const assessHeader = sheet.addRow({ metric: 'Final assessment', value: '' });
  assessHeader.font = { bold: true };
  assessHeader.fill = SECTION_FILL;
  if (assessment) {
    const a: [string, string | number | null][] = [
      ['Date', assessment.date],
      ['Max strict pull-ups', assessment.maxStrictPullUps],
      ['Max chin-ups', assessment.maxChinUps],
      ['Max push-ups (one set)', assessment.maxPushUps],
      ['Dead hang (s)', assessment.deadHangSeconds],
      ['Single-leg balance (s)', assessment.singleLegBalanceSeconds],
      ['Knee comfort (0-10)', assessment.kneeComfort],
      ['Shoulder comfort (0-10)', assessment.shoulderComfort],
      ['Lower-back comfort (0-10)', assessment.lowerBackComfort],
      ['Overall energy (0-10)', assessment.overallEnergy],
      ['Favourite exercises', assessment.favoriteExercises.map(exerciseName).join(', ') || '—'],
      [
        'Exercises that caused pain',
        assessment.painfulExercises.map(exerciseName).join(', ') || '—',
      ],
      ['Ready for the next four-day program', assessment.readyForNextProgram],
      ['Notes', assessment.notes || '—'],
    ];
    for (const [metric, value] of a) sheet.addRow({ metric, value: value ?? '—' });
  } else {
    sheet.addRow({ metric: 'Status', value: 'Not completed yet' });
  }

  sheet.getColumn('value').alignment = { wrapText: true, vertical: 'top' };
}

/* ------------------------------------------------------------------ */
/* Sessions (session-level: duration + pain)                           */
/* ------------------------------------------------------------------ */

function sessionsSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const sheet = wb.addWorksheet('Sessions');
  const specs: ColumnSpec[] = [
    { header: 'Program', key: 'program', width: 30 },
    { header: 'Week', key: 'week', width: 7, numFmt: '0' },
    { header: 'Week label', key: 'weekLabel', width: 34 },
    { header: 'Phase', key: 'phase', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Weekday', key: 'weekday', width: 12 },
    { header: 'Day', key: 'day', width: 30 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Duration', key: 'duration', width: 11 },
    { header: 'Duration (min)', key: 'durationMinutes', width: 14, numFmt: '0.0' },
    { header: 'Exercises completed', key: 'exercises', width: 18, numFmt: '0' },
    { header: 'Working sets', key: 'sets', width: 12, numFmt: '0' },
    { header: 'Volume', key: 'volume', width: 12, numFmt: '0.0' },
    { header: 'Avg RPE', key: 'rpe', width: 10, numFmt: '0.0' },
    { header: 'Avg RIR', key: 'rir', width: 10, numFmt: '0.0' },
    { header: 'Bodyweight', key: 'bodyweight', width: 12, numFmt: '0.0' },
    { header: 'Pain before (L/R knee)', key: 'pbKnee', width: 20 },
    { header: 'Pain before (L/R shoulder)', key: 'pbShoulder', width: 22 },
    { header: 'Pain before (low back)', key: 'pbBack', width: 20, numFmt: '0' },
    { header: 'Fatigue before', key: 'pbFatigue', width: 14, numFmt: '0' },
    { header: 'Pain after (L/R knee)', key: 'paKnee', width: 20 },
    { header: 'Pain after (L/R shoulder)', key: 'paShoulder', width: 22 },
    { header: 'Pain after (low back)', key: 'paBack', width: 20, numFmt: '0' },
    { header: 'Fatigue after', key: 'paFatigue', width: 14, numFmt: '0' },
    { header: 'Pain comments', key: 'painComments', width: 40 },
    { header: 'Session notes', key: 'notes', width: 44 },
  ];
  addColumns(sheet, specs);
  styleHeader(sheet, specs.length);

  const plans = plansOf(input);
  const byPlan = sessionsByPlan(plans, input.sessions);

  for (const plan of plans) {
    const days = dayIndex(plan);
    const program = programFor(plan.programId);
    for (const session of byStart(byPlan.get(plan.id) ?? [])) {
      const located = days.get(session.dayId);
      const working = session.results.flatMap(workingSetsOf);
      const rirs = numbersOf(working, (s) => s.rir);
      const before = session.painBefore;
      const after = session.painAfter;
      const comments = [before?.comments, after?.comments].filter((c) => c?.trim()).join(' | ');
      sheet.addRow({
        program: program.name,
        week: session.weekNumber,
        weekLabel: located?.week.title ?? '',
        phase: located ? phaseLabel(located.week) : '',
        date: session.date,
        weekday: WEEKDAY_LABELS[session.weekday] ?? session.weekday,
        day: located?.day.title ?? program.dayLabels[session.dayType] ?? session.dayType,
        status: session.status,
        duration: session.elapsedSeconds > 0 ? formatDuration(session.elapsedSeconds) : '',
        durationMinutes: session.elapsedSeconds > 0 ? round1(session.elapsedSeconds / 60) : null,
        exercises: session.results.filter((r) => r.completed).length,
        sets: working.filter((s) => s.completed).length,
        volume: round1(sessionVolume(session)),
        rpe: averageRpe(session),
        rir: rirs.length ? round1(mean(rirs) ?? 0) : null,
        bodyweight: session.bodyweight,
        pbKnee: before ? `${before.leftKnee}/${before.rightKnee}` : '',
        pbShoulder: before ? `${before.leftShoulder}/${before.rightShoulder}` : '',
        pbBack: before?.lowerBack ?? null,
        pbFatigue: before?.fatigue ?? null,
        paKnee: after ? `${after.leftKnee}/${after.rightKnee}` : '',
        paShoulder: after ? `${after.leftShoulder}/${after.rightShoulder}` : '',
        paBack: after?.lowerBack ?? null,
        paFatigue: after?.fatigue ?? null,
        painComments: comments,
        notes: session.sessionNotes,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sets (one row per logged set)                                       */
/* ------------------------------------------------------------------ */

const SET_COLUMNS: ColumnSpec[] = [
  { header: 'Program', key: 'program', width: 30 },
  { header: 'Week', key: 'week', width: 7, numFmt: '0' },
  { header: 'Week label', key: 'weekLabel', width: 34 },
  { header: 'Phase', key: 'phase', width: 16 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Weekday', key: 'weekday', width: 12 },
  { header: 'Day', key: 'day', width: 30 },
  { header: 'Slot', key: 'slot', width: 8 },
  { header: 'Exercise', key: 'exercise', width: 32 },
  { header: 'Set', key: 'setNumber', width: 6, numFmt: '0' },
  { header: 'Set label', key: 'setLabel', width: 10 },
  { header: 'Set type', key: 'setType', width: 10 },
  { header: 'Weight', key: 'weight', width: 10, numFmt: '0.0' },
  { header: 'Reps', key: 'reps', width: 8, numFmt: '0' },
  { header: 'Reps (left)', key: 'repsLeft', width: 11, numFmt: '0' },
  { header: 'Reps (right)', key: 'repsRight', width: 12, numFmt: '0' },
  { header: 'Band', key: 'band', width: 24 },
  { header: 'Duration (s)', key: 'duration', width: 12, numFmt: '0' },
  { header: 'RIR', key: 'rir', width: 8, numFmt: '0.0' },
  { header: 'RPE', key: 'rpe', width: 8, numFmt: '0.0' },
  { header: 'Completed', key: 'completed', width: 11 },
  { header: 'Notes', key: 'notes', width: 40 },
];

/** Ramp sets are exported for context but must never feed a total. */
export const RAMP_SET_TYPE = 'Ramp';
export const WORK_SET_TYPE = 'Work';

/**
 * `setNumber` is unique across the whole `sets` array — ramp sets take 1..n and the
 * working sets continue from there — so it addresses a row but reads badly as an
 * ordinal ("working set 3 of 3" would print as 5). The label counts each kind on
 * its own; the raw `setNumber` stays in its own column for joining back to the row.
 */
export function setLabel(sets: SetResult[], index: number): string {
  const set = sets[index];
  if (!set) return '';
  const ordinal = sets.slice(0, index + 1).filter((s) => s.isWarmUp === set.isWarmUp).length;
  return set.isWarmUp ? `${RAMP_SET_TYPE} ${ordinal}` : String(ordinal);
}

function setsSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const sheet = wb.addWorksheet('Sets');
  addColumns(sheet, SET_COLUMNS);
  styleHeader(sheet, SET_COLUMNS.length);

  const plans = plansOf(input);
  const byPlan = sessionsByPlan(plans, input.sessions);
  const labels = input.settings.bandLabels;

  for (const plan of plans) {
    const program = programFor(plan.programId);
    const days = dayIndex(plan);
    for (const session of byStart(byPlan.get(plan.id) ?? [])) {
      if (session.status === 'abandoned') continue;
      const located = days.get(session.dayId);
      const base = {
        program: program.name,
        week: session.weekNumber,
        weekLabel: located?.week.title ?? '',
        phase: located ? phaseLabel(located.week) : '',
        date: session.date,
        weekday: WEEKDAY_LABELS[session.weekday] ?? session.weekday,
        day: located?.day.title ?? program.dayLabels[session.dayType] ?? session.dayType,
      };

      for (const result of session.results) {
        const prescription = located?.day.prescriptions.find((p) => p.id === result.prescriptionId);
        // Label by what was actually performed: the plan can be edited after the
        // fact, and the prescription's exerciseId would then relabel real sets.
        const performedId = performedExerciseId(result);
        const substituted =
          result.substitutionExerciseId != null &&
          result.substitutionExerciseId !== result.exerciseId;
        const label =
          exerciseName(performedId) +
          (substituted ? ` (sub for ${exerciseName(result.exerciseId)})` : '');
        const slot = prescription?.slot ?? prescription?.blockLabel ?? '';

        result.sets.forEach((set, index) => {
          const band = set.band ?? prescription?.recommendedBand;
          sheet.addRow({
            ...base,
            slot,
            exercise: label,
            setNumber: set.setNumber,
            setLabel: setLabel(result.sets, index),
            setType: set.isWarmUp ? RAMP_SET_TYPE : WORK_SET_TYPE,
            weight: set.weight,
            reps: set.reps,
            repsLeft: set.repsLeft,
            repsRight: set.repsRight,
            band: band ? bandName(band, labels) : '',
            duration: set.durationSeconds,
            rir: set.rir,
            rpe: set.rpe,
            completed: set.completed ? 'Yes' : 'No',
            notes: result.skippedReason ? `Skipped: ${result.skippedReason}` : result.notes,
          });
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Week sheets (one row per prescription)                              */
/* ------------------------------------------------------------------ */

function weekSheets(wb: ExcelJS.Workbook, input: ExportInput, used: Set<string>): void {
  const specs: ColumnSpec[] = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Day', key: 'day', width: 20 },
    { header: 'Superset', key: 'block', width: 22 },
    { header: 'Exercise', key: 'exercise', width: 32 },
    { header: 'Planned sets', key: 'plannedSets', width: 12 },
    { header: 'Planned reps', key: 'plannedReps', width: 16 },
    { header: 'Rec. weight', key: 'recWeight', width: 12, numFmt: '0.0' },
    { header: 'Actual weight', key: 'actualWeight', width: 13, numFmt: '0.0' },
    { header: 'Actual reps by set', key: 'actualReps', width: 22 },
    { header: 'Band', key: 'band', width: 12 },
    { header: 'Duration (s)', key: 'duration', width: 12, numFmt: '0' },
    { header: 'RPE', key: 'rpe', width: 8, numFmt: '0.0' },
    { header: 'RIR', key: 'rir', width: 8, numFmt: '0.0' },
    { header: 'Pain (0-10)', key: 'pain', width: 11, numFmt: '0' },
    { header: 'Completed', key: 'completed', width: 11 },
    { header: 'Notes', key: 'notes', width: 34 },
    { header: 'Video', key: 'video', width: 30 },
    { header: 'Slot', key: 'slot', width: 8 },
    { header: 'Set type', key: 'setType', width: 10 },
    { header: 'Ramp sets', key: 'ramp', width: 18 },
    { header: 'Phase', key: 'phase', width: 16 },
  ];

  const plans = plansOf(input);
  const byPlan = sessionsByPlan(plans, input.sessions);
  const bandLabels = input.settings.bandLabels;
  // One program keeps the historical `Week 1` names; two would collide, so the
  // program's short name disambiguates them.
  const prefixed = plans.length > 1;

  for (const plan of plans) {
    const program = programFor(plan.programId);
    const planSessions = byPlan.get(plan.id) ?? [];

    for (const week of plan.weeks) {
      const base = prefixed
        ? `${program.shortName} W${week.weekNumber}`
        : `Week ${week.weekNumber}`;
      const sheet = wb.addWorksheet(uniqueSheetName(base, used));
      addColumns(sheet, specs);
      styleHeader(sheet, specs.length);

      const weekSessions = planSessions
        .filter((s) => s.weekNumber === week.weekNumber && s.status !== 'abandoned')
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

      for (const day of week.days) {
        // A day can legitimately be trained more than once (the Plan screen allows a
        // redo). Every session gets its own section — taking only the first would
        // drop the repeat from the sheet while the Summary still counted it.
        const daySessions = weekSessions.filter((s) => s.dayId === day.id);
        const passes = daySessions.length > 0 ? daySessions : [undefined];

        passes.forEach((session, passIndex) => {
          const passLabel =
            daySessions.length > 1 ? ` (attempt ${passIndex + 1} of ${daySessions.length})` : '';
          const sectionRow = sheet.addRow({
            date: session?.date ?? '',
            day: `${WEEKDAY_LABELS[day.weekday]} — ${day.title}${passLabel}`,
            phase: phaseLabel(week),
          });
          sectionRow.font = { bold: true };
          sectionRow.fill = SECTION_FILL;

          const emitted = new Set<string>();

          const writeRow = (opts: {
            block: string;
            slot: string;
            exercise: string;
            plannedSets: number | null;
            recWeight: number | null;
            videoId: string;
            result: WorkoutSession['results'][number] | undefined;
            band: string;
          }) => {
            const { result } = opts;
            // Ramp sets are logged for context only: a heavy low-rep ramp would
            // inflate every average and the max-weight column if counted here.
            const work = result ? workingSets(result) : [];
            const ramp = result ? result.sets.filter((s) => s.isWarmUp) : [];
            const rpes = numbersOf(work, (s) => s.rpe);
            const rirs = numbersOf(work, (s) => s.rir);
            const durations = numbersOf(work, (s) => s.durationSeconds);
            const weights = numbersOf(work, (s) => s.weight);
            const video = getVideo(opts.videoId, input.settings.videoOverrides);

            const row = sheet.addRow({
              date: session?.date ?? '',
              day: day.title,
              block: opts.block,
              slot: opts.slot,
              exercise: opts.exercise,
              plannedSets: opts.plannedSets,
              plannedReps: result?.plannedReps ?? '',
              recWeight: opts.recWeight,
              actualWeight: weights.length ? Math.max(...weights) : null,
              actualReps: result ? setsSummary(work) : '',
              band: opts.band,
              duration: durations.length ? Math.max(...durations) : null,
              rpe: mean(rpes),
              rir: mean(rirs),
              pain: result?.painDuring ?? null,
              completed: result?.completed ? 'Yes' : result?.skippedReason ? 'Skipped' : 'No',
              notes: result?.notes ?? '',
              video: video?.title ?? '',
              setType: result ? WORK_SET_TYPE : '',
              ramp: ramp.length ? setsSummary(ramp) : '',
              phase: phaseLabel(week),
            });
            if (video) {
              const cell = row.getCell('video');
              cell.value = { text: video.title, hyperlink: video.url };
              cell.font = { color: { argb: 'FF0F766E' }, underline: true };
            }
          };

          for (const p of day.prescriptions) {
            const result = session?.results.find((r) => r.prescriptionId === p.id);
            if (result) emitted.add(result.prescriptionId);
            const performedId = result ? performedExerciseId(result) : p.exerciseId;
            const substituted =
              result?.substitutionExerciseId != null &&
              result.substitutionExerciseId !== result.exerciseId;
            const band = bandOf(result ? workingSets(result) : []) ?? p.recommendedBand ?? null;
            writeRow({
              block: p.blockLabel,
              slot: p.slot ?? '',
              exercise:
                exerciseName(performedId) +
                (substituted ? ` (sub for ${exerciseName(result.exerciseId)})` : ''),
              plannedSets: p.sets,
              recWeight: p.recommendedWeight ?? result?.recommendedWeight ?? null,
              videoId: performedId,
              result,
              band: band ? bandName(band, bandLabels) : '',
            });
          }

          // Anything logged that no longer joins to a prescription (restored backup,
          // renamed ids) still belongs in the export rather than silently vanishing.
          for (const result of session?.results ?? []) {
            if (emitted.has(result.prescriptionId)) continue;
            const performedId = performedExerciseId(result);
            const band = bandOf(workingSets(result));
            writeRow({
              block: 'Unmatched (not in current plan)',
              slot: '',
              exercise: exerciseName(performedId),
              plannedSets: result.plannedSets ?? null,
              recWeight: result.recommendedWeight ?? null,
              videoId: performedId,
              result,
              band: band ? bandName(band, bandLabels) : '',
            });
          }
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reference sheets                                                    */
/* ------------------------------------------------------------------ */

function librarySheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const sheet = wb.addWorksheet('Exercise Library');
  const specs: ColumnSpec[] = [
    { header: 'Exercise', key: 'name', width: 32 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Equipment', key: 'equipment', width: 24 },
    { header: 'Instructions', key: 'instructions', width: 70 },
    { header: 'Regression', key: 'regression', width: 34 },
    { header: 'Progression', key: 'progression', width: 34 },
    { header: 'Safety notes', key: 'safety', width: 42 },
    { header: 'Video', key: 'video', width: 34 },
  ];
  addColumns(sheet, specs);
  styleHeader(sheet, specs.length);

  for (const ex of EXERCISES) {
    const video = getVideo(ex.id, input.settings.videoOverrides);
    const row = sheet.addRow({
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment.join(', '),
      instructions: ex.instructions.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      regression: ex.regression ?? '',
      progression: ex.progression ?? '',
      safety: ex.safetyNotes.join('\n'),
      video: video?.title ?? '',
    });
    row.alignment = { wrapText: true, vertical: 'top' };
    if (video) {
      const cell = row.getCell('video');
      cell.value = {
        text: video.verified ? video.title : `Search: ${video.title}`,
        hyperlink: video.url,
      };
      cell.font = { color: { argb: 'FF0F766E' }, underline: true };
    }
  }
}

function painSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const sheet = wb.addWorksheet('Pain & Recovery');
  const specs: ColumnSpec[] = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Day', key: 'day', width: 20 },
    { header: 'When', key: 'when', width: 10 },
    { header: 'Left knee', key: 'lk', width: 10, numFmt: '0' },
    { header: 'Right knee', key: 'rk', width: 11, numFmt: '0' },
    { header: 'Left shoulder', key: 'ls', width: 13, numFmt: '0' },
    { header: 'Right shoulder', key: 'rs', width: 14, numFmt: '0' },
    { header: 'Lower back', key: 'lb', width: 12, numFmt: '0' },
    { header: 'Fatigue', key: 'fatigue', width: 10, numFmt: '0' },
    { header: 'Avg RPE', key: 'rpe', width: 10, numFmt: '0.0' },
    { header: 'Duration', key: 'duration', width: 11 },
    { header: 'Comments', key: 'comments', width: 44 },
  ];
  addColumns(sheet, specs);
  styleHeader(sheet, specs.length);

  const plans = plansOf(input);
  const labelFor = (session: WorkoutSession): string => {
    const plan = plans.find((p) => p.id === session.planId) ?? plans[0];
    const labels = plan ? programFor(plan.programId).dayLabels : undefined;
    return labels?.[session.dayType] ?? session.dayType;
  };

  for (const session of input.sessions.filter((s) => s.status !== 'abandoned')) {
    for (const [when, entry] of [
      ['Before', session.painBefore],
      ['After', session.painAfter],
    ] as const) {
      if (!entry) continue;
      sheet.addRow({
        date: session.date,
        day: labelFor(session),
        when,
        lk: entry.leftKnee,
        rk: entry.rightKnee,
        ls: entry.leftShoulder,
        rs: entry.rightShoulder,
        lb: entry.lowerBack,
        fatigue: entry.fatigue,
        rpe: when === 'After' ? averageRpe(session) : null,
        duration:
          when === 'After' && session.elapsedSeconds > 0
            ? formatDuration(session.elapsedSeconds)
            : '',
        comments: entry.comments,
      });
    }
  }
}

function recordsSheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const sheet = wb.addWorksheet('Personal Records');
  const specs: ColumnSpec[] = [
    { header: 'Record', key: 'record', width: 36 },
    { header: 'Value', key: 'value', width: 12, numFmt: '0.0' },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  addColumns(sheet, specs);
  styleHeader(sheet, specs.length);

  const done = completedSessions(input.sessions);
  const derived: [string, number, string][] = [
    ['Strict pull-up max (single set)', maxRepsForExercise(done, 'strict-pull-up'), 'reps'],
    ['Chin-up max (single set)', maxRepsForExercise(done, 'chin-up'), 'reps'],
    ['Push-up max (single set)', maxRepsForExercise(done, 'standard-push-up'), 'reps'],
    ['Dead hang max', maxDurationForExercise(done, 'dead-hang'), 'seconds'],
    [
      'Backward treadmill max duration',
      maxTreadmillMinutes(done, 'backward-treadmill-walk'),
      'minutes',
    ],
    ['Single-leg balance max', maxDurationForExercise(done, 'single-leg-balance'), 'seconds'],
  ];
  for (const [record, value, unit] of derived) {
    sheet.addRow({ record, value, unit, date: '', notes: 'Derived from logged sessions' });
  }

  // Heaviest working set per loaded exercise — the hypertrophy program's records
  // live in weight, not in rep maxes.
  const bestWeights = new Map<string, { weight: number; date: string; reps: number }>();
  for (const session of done) {
    for (const result of session.results) {
      if (result.skippedReason != null) continue;
      for (const set of workingSetsOf(result)) {
        if (!set.completed || set.weight == null || set.weight <= 0) continue;
        const id = performedExerciseId(result);
        const current = bestWeights.get(id);
        if (!current || set.weight > current.weight) {
          bestWeights.set(id, { weight: set.weight, date: session.date, reps: setReps(set) });
        }
      }
    }
  }
  if (bestWeights.size) {
    const header = sheet.addRow({ record: 'Heaviest working set' });
    header.font = { bold: true };
    header.fill = SECTION_FILL;
    for (const [id, best] of [...bestWeights.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      sheet.addRow({
        record: exerciseName(id),
        value: best.weight,
        unit: input.settings.weightUnit,
        date: best.date,
        notes: `${best.reps} reps · working sets only`,
      });
    }
  }

  if (input.records.length) {
    const spacer = sheet.addRow({ record: 'Logged records' });
    spacer.font = { bold: true };
    spacer.fill = SECTION_FILL;
    for (const r of [...input.records].sort((a, b) => a.date.localeCompare(b.date))) {
      sheet.addRow({ record: r.kind, value: r.value, unit: r.unit, date: r.date, notes: r.notes });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

export async function buildWorkbook(input: ExportInput): Promise<ExcelJS.Workbook> {
  const Excel = await loadExcelJS();
  const wb = new Excel.Workbook();
  wb.creator = 'Ironpath';
  wb.created = new Date();
  // Reserve the fixed sheet names so a week sheet can never collide with one.
  const used = new Set<string>([
    'Summary',
    'Sessions',
    'Sets',
    'Exercise Library',
    'Pain & Recovery',
    'Personal Records',
  ]);
  summarySheet(wb, input);
  sessionsSheet(wb, input);
  setsSheet(wb, input);
  weekSheets(wb, input, used);
  librarySheet(wb, input);
  painSheet(wb, input);
  recordsSheet(wb, input);
  return wb;
}

export function exportFileName(date = new Date()): string {
  return `ironpath-workout-${format(date, 'yyyy-MM-dd')}.xlsx`;
}

export async function exportWorkbookBlob(input: ExportInput): Promise<Blob> {
  const wb = await buildWorkbook(input);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function downloadExcel(input: ExportInput): Promise<string> {
  const blob = await exportWorkbookBlob(input);
  const name = exportFileName();
  triggerDownload(blob, name);
  return name;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Exposed for tests: total logged reps for an exercise across sessions. */
export const _internals = { exerciseReps, setsSummary };
