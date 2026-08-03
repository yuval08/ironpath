import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook, exportFileName, progressionSeries } from './excelExport';
import { makePain, makePlan, makeResult, makeSession, makeSettings } from '@/test/factories';

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
  it('uses the required movement-resilience-workout-YYYY-MM-DD.xlsx pattern', () => {
    expect(exportFileName(new Date('2026-08-28T10:00:00Z'))).toBe(
      'movement-resilience-workout-2026-08-28.xlsx',
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
  it('creates all eight required sheets in order', async () => {
    const wb = await buildWorkbook({
      plan,
      sessions: sessionsFixture(),
      records: [],
      settings: makeSettings(),
    });
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
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
