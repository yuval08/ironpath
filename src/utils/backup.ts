import { format } from 'date-fns';
import { db } from '@/db/db';
import { isFutureSchema, migrateAll } from '@/db/migrations';
import { SCHEMA_VERSION, backupFileSchema, type BackupFile } from '@/types';
import { triggerDownload } from './excelExport';

export async function buildBackup(): Promise<BackupFile> {
  const [plans, sessions, personalRecords, settings, suggestions, assessments, importedWeights] =
    await Promise.all([
      db.plans.toArray(),
      db.sessions.toArray(),
      db.personalRecords.toArray(),
      db.settings.toArray(),
      db.suggestions.toArray(),
      db.assessments.toArray(),
      db.importedWeights.toArray(),
    ]);

  return {
    app: 'movement-resilience',
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
  return `movement-resilience-backup-${format(date, 'yyyy-MM-dd')}.json`;
}

export async function downloadBackup(): Promise<string> {
  const data = await buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = backupFileName();
  triggerDownload(blob, name);
  return name;
}

export interface RestoreResult {
  plans: number;
  sessions: number;
  records: number;
  assessments: number;
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
      await db.plans.bulkPut(migrateAll(data.plans));
      await db.sessions.bulkPut(migrateAll(data.sessions));
      await db.personalRecords.bulkPut(migrateAll(data.personalRecords));
      await db.settings.bulkPut(migrateAll(data.settings));
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
