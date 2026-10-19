import { format } from 'date-fns';
import { db, SETTINGS_ID } from '@/db/db';
import { isFutureSchema, migrateAll } from '@/db/migrations';
import { SCHEMA_VERSION, backupFileSchema } from '@/types';
import type { BackupFile, UserSettings, WorkoutPlan } from '@/types';
import { triggerDownload } from './excelExport';

export async function buildBackup(): Promise<BackupFile> {
  const [plans, sessions, personalRecords, settings, suggestions, assessments, importedWeights] =
    await db.transaction(
      'r',
      [
        db.plans,
        db.sessions,
        db.personalRecords,
        db.settings,
        db.suggestions,
        db.assessments,
        db.importedWeights,
      ],
      () =>
        Promise.all([
          db.plans.toArray(),
          db.sessions.toArray(),
          db.personalRecords.toArray(),
          db.settings.toArray(),
          db.suggestions.toArray(),
          db.assessments.toArray(),
          db.importedWeights.toArray(),
        ]),
    );

  return {
    // The app is Ironpath now. `backupFileSchema` still accepts the old literal,
    // so backups taken before the rename keep importing (see restoreBackup).
    app: 'ironpath',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    plans,
    sessions,
    personalRecords,
    settings,
    suggestions,
    assessments,
    importedWeights,
  };
}

export function backupFileName(date = new Date()): string {
  return `ironpath-backup-${format(date, 'yyyy-MM-dd')}.json`;
}

export async function downloadBackup(): Promise<string> {
  const data = await buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = backupFileName();
  await triggerDownload(blob, name);
  return name;
}

export interface RestoreResult {
  plans: number;
  sessions: number;
  records: number;
  assessments: number;
}

/**
 * A backup can name an `activePlanId` that is not in the file — the plan was deleted
 * after the pointer was written. Active-plan resolution falls back on its own, but a
 * dangling pointer in the database is one consumer away from resolving to `undefined`
 * and stranding the app on "Loading your plan..." with no route to Settings. Restoring
 * a pointer that cannot resolve buys nothing, so drop it to null, which resolution
 * already means "use the first non-archived plan".
 */
function withResolvableActivePlan(settings: UserSettings[], plans: WorkoutPlan[]): UserSettings[] {
  const ids = new Set(plans.map((p) => p.id));
  return settings.map((s) =>
    s.activePlanId != null && !ids.has(s.activePlanId) ? { ...s, activePlanId: null } : s,
  );
}

/** Validates, migrates and replaces all local data with the backup contents. */
export async function restoreBackup(json: unknown): Promise<RestoreResult> {
  const parsed = backupFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Not a valid backup file: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
    );
  }
  const data = parsed.data;
  if (isFutureSchema(data.schemaVersion)) {
    throw new Error(
      `This backup was created by a newer version of the app (schema ${data.schemaVersion}). Update the app first.`,
    );
  }
  // Restoring an empty backup would clear every table and leave the app with no
  // plan to render — seeding only runs once at startup, so it would sit on the
  // loading screen until a reload.
  if (data.plans.length === 0 || data.settings.length === 0) {
    throw new Error('That backup contains no plan or settings — nothing was changed.');
  }
  // Schemas validate individual rows; these checks enforce the database's keys
  // before replacing anything. bulkPut otherwise silently overwrites duplicates.
  if (data.settings.length !== 1 || data.settings[0]!.id !== SETTINGS_ID) {
    throw new Error('That backup has invalid settings — nothing was changed.');
  }
  for (const name of [
    'plans',
    'sessions',
    'personalRecords',
    'settings',
    'suggestions',
    'assessments',
    'importedWeights',
  ] as const) {
    const rows = data[name];
    if (new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new Error(`That backup has duplicate ${name} IDs — nothing was changed.`);
    }
    if (rows.some((row) => isFutureSchema(row.schemaVersion))) {
      throw new Error(
        'This backup contains records from a newer version of the app. Update the app first.',
      );
    }
  }

  await db.transaction(
    'rw',
    [
      db.plans,
      db.sessions,
      db.personalRecords,
      db.settings,
      db.suggestions,
      db.assessments,
      db.importedWeights,
    ],
    async () => {
      await Promise.all([
        db.plans.clear(),
        db.sessions.clear(),
        db.personalRecords.clear(),
        db.settings.clear(),
        db.suggestions.clear(),
        db.assessments.clear(),
        db.importedWeights.clear(),
      ]);
      const plans = migrateAll(data.plans);
      await db.plans.bulkPut(plans);
      await db.sessions.bulkPut(migrateAll(data.sessions));
      await db.personalRecords.bulkPut(migrateAll(data.personalRecords));
      await db.settings.bulkPut(withResolvableActivePlan(migrateAll(data.settings), plans));
      await db.suggestions.bulkPut(migrateAll(data.suggestions));
      await db.assessments.bulkPut(migrateAll(data.assessments));
      await db.importedWeights.bulkPut(migrateAll(data.importedWeights));
    },
  );

  return {
    plans: data.plans.length,
    sessions: data.sessions.length,
    records: data.personalRecords.length,
    assessments: data.assessments.length,
  };
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
}
