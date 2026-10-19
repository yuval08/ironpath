import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bestExerciseMatch,
  parseLegacyTracker,
  parseWorkbookRows,
  scoreMatch,
  tokenize,
} from './excelImport';

const LEGACY_FILE = resolve(__dirname, '../../workout_tracker_12wk.xlsx');

describe('tokenize', () => {
  it('drops equipment noise words and parenthetical detail', () => {
    expect(tokenize('DB Bench Press (neutral/30° incline)')).toEqual(['bench', 'press']);
  });

  it('normalises punctuation', () => {
    expect(tokenize('Pull-Up / Lat Pulldown')).toEqual(['pull', 'up', 'lat', 'pulldown']);
  });
});

describe('scoreMatch', () => {
  it('scores an exact name higher than a partial one', () => {
    const exact = scoreMatch('DB Hip Thrust', 'hip-thrust', 'Hip Thrust');
    const partial = scoreMatch('DB Hip Thrust', 'glute-bridge', 'Glute Bridge');
    expect(exact).toBeGreaterThan(partial);
  });

  it('returns 0 for unrelated names', () => {
    expect(scoreMatch('Lying Leg Curl', 'shoulder-car', 'Shoulder CAR')).toBe(0);
  });
});

describe('bestExerciseMatch', () => {
  it.each([
    ['DB Hip Thrust', 'hip-thrust'],
    ['Box squat', 'goblet-squat'],
    ['Chest-Supported DB Row', 'inverted-row'],
    ['Smith Bulgarian Split Squat', 'supported-split-squat'],
    ['Leg Extension + Standing Calf Raise (SS)', 'standing-calf-raise'],
  ])('maps %s to %s', (source, expected) => {
    expect(bestExerciseMatch(source)?.id).toBe(expected);
  });

  it('returns null when nothing is close enough', () => {
    expect(bestExerciseMatch('Sauna 20 minutes')).toBeNull();
  });
});

describe('parseLegacyTracker (real 12-week tracker)', () => {
  it('extracts the heaviest working weight per exercise', async () => {
    const buffer = readFileSync(LEGACY_FILE);
    const { rowsParsed, weights } = await parseLegacyTracker(new Uint8Array(buffer), 'kg');

    expect(rowsParsed).toBeGreaterThan(50);
    expect(weights.length).toBeGreaterThan(5);

    const byName = new Map(weights.map((w) => [w.sourceExerciseName, w]));
    const hipThrust = byName.get('DB Hip Thrust');
    expect(hipThrust).toBeDefined();
    expect(hipThrust?.mappedExerciseId).toBe('hip-thrust');
    expect(hipThrust?.bestWeight).toBeGreaterThan(0);
    expect(hipThrust?.suggestedStartWeight).toBe(
      Math.max(2.5, Math.round((hipThrust!.bestWeight * 0.5) / 2.5) * 2.5),
    );
  });

  it('marks every parsed weight as unconfirmed so the user must review the mapping', async () => {
    const buffer = readFileSync(LEGACY_FILE);
    const { weights } = await parseLegacyTracker(new Uint8Array(buffer));
    expect(weights.every((w) => w.confirmed === false)).toBe(true);
    expect(weights.every((w) => w.id.startsWith('imported_'))).toBe(true);
  });
});

describe('set-column alignment (regression)', () => {
  it('matches reps by set number when a reps column is missing or reordered', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Partial columns');
    sheet.addRow(['Exercise', 'S1 Wt', 'S2 Wt', 'S2 Reps']);
    sheet.addRow(['Hip Thrust', 60, 50, 12]);
    sheet.addRow(['Goblet Squat', 20, 30, 10]);
    sheet.addRow(['Exercise', 'S1 Wt', 'S2 Wt', 'S2 Reps', 'S1 Reps']);
    sheet.addRow(['Farmer Carry', 40, 30, 15, 8]);

    expect(parseWorkbookRows(wb).map((row) => [row.bestWeight, row.bestReps])).toEqual([
      [60, null],
      [30, 10],
      [40, 8],
    ]);
  });

  /**
   * A blank or zero weight to the left of the best set used to shift the reps
   * lookup, reporting a different set's rep count on the import confirm screen.
   */
  it('reads reps from the same set the best weight came from', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Wk01');
    sheet.addRow([
      'Exercise',
      'Target Reps',
      'S1 Wt',
      'S1 Reps',
      'S2 Wt',
      'S2 Reps',
      'S3 Wt',
      'S3 Reps',
    ]);
    // S1 is a bodyweight set (no weight, 20 reps); the best weight is S2's 60x8.
    sheet.addRow(['Chest Supported Row', '8-12', null, 20, 60, 8, 50, 10]);
    const buffer = await wb.xlsx.writeBuffer();

    const { weights } = await parseLegacyTracker(new Uint8Array(buffer as ArrayBuffer));
    const row = weights.find((w) => w.sourceExerciseName === 'Chest Supported Row');
    expect(row?.bestWeight).toBe(60);
    expect(row?.bestReps).toBe(8);
  });
});
