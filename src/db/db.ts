import Dexie, { type Table } from 'dexie';
import type {
  FinalAssessment,
  ImportedWeight,
  PersonalRecord,
  ProgressionSuggestion,
  UserSettings,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

export class ResilienceDB extends Dexie {
  plans!: Table<WorkoutPlan, string>;
  sessions!: Table<WorkoutSession, string>;
  personalRecords!: Table<PersonalRecord, string>;
  settings!: Table<UserSettings, string>;
  suggestions!: Table<ProgressionSuggestion, string>;
  assessments!: Table<FinalAssessment, string>;
  importedWeights!: Table<ImportedWeight, string>;
  meta!: Table<MetaRow, string>;

  // The app is now Ironpath, but the IndexedDB name stays 'movement-resilience':
  // the database is keyed by name, so renaming it would open a fresh, empty DB and
  // orphan every existing user's training history. Cosmetic rename, real data loss.
  constructor(name = 'movement-resilience') {
    super(name);
    // v1 — initial schema. Add a new .version() block for any future change and
    // register the data transform in src/db/migrations.ts.
    this.version(1).stores({
      plans: 'id, startDate, currentWeek',
      sessions: 'id, planId, dayId, date, status, weekNumber, dayType',
      personalRecords: 'id, kind, date',
      settings: 'id',
      suggestions: 'id, exerciseId, status',
      assessments: 'id, planId, date',
      importedWeights: 'id, sourceExerciseName, mappedExerciseId',
      meta: 'key',
    });
    // v2 — multi-program plans. Only the plans index changes (programId, archived);
    // the record-shape transform lives in src/db/migrations.ts as { to: 2 }.
    //
    // `archived` is decorative: IndexedDB rejects booleans as index keys, so Dexie
    // silently omits every plan row from it. Never query through it —
    // `where('archived').equals(false)` returns nothing. Filter in memory instead.
    this.version(2).stores({
      plans: 'id, startDate, currentWeek, programId, archived',
      sessions: 'id, planId, dayId, date, status, weekNumber, dayType',
      personalRecords: 'id, kind, date',
      settings: 'id',
      suggestions: 'id, exerciseId, status',
      assessments: 'id, planId, date',
      importedWeights: 'id, sourceExerciseName, mappedExerciseId',
      meta: 'key',
    });
  }
}

export const db = new ResilienceDB();

export const SETTINGS_ID = 'settings';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

/** Requests persistent storage so the browser will not evict the workout history. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
