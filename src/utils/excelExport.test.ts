import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildWorkbook,
  exportFileName,
  phaseLabel,
  plansOf,
  progressionSeries,
  sanitizeSheetName,
} from './excelExport';
import { makePain, makePlan, makeResult, makeSession, makeSettings } from '@/test/factories';
import { PROGRAMS } from '@/data/programs';

const plan = makePlan();

function sessionsFixture() {
  const day = plan.weeks[0]!.days[0]!;
  const prescriptions = day.prescriptions;
  return [
    makeSession({
      dayId: day.id,
      date: '2026-08-03',
      sessionNotes: 'Felt solid, first clean single.',
      results: [
        makeResult(
          'strict-pull-up',
          [
            { reps: 1, rpe: 7 },
            { reps: 1, rpe: 7 },
          ],
          {
            prescriptionId: prescriptions[1]!.id,
            plannedReps: '1-2',
          },
        ),
        makeResult('standard-push-up', [{ reps: 15 }, { reps: 14 }, { reps: 12 }], {
          prescriptionId: prescriptions[5]!.id,
        }),
        makeResult('dead-hang', [{ durationSeconds: 30 }], {
          prescriptionId: prescriptions[8]!.id,
        }),
      ],
    }),
    makeSession({
      dayId: day.id,
      date: '2026-08-10',
      painAfter: makePain({ leftKnee: 3, rightKnee: 2 }),
      results: [
        makeResult('strict-pull-up', [{ reps: 3 }], { prescriptionId: prescriptions[1]!.id }),
        makeResult('dead-hang', [{ durationSeconds: 45 }], {
          prescriptionId: prescriptions[8]!.id,
        }),
      ],
    }),
  ];
}

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await wb.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer as ArrayBuffer);
  return reloaded;
}

describe('exportFileName', () => {
  it('uses the ironpath-workout-YYYY-MM-DD.xlsx pattern', () => {
    expect(exportFileName(new Date('2026-08-28T10:00:00Z'))).toBe(
      'ironpath-workout-2026-08-28.xlsx',
    );
  });
});

describe('progressionSeries', () => {
  it('returns the best set per session in chronological order', () => {
    expect(progressionSeries(sessionsFixture(), 'strict-pull-up')).toEqual([1, 3]);
  });

  it('skips sessions where the exercise was not logged', () => {
    expect(progressionSeries(sessionsFixture(), 'standard-push-up')).toEqual([15]);
  });
});

