import type ExcelJS from 'exceljs';
import { loadExcelJS } from './excelModule';
import { EXERCISES, EXERCISE_BY_ID } from '@/data/exercises';
import { newId, nowIso } from '@/db/db';
import { SCHEMA_VERSION, type ImportedWeight, type WeightUnit } from '@/types';
import { suggestStartWeight } from './progression';

/**
 * Reads a previous workout tracker (like workout_tracker_12wk.xlsx) and pulls out
 * the heaviest working weight seen per exercise name.
 *
 * The parser is header-driven rather than layout-driven: on every sheet it looks
 * for a row containing a cell "Exercise", then reads the "S<n> Wt" / "S<n> Reps"
 * columns from that header. It therefore also handles trackers with a different
 * number of sets or extra columns.
 */

export interface ParsedRow {
  sheet: string;
  exercise: string;
  bestWeight: number;
  bestReps: number | null;
}

const WEIGHT_HEADER = /^s\s*\d+\s*(wt|weight)$/i;
const REPS_HEADER = /^s\s*\d+\s*reps$/i;

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText
      .map((r) => r.text)
      .join('')
      .trim();
  }
  if (typeof value === 'object' && 'text' in value) return String(value.text).trim();
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && value && 'result' in value) {
    const r = (value as { result?: unknown }).result;
    return typeof r === 'number' ? r : null;
  }
  const text = cellText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) && text.match(/\d/) ? parsed : null;
}

export function parseWorkbookRows(wb: ExcelJS.Workbook): ParsedRow[] {
  const rows: ParsedRow[] = [];

  wb.eachSheet((sheet) => {
    let exerciseCol: number | null = null;
    let weightCols: number[] = [];
    let repsCols: number[] = [];

    sheet.eachRow((row) => {
      const texts: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        texts[col] = cellText(cell.value);
      });

      const headerIndex = texts.findIndex((t) => t?.toLowerCase() === 'exercise');
      if (headerIndex > 0) {
        exerciseCol = headerIndex;
        weightCols = [];
        repsCols = [];
        texts.forEach((t, col) => {
          if (!t) return;
          if (WEIGHT_HEADER.test(t)) weightCols.push(col);
          if (REPS_HEADER.test(t)) repsCols.push(col);
        });
        return;
      }

      if (exerciseCol == null || weightCols.length === 0) return;
      const name = texts[exerciseCol];
      if (!name || name.length < 3) return;
      // Skip section headings like "Upper" / "Lower" that have no numeric data.
      // Carry the column alongside the value: filtering first and then indexing
      // the unfiltered column list reads reps from a different set whenever a
      // blank or zero weight sits to the left of the best one.
      const scored = weightCols
        .map((col) => ({ col, value: cellNumber(row.getCell(col).value) }))
        .filter((x): x is { col: number; value: number } => x.value != null && x.value > 0);
      if (scored.length === 0) return;

      const best = scored.reduce((a, b) => (b.value > a.value ? b : a));
      const bestWeight = best.value;
      const repsCol = repsCols[weightCols.indexOf(best.col)];
      const bestReps = repsCol ? cellNumber(row.getCell(repsCol).value) : null;

      rows.push({ sheet: sheet.name, exercise: name, bestWeight, bestReps });
    });
  });

  return rows;
}

/* ------------------------------------------------------------------ */
/* Fuzzy mapping to the library                                        */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  'db',
  'dumbbell',
  'barbell',
  'bb',
  'machine',
  'smith',
  'seated',
  'standing',
  'the',
  'and',
  'or',
  'ss',
  'with',
  'to',
  'per',
  'side',
  'leg',
]);

/**
 * Words shared by many unrelated movements. Matching on one of these alone maps
 * a leg press to a Pallof press, so they only count alongside a specific word.
 */
const GENERIC_TOKENS = new Set([
  'press',
  'row',
  'raise',
  'curl',
  'extension',
  'squat',
  'walk',
  'hold',
  'pull',
  'push',
  'up',
  'down',
  'lift',
]);

