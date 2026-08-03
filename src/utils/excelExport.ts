import type ExcelJS from 'exceljs';
import { loadExcelJS } from './excelModule';
import { format } from 'date-fns';
import { EXERCISES, exerciseName } from '@/data/exercises';
import { getVideo } from '@/data/exerciseVideos';
import { DAY_LABELS, WEEKDAY_LABELS } from '@/data/program';
import type {
  FinalAssessment,
  PersonalRecord,
  UserSettings,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';
import {
  averageBackPain,
  averageKneePain,
  averageRpe,
  averageShoulderPain,
  completedSessions,
  completionPercent,
  exerciseReps,
  maxDurationForExercise,
  maxRepsForExercise,
  maxTreadmillMinutes,
  setReps,
  TOTAL_SESSIONS,
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
  plan: WorkoutPlan;
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

/** Formats a date defensively — returns an em dash rather than throwing. */
function safeDate(value: string | number): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'yyyy-MM-dd');
}

function firstAndLast(values: number[]): { first: number | null; last: number | null } {
  if (values.length === 0) return { first: null, last: null };
  return { first: values[0] ?? null, last: values[values.length - 1] ?? null };
}

/** Best single-set reps per session, in chronological order. */
export function progressionSeries(sessions: WorkoutSession[], exerciseId: string): number[] {
  const out: number[] = [];
  for (const session of sessions) {
    const best = session.results
      .filter((r) => r.exerciseId === exerciseId)
      .flatMap((r) => r.sets.filter((s) => s.completed))
      .reduce((max, s) => Math.max(max, setReps(s)), 0);
    if (best > 0) out.push(best);
  }
  return out;
}