describe('buildWorkbook', () => {
  it('creates every required sheet in order', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
    });
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Sessions',
      'Sets',
      'Week 1',
      'Week 2',
      'Week 3',
      'Week 4',
      'Exercise Library',
      'Pain & Recovery',
      'Personal Records',
    ]);
  });

  it('writes a readable file with the summary metrics filled in', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings({ userName: 'Yuval' }),
    });
    const reloaded = await roundTrip(wb);
    const summary = reloaded.getWorksheet('Summary')!;
    const pairs = new Map<string, unknown>();
    summary.eachRow((row) => {
      const key = row.getCell(1).text;
      if (key) pairs.set(key, row.getCell(2).value);
    });

    expect(pairs.get('User name')).toBe('Yuval');
    expect(pairs.get('Programs exported')).toBe('Movement & Joint Resilience');
    expect(pairs.get('Total completed workouts')).toBe(2);
    expect(pairs.get('Completion percentage')).toBe('10%');
    expect(pairs.get('Strict pull-ups — start')).toBe(1);
    expect(pairs.get('Strict pull-ups — finish')).toBe(3);
    expect(pairs.get('Dead hang — start (s)')).toBe(30);
    expect(pairs.get('Dead hang — finish (s)')).toBe(45);
  });

  it('freezes the header row and adds a filter on every sheet', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: [],
      records: [],
      settings: makeSettings(),
    });
    for (const sheet of wb.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeDefined();
      expect(sheet.getRow(1).font?.bold).toBe(true);
      expect(sheet.columns.every((c) => (c.width ?? 0) > 0)).toBe(true);
    }
  });

  it('lists every prescribed exercise on its week sheet, logged or not', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
    });
    const week1 = wb.getWorksheet('Week 1')!;
    const exerciseCells: string[] = [];
    week1.eachRow((row) => exerciseCells.push(row.getCell(4).text));
    // Every prescription of every day in week 1 gets a row.
    const expected = plan.weeks[0]!.days.reduce((n, d) => n + d.prescriptions.length, 0);
    expect(exerciseCells.filter((t) => t.length > 0).length).toBeGreaterThanOrEqual(expected);
    expect(exerciseCells).toContain('Scapular Pull-Up');
    expect(exerciseCells).toContain('Backward Treadmill Walk');
  });

  it('records actual reps per set and completion state', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
    });
    const reloaded = await roundTrip(wb);
    const week1 = reloaded.getWorksheet('Week 1')!;
    let pushUpRow: ExcelJS.Row | undefined;
    week1.eachRow((row) => {
      if (row.getCell(4).text === 'Standard Push-Up' && row.getCell(9).text) pushUpRow = row;
    });
    expect(pushUpRow?.getCell(9).text).toBe('15 · 14 · 12');
    expect(pushUpRow?.getCell(15).text).toBe('Yes');
  });

  it('writes both pain entries per session with clickable hyperlinks in the library', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
    });
    const pain = wb.getWorksheet('Pain & Recovery')!;
    // 2 sessions x (before + after) + header row
    expect(pain.rowCount).toBe(5);

    const library = wb.getWorksheet('Exercise Library')!;
    const firstVideoCell = library.getRow(2).getCell(8).value as { hyperlink?: string };
    expect(firstVideoCell.hyperlink).toMatch(/^https:\/\/www\.youtube\.com\//);
  });

  it('derives personal records from the logged sessions', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
    });
    const records = wb.getWorksheet('Personal Records')!;
    const map = new Map<string, unknown>();
    records.eachRow((row) => map.set(row.getCell(1).text, row.getCell(2).value));
    expect(map.get('Strict pull-up max (single set)')).toBe(3);
    expect(map.get('Dead hang max')).toBe(45);
    expect(map.get('Push-up max (single set)')).toBe(15);
  });

  /** Regressions: each of these silently lost or misattributed logged work. */
  it('keeps every attempt when a day is trained more than once', async () => {
    const day = plan.weeks[0]!.days[0]!;
    const first = makeSession({
      dayId: day.id,
      date: '2026-08-03',
      results: [
        makeResult('strict-pull-up', [{ reps: 1 }], {
          prescriptionId: day.prescriptions[1]!.id,
        }),
      ],
    });
    const redo = makeSession({
      dayId: day.id,
      date: '2026-08-05',
      results: [
        makeResult('strict-pull-up', [{ reps: 9 }], {
          prescriptionId: day.prescriptions[1]!.id,
        }),
      ],
    });

    const wb = await buildWorkbook({
      plan,
      sessions: [first, redo],
      records: [],
      settings: makeSettings(),
    });
    const week1 = wb.getWorksheet('Week 1')!;
    const dates = new Set<string>();
    const repCells: string[] = [];
    week1.eachRow((row) => {
      if (row.getCell(1).text) dates.add(row.getCell(1).text);
      if (row.getCell(9).text) repCells.push(row.getCell(9).text);
    });
    expect([...dates]).toEqual(expect.arrayContaining(['2026-08-03', '2026-08-05']));
    expect(repCells).toContain('9');
  });

  it('exports logged sets whose prescription is no longer in the plan', async () => {
    const day = plan.weeks[0]!.days[0]!;
    const session = makeSession({
      dayId: day.id,
      results: [
        makeResult('inverted-row', [{ reps: 7 }, { reps: 6 }], {
          prescriptionId: 'presc-that-no-longer-exists',
        }),
      ],
    });

    const wb = await buildWorkbook({
      plan,
      sessions: [session],
      records: [],
      settings: makeSettings(),
    });
    const week1 = wb.getWorksheet('Week 1')!;
    const rows: string[] = [];
    week1.eachRow((row) => rows.push(`${row.getCell(3).text}|${row.getCell(9).text}`));
    expect(rows.some((r) => r.startsWith('Unmatched') && r.includes('7 · 6'))).toBe(true);
  });

  it('labels sets by the exercise performed, not the plan’s current exercise', async () => {
    const day = plan.weeks[0]!.days[0]!;
    const prescription = day.prescriptions[1]!;
    const session = makeSession({
      dayId: day.id,
      results: [makeResult('strict-pull-up', [{ reps: 5 }], { prescriptionId: prescription.id })],
    });
    // The user later edits that slot to a different exercise; the id is preserved.
    const editedPlan = {
      ...plan,
      weeks: plan.weeks.map((w) =>
        w.weekNumber !== 1
          ? w
          : {
              ...w,
              days: w.days.map((d) =>
                d.id !== day.id
                  ? d
                  : {
                      ...d,
                      prescriptions: d.prescriptions.map((p) =>
                        p.id === prescription.id ? { ...p, exerciseId: 'goblet-squat' } : p,
                      ),
                    },
              ),
            },
      ),
    };

    const wb = await buildWorkbook({
      plan: editedPlan,
      sessions: [session],
      records: [],
      settings: makeSettings(),
    });
    const week1 = wb.getWorksheet('Week 1')!;
    let labelForTheSet = '';
    week1.eachRow((row) => {
      if (row.getCell(9).text === '5') labelForTheSet = row.getCell(4).text;
    });
    expect(labelForTheSet).toBe('Strict Pull-Up');
  });

  it('does not throw on a plan with an unparseable start date', async () => {
    const wb = await buildWorkbook({
      plan: { ...plan, startDate: '', completedAt: null },
      sessions: [],
      records: [],
      settings: makeSettings(),
    });
    const summary = wb.getWorksheet('Summary')!;
    const map = new Map<string, unknown>();
    summary.eachRow((row) => map.set(row.getCell(1).text, row.getCell(2).value));
    expect(map.get('Plan end date (projected)')).toBe('—');
  });

  it('does not throw on a plan carrying duplicate week numbers', async () => {
    const wb = await buildWorkbook({
      plan: { ...plan, weeks: [plan.weeks[0]!, plan.weeks[0]!] },
      sessions: [],
      records: [],
      settings: makeSettings(),
    });
    expect(wb.worksheets.map((s) => s.name)).toContain('Week 1 (2)');
  });

  it('includes the final assessment when one exists', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
      assessment: {
        id: 'a1',
        createdAt: '2026-08-28T10:00:00Z',
        updatedAt: '2026-08-28T10:00:00Z',
        schemaVersion: 1,
        planId: plan.id,
        date: '2026-08-28',
        maxStrictPullUps: 4,
        maxChinUps: 6,
        maxPushUps: 25,
        deadHangSeconds: 60,
        singleLegBalanceSeconds: 45,
        kneeComfort: 1,
        shoulderComfort: 1,
        lowerBackComfort: 0,
        overallEnergy: 8,
        favoriteExercises: ['step-up'],
        painfulExercises: [],
        readyForNextProgram: 'yes',
        notes: 'Knees feel much better.',
      },
    });
    const summary = wb.getWorksheet('Summary')!;
    const map = new Map<string, unknown>();
    summary.eachRow((row) => map.set(row.getCell(1).text, row.getCell(2).value));
    expect(map.get('Max strict pull-ups')).toBe(4);
    expect(map.get('Favourite exercises')).toBe('Step-Up');
    expect(map.get('Ready for the next four-day program')).toBe('yes');
  });
});

