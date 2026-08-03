import type ExcelJS from 'exceljs';
import { loadExcelJS } from './excelModule';
import { EXERCISES } from '@/data/exercises';
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
      const weights = weightCols
        .map((c) => cellNumber(row.getCell(c).value))
        .filter((v): v is number => v != null && v > 0);
      if (weights.length === 0) return;

      const bestWeight = Math.max(...weights);
      const bestIndex = weightCols[weights.indexOf(bestWeight)];
      const repsCol = repsCols[weightCols.indexOf(bestIndex ?? -1)];
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

  const candidates = [exerciseName, ...(ALIASES[exerciseId] ?? [])];
  let best = 0;
  for (const candidate of candidates) {
    const target = tokenize(candidate);
    if (target.length === 0) continue;
    const overlap = target.filter((t) => sourceSet.has(t)).length;
    if (overlap === 0) continue;
    // Reward matching a high proportion of the *target* name.
    const score = overlap / target.length + overlap / source.length / 2;
    best = Math.max(best, score);
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
      suggestedStartWeight: suggestStartWeight(info.best),
    };
  });

  return { rowsParsed: rows.length, weights };
}