function summarySheet(wb: ExcelJS.Workbook, input: ExportInput): void {
  const { plan, sessions, settings, assessment } = input;
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
        .filter((r) => r.exerciseId === 'dead-hang')
        .flatMap((r) => r.sets.filter((s) => s.completed))
        .reduce((max, s) => Math.max(max, s.durationSeconds ?? 0), 0);
      if (best > 0) values.push(best);
    }
    return firstAndLast(values);
  })();

  // A restored backup can carry any string here (startDate is only z.string()),
  // and an invalid Date would throw RangeError out of the user's only export path.
  const endDate = safeDate(plan.completedAt ?? new Date(plan.startDate).getTime() + 27 * 86400000);

  const rows: [string, string | number | null][] = [
    ['User name', settings.userName || '—'],
    ['Plan', plan.name],
    ['Plan start date', plan.startDate],
    ['Plan end date (projected)', endDate],
    ['Weight unit', settings.weightUnit],
    ['Total completed workouts', done.length],
    ['Planned workouts', TOTAL_SESSIONS],
    ['Completion percentage', `${completionPercent(sessions)}%`],
    ['Restarts of the four-week block', plan.restartCount],
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

  sheet.addRow({});
  const notesHeader = sheet.addRow({ metric: 'Session notes', value: '' });
  notesHeader.font = { bold: true };
  notesHeader.fill = SECTION_FILL;
  for (const session of done.filter((s) => s.sessionNotes.trim())) {
    sheet.addRow({
      metric: `${session.date} — ${DAY_LABELS[session.dayType] ?? session.dayType}`,
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

function weekSheets(wb: ExcelJS.Workbook, input: ExportInput): void {
  const { plan, sessions } = input;
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
  ];

  const usedNames = new Set<string>();
  for (const week of plan.weeks) {
    // A restored plan can carry duplicate week numbers; ExcelJS throws on a
    // repeated worksheet name, which would kill the whole export.
    let name = `Week ${week.weekNumber}`;
    for (let n = 2; usedNames.has(name); n += 1) name = `Week ${week.weekNumber} (${n})`;
    usedNames.add(name);
    const sheet = wb.addWorksheet(name);
    addColumns(sheet, specs);
    styleHeader(sheet, specs.length);

    const weekSessions = sessions
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
        });
        sectionRow.font = { bold: true };
        sectionRow.fill = SECTION_FILL;

        const emitted = new Set<string>();

        const writeRow = (opts: {
          block: string;
          exercise: string;
          plannedSets: number | null;
          recWeight: number | null;
          videoId: string;
          result: WorkoutSession['results'][number] | undefined;
          band: string;
        }) => {
          const { result } = opts;
          const rpes = result?.sets.map((s) => s.rpe).filter((v): v is number => v != null) ?? [];
          const rirs = result?.sets.map((s) => s.rir).filter((v): v is number => v != null) ?? [];
          const durations =
            result?.sets.map((s) => s.durationSeconds).filter((v): v is number => v != null) ?? [];
          const weights =
            result?.sets.map((s) => s.weight).filter((v): v is number => v != null) ?? [];
          const video = getVideo(opts.videoId, input.settings.videoOverrides);

          const row = sheet.addRow({
            date: session?.date ?? '',
            day: day.title,
            block: opts.block,
            exercise: opts.exercise,
            plannedSets: opts.plannedSets,
            plannedReps: result?.plannedReps ?? '',
            recWeight: opts.recWeight,
            actualWeight: weights.length ? Math.max(...weights) : null,
            actualReps: result ? setsSummary(result.sets) : '',
            band: opts.band,
            duration: durations.length ? Math.max(...durations) : null,
            rpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
            rir: rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null,
            pain: result?.painDuring ?? null,
            completed: result?.completed ? 'Yes' : result?.skippedReason ? 'Skipped' : 'No',
            notes: result?.notes ?? '',
            video: video?.title ?? '',
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
          // Label by what was actually performed. The plan can be edited after the
          // fact, and p.exerciseId would then relabel real sets as an exercise that
          // was never done.
          const performedId = result?.substitutionExerciseId ?? result?.exerciseId ?? p.exerciseId;
          const substituted =
            result?.substitutionExerciseId != null &&
            result.substitutionExerciseId !== result.exerciseId;
          writeRow({
            block: p.blockLabel,
            exercise:
              exerciseName(performedId) +
              (substituted ? ` (sub for ${exerciseName(result.exerciseId)})` : ''),
            plannedSets: p.sets,
            recWeight: p.recommendedWeight ?? result?.recommendedWeight ?? null,
            videoId: performedId,
            result,
            band: result?.sets.find((s) => s.band)?.band ?? p.recommendedBand ?? '',
          });
        }

        // Anything logged that no longer joins to a prescription (restored backup,
        // renamed ids) still belongs in the export rather than silently vanishing.
        for (const result of session?.results ?? []) {
          if (emitted.has(result.prescriptionId)) continue;
          const performedId = result.substitutionExerciseId ?? result.exerciseId;
          writeRow({
            block: 'Unmatched (not in current plan)',
            exercise: exerciseName(performedId),
            plannedSets: result.plannedSets ?? null,
            recWeight: result.recommendedWeight ?? null,
            videoId: performedId,
            result,
            band: result.sets.find((s) => s.band)?.band ?? '',
          });
        }
      });
    }
  }
}

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
    { header: 'Comments', key: 'comments', width: 44 },
  ];
  addColumns(sheet, specs);
  styleHeader(sheet, specs.length);

  for (const session of input.sessions.filter((s) => s.status !== 'abandoned')) {
    for (const [when, entry] of [
      ['Before', session.painBefore],
      ['After', session.painAfter],
    ] as const) {
      if (!entry) continue;
      sheet.addRow({
        date: session.date,
        day: DAY_LABELS[session.dayType] ?? session.dayType,
        when,
        lk: entry.leftKnee,
        rk: entry.rightKnee,
        ls: entry.leftShoulder,
        rs: entry.rightShoulder,
        lb: entry.lowerBack,
        fatigue: entry.fatigue,
        rpe: when === 'After' ? averageRpe(session) : null,
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

  if (input.records.length) {
    const spacer = sheet.addRow({ record: 'Logged records' });
    spacer.font = { bold: true };
    spacer.fill = SECTION_FILL;
    for (const r of [...input.records].sort((a, b) => a.date.localeCompare(b.date))) {
      sheet.addRow({ record: r.kind, value: r.value, unit: r.unit, date: r.date, notes: r.notes });
    }
  }
}

export async function buildWorkbook(input: ExportInput): Promise<ExcelJS.Workbook> {
  const Excel = await loadExcelJS();
  const wb = new Excel.Workbook();
  wb.creator = 'Movement & Joint Resilience';
  wb.created = new Date();
  summarySheet(wb, input);
  weekSheets(wb, input);
  librarySheet(wb, input);
  painSheet(wb, input);
  recordsSheet(wb, input);
  return wb;
}

export function exportFileName(date = new Date()): string {
  return `movement-resilience-workout-${format(date, 'yyyy-MM-dd')}.xlsx`;
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