/* ------------------------------------------------------------------ */
/* Ironpath: per-set rows, ramp sets, multi-plan                        */
/* ------------------------------------------------------------------ */

const hypertrophyPlan = makePlan({
  id: 'plan_hyp',
  name: '14-Week Hypertrophy — Upper / Lower',
  programId: 'hypertrophy-14wk',
  weeks: PROGRAMS['hypertrophy-14wk'].buildWeeks(),
});

/** Reads a sheet into header-keyed objects so the tests do not hardcode indices. */
function rowsOf(sheet: ExcelJS.Worksheet): Record<string, string>[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cell.text;
  });
  const out: Record<string, string>[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const record: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col];
      if (key) record[key] = cell.text;
    });
    out.push(record);
  });
  return out;
}

describe('sanitizeSheetName', () => {
  it('strips the characters Excel rejects', () => {
    expect(sanitizeSheetName('Upper/Lower [A]: 3*4?')).toBe('Upper Lower A 3 4');
  });

  it('caps the name at 31 characters', () => {
    const name = sanitizeSheetName('x'.repeat(60));
    expect(name).toHaveLength(31);
  });

  it('never returns an empty name', () => {
    expect(sanitizeSheetName('///')).toBe('Sheet');
  });
});

describe('phaseLabel', () => {
  it('appends the block week inside the hypertrophy block', () => {
    expect(phaseLabel({ phase: 'hypertrophy', blockWeek: 7 })).toBe('Hypertrophy W7');
    expect(phaseLabel({ phase: 'reload', blockWeek: null })).toBe('Reload');
    expect(phaseLabel({ phase: 'deload', blockWeek: null })).toBe('Deload');
  });
});