/** Extra aliases that token overlap alone would miss. */
const ALIASES: Record<string, string[]> = {
  'hip-thrust': ['hip thrust', 'glute bridge barbell'],
  'goblet-squat': ['squat', 'box squat', 'front squat', 'goblet'],
  'inverted-row': ['row', 'chest supported row', 'one arm row', 'cable row', 'seated row'],
  'trx-row': ['trx', 'ring row'],
  'step-up': ['step up', 'box step'],
  'farmer-carry': ['farmer carry', 'farmers walk', 'carry'],
  'standing-calf-raise': ['calf raise', 'calf press'],
  'strict-pull-up': ['pull up', 'pull-up', 'lat pulldown', 'pulldown'],
  'chin-up': ['chin up'],
  'standard-push-up': ['push up', 'push-up', 'floor press', 'bench press'],
  'hamstring-slider-curl': ['leg curl', 'hamstring curl'],
  'glute-bridge': ['glute bridge'],
  'sl-rdl-bodyweight': ['romanian deadlift', 'rdl', 'deadlift'],
  'supported-split-squat': ['split squat', 'lunge'],
  'band-face-pull': ['face pull', 'rear delt'],
  'suitcase-carry': ['suitcase'],
  'pallof-press': ['pallof'],
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function scoreMatch(sourceName: string, exerciseId: string, exerciseName: string): number {
  const source = tokenize(sourceName);
  if (source.length === 0) return 0;
  const sourceSet = new Set(source);

  let best = 0;

  // The exercise's own name scores proportionally — but a shared GENERIC word is
  // not a match on its own. "Leg press" and "Standing Pallof Press" share only
  // "press"; "DB Lateral Raise" and "Standing Calf Raise" only "raise".
  const name = tokenize(exerciseName);
  if (name.length > 0) {
    const shared = name.filter((t) => sourceSet.has(t));
    const meaningful = shared.some((t) => !GENERIC_TOKENS.has(t));
    if (shared.length > 0 && (meaningful || shared.length === name.length)) {
      best = shared.length / name.length + shared.length / source.length / 2;
    }
  }

  // Aliases must appear in FULL. A partial alias hit is how "Leg press" matched
  // the "floor press" alias and became a Standard Push-Up.
  for (const alias of ALIASES[exerciseId] ?? []) {
    const target = tokenize(alias);
    if (target.length === 0) continue;
    if (!target.every((t) => sourceSet.has(t))) continue;
    best = Math.max(best, 1 + target.length / source.length / 2);
  }

  return best;
}

export function bestExerciseMatch(sourceName: string): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const ex of EXERCISES) {
    const score = scoreMatch(sourceName, ex.id, ex.name);
    if (score > 0 && (!best || score > best.score)) best = { id: ex.id, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

export interface ImportSummary {
  rowsParsed: number;
  weights: ImportedWeight[];
}

export async function parseLegacyTracker(
  file: ArrayBuffer | Uint8Array,
  unit: WeightUnit = 'kg',
): Promise<ImportSummary> {
  const Excel = await loadExcelJS();
  const wb = new Excel.Workbook();
  // Normalise to a Uint8Array: an ArrayBuffer created in another JS realm
  // (Node buffer, worker, test env) fails JSZip's `instanceof ArrayBuffer` check.
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const rows = parseWorkbookRows(wb);

  const grouped = new Map<string, { best: number; reps: number | null; count: number }>();
  for (const row of rows) {
    const key = row.exercise.trim();
    const current = grouped.get(key);
    if (!current || row.bestWeight > current.best) {
      grouped.set(key, {
        best: row.bestWeight,
        reps: row.bestReps,
        count: (current?.count ?? 0) + 1,
      });
    } else {
      current.count += 1;
    }
  }

  const ts = nowIso();
  const weights: ImportedWeight[] = [...grouped.entries()].map(([name, info]) => {
    const match = bestExerciseMatch(name);
    // A previous barbell/machine load means nothing for a movement that carries no
    // external load — a pull-up, an inverted row, a slider curl. Suggesting one
    // there is worse than suggesting nothing.
    const target = match ? EXERCISE_BY_ID[match.id] : undefined;
    const takesLoad =
      target != null && target.loadType !== 'bodyweight' && target.loadType !== 'none';
    return {
      id: newId('imported'),
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: SCHEMA_VERSION,
      sourceExerciseName: name,
      mappedExerciseId: match?.id ?? null,
      bestWeight: info.best,
      bestReps: info.reps,
      unit,
      occurrences: info.count,
      confirmed: false,
      suggestedStartWeight: takesLoad ? suggestStartWeight(info.best) : null,
    };
  });

  return { rowsParsed: rows.length, weights };
}