describe('plansOf', () => {
  it('always covers the active plan and never duplicates it', () => {
    const input = {
      plan,
      plans: [plan, hypertrophyPlan],
      sessions: [],
      records: [],
      settings: makeSettings(),
    };
    expect(plansOf(input).map((p) => p.id)).toEqual(['plan_1', 'plan_hyp']);
  });
});

describe('Sets sheet', () => {
  const week3 = hypertrophyPlan.weeks[2]!;
  const upperA = week3.days[0]!;
  const pullUp = upperA.prescriptions.find((p) => p.exerciseId === 'band-assisted-pull-up')!;
  const press = upperA.prescriptions.find((p) => p.exerciseId === 'incline-dumbbell-press')!;

  function hypertrophySession() {
    return makeSession({
      planId: hypertrophyPlan.id,
      dayId: upperA.id,
      weekNumber: week3.weekNumber,
      weekday: upperA.weekday,
      dayType: upperA.dayType,
      date: '2026-08-24',
      elapsedSeconds: 3060,
      results: [
        makeResult(
          'band-assisted-pull-up',
          [
            { setNumber: 1, reps: 10, rir: 2, band: 'medium' },
            { setNumber: 2, reps: 9, rir: 1, band: 'medium' },
          ],
          { prescriptionId: pullUp.id },
        ),
        makeResult(
          'incline-dumbbell-press',
          [
            // A ramp set: logged, exported, but never counted. `setNumber` is unique
            // across the whole array, so the working sets continue from 2 — they do
            // not restart at 1.
            { setNumber: 1, reps: 6, weight: 16, isWarmUp: true, rir: 5 },
            { setNumber: 2, reps: 10, weight: 30, rir: 2 },
            { setNumber: 3, reps: 9, weight: 30, rir: 1 },
          ],
          { prescriptionId: press.id, notes: 'Left shoulder felt fine.' },
        ),
      ],
    });
  }

  async function build() {
    return buildWorkbook({
      plan: hypertrophyPlan,
      sessions: [hypertrophySession()],
      records: [],
      settings: makeSettings(),
    });
  }

  it('carries every required column on each set row', async () => {
    const sheet = (await build()).getWorksheet('Sets')!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'Program',
      'Week',
      'Week label',
      'Phase',
      'Date',
      'Weekday',
      'Day',
      'Slot',
      'Exercise',
      'Set',
      'Set label',
      'Set type',
      'Weight',
      'Reps',
      'Reps (left)',
      'Reps (right)',
      'Band',
      'Duration (s)',
      'RIR',
      'RPE',
      'Completed',
      'Notes',
    ]);

    const rows = rowsOf(sheet);
    expect(rows).toHaveLength(5);
    const first = rows[0]!;
    expect(first['Program']).toBe('14-Week Hypertrophy — Upper / Lower');
    expect(first['Week']).toBe('3');
    expect(first['Week label']).toBe(week3.title);
    expect(first['Phase']).toBe('Hypertrophy W1');
    expect(first['Date']).toBe('2026-08-24');
    expect(first['Weekday']).toBe('Monday');
    expect(first['Day']).toBe(upperA.title);
    expect(first['Slot']).toBe(pullUp.slot);
    expect(first['Exercise']).toBe('Band-Assisted Pull-Up');
    expect(first['Set']).toBe('1');
    expect(first['Set label']).toBe('1');
    expect(first['Set type']).toBe('Work');
    expect(first['Reps']).toBe('10');
    expect(first['RIR']).toBe('2');
    expect(first['Completed']).toBe('Yes');
  });

  it('labels the band with the user’s own naming', async () => {
    const wb = await buildWorkbook({
      plan: hypertrophyPlan,
      sessions: [hypertrophySession()],
      records: [],
      settings: makeSettings({
        bandLabels: { ...makeSettings().bandLabels, medium: 'Green loop' },
      }),
    });
    const rows = rowsOf(wb.getWorksheet('Sets')!);
    expect(rows[0]!['Band']).toBe('Green loop');
  });

  it('exports ramp sets but marks them Ramp', async () => {
    const rows = rowsOf((await build()).getWorksheet('Sets')!);
    const rampRows = rows.filter((r) => r['Set type'] === 'Ramp');
    expect(rampRows).toHaveLength(1);
    expect(rampRows[0]!['Exercise']).toBe('Incline Dumbbell Press');
    expect(rampRows[0]!['Weight']).toBe('16');
    expect(rows.filter((r) => r['Set type'] === 'Work')).toHaveLength(4);
  });

  /**
   * `setNumber` runs 1,2,3 across the ramp set and the two working sets. Printing it
   * raw would call the first working set "set 2 of 2"; the label counts each kind on
   * its own while the raw number stays available for addressing the row.
   */
  it('numbers ramp and working sets separately in the Set label column', async () => {
    const rows = rowsOf((await build()).getWorksheet('Sets')!).filter(
      (r) => r['Exercise'] === 'Incline Dumbbell Press',
    );
    expect(rows.map((r) => [r['Set'], r['Set label'], r['Set type']])).toEqual([
      ['1', 'Ramp 1', 'Ramp'],
      ['2', '1', 'Work'],
      ['3', '2', 'Work'],
    ]);
  });

  it('writes per-side reps into their own columns', async () => {
    const week = hypertrophyPlan.weeks[2]!;
    const lowerB = week.days[3]!;
    const split = lowerB.prescriptions.find((p) => p.exerciseId === 'supported-split-squat')!;
    const wb = await buildWorkbook({
      plan: hypertrophyPlan,
      sessions: [
        makeSession({
          planId: hypertrophyPlan.id,
          dayId: lowerB.id,
          weekNumber: week.weekNumber,
          weekday: lowerB.weekday,
          dayType: lowerB.dayType,
          results: [
            makeResult('supported-split-squat', [{ setNumber: 1, repsLeft: 10, repsRight: 9 }], {
              prescriptionId: split.id,
            }),
          ],
        }),
      ],
      records: [],
      settings: makeSettings(),
    });
    const row = rowsOf(wb.getWorksheet('Sets')!)[0]!;
    expect(row['Reps (left)']).toBe('10');
    expect(row['Reps (right)']).toBe('9');
    expect(row['Reps']).toBe('');
  });

  it('keeps ramp sets out of every week-sheet total', async () => {
    const wb = await build();
    const rows = rowsOf(wb.getWorksheet('Week 3')!);
    const pressRow = rows.find((r) => r['Exercise'] === 'Incline Dumbbell Press')!;
    // The 16 kg ramp must not become the actual weight, and 6 must not join the reps.
    expect(pressRow['Actual weight']).toBe('30');
    expect(pressRow['Actual reps by set']).toBe('10 · 9');
    expect(pressRow['Ramp sets']).toBe('6');
    // Ramp RIR 5 would drag the average from 1.5 up to 2.7.
    expect(Number(pressRow['RIR'])).toBeCloseTo(1.5);
  });
});

describe('Sessions sheet', () => {
  it('carries the workout duration and both pain entries', async () => {
    const session = makeSession({
      planId: plan.id,
      dayId: plan.weeks[0]!.days[0]!.id,
      elapsedSeconds: 2940,
      painBefore: makePain({ leftKnee: 2 }),
      painAfter: makePain({ leftKnee: 4, comments: 'Knee warmed up' }),
      sessionNotes: 'Good session.',
    });
    const wb = await buildWorkbook({
      plan,
      sessions: [session],
      records: [],
      settings: makeSettings(),
    });
    const row = rowsOf(wb.getWorksheet('Sessions')!)[0]!;
    expect(row['Duration']).toBe('49:00');
    expect(Number(row['Duration (min)'])).toBeCloseTo(49);
    expect(row['Pain before (L/R knee)']).toBe('2/1');
    expect(row['Pain after (L/R knee)']).toBe('4/1');
    expect(row['Pain comments']).toBe('Knee warmed up');
    expect(row['Session notes']).toBe('Good session.');
  });
});

describe('multi-plan export', () => {
  it('covers both plans without colliding sheet names', async () => {
    const wb = await buildWorkbook({
      plan: hypertrophyPlan,
      plans: [hypertrophyPlan, plan],
      sessions: [],
      records: [],
      settings: makeSettings(),
    });
    const names = wb.worksheets.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
    // 15 hypertrophy weeks + 4 resilience weeks, each prefixed by its program.
    expect(names).toContain('Hypertrophy 14 W1');
    expect(names).toContain('Hypertrophy 14 W15');
    expect(names).toContain(`${PROGRAMS['movement-resilience'].shortName} W1`);
    expect(names.filter((n) => /W\d+$/.test(n))).toHaveLength(19);
  });

  it('files each session under its own plan', async () => {
    const resilienceSession = makeSession({
      planId: plan.id,
      dayId: plan.weeks[0]!.days[0]!.id,
      results: [
        makeResult('standard-push-up', [{ reps: 12 }], {
          prescriptionId: plan.weeks[0]!.days[0]!.prescriptions[5]!.id,
        }),
      ],
    });
    const hypWeek = hypertrophyPlan.weeks[2]!;
    const hypDay = hypWeek.days[0]!;
    const hypSession = makeSession({
      planId: hypertrophyPlan.id,
      dayId: hypDay.id,
      weekNumber: hypWeek.weekNumber,
      weekday: hypDay.weekday,
      dayType: hypDay.dayType,
      results: [
        makeResult('band-assisted-pull-up', [{ reps: 8, band: 'medium' }], {
          prescriptionId: hypDay.prescriptions[1]!.id,
        }),
      ],
    });

    const wb = await buildWorkbook({
      plan: hypertrophyPlan,
      plans: [hypertrophyPlan, plan],
      sessions: [hypSession, resilienceSession],
      records: [],
      settings: makeSettings(),
    });
    const sets = rowsOf(wb.getWorksheet('Sets')!);
    expect(sets).toHaveLength(2);
    const byExercise = new Map(sets.map((r) => [r['Exercise'], r['Program']]));
    expect(byExercise.get('Band-Assisted Pull-Up')).toBe('14-Week Hypertrophy — Upper / Lower');
    expect(byExercise.get('Standard Push-Up')).toBe('Movement & Joint Resilience');

    const summary = new Map<string, unknown>();
    wb.getWorksheet('Summary')!.eachRow((row) =>
      summary.set(row.getCell(1).text, row.getCell(2).text),
    );
    expect(summary.get('Programs exported')).toBe(
      '14-Week Hypertrophy — Upper / Lower · Movement & Joint Resilience',
    );
  });
});
