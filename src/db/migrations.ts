import { SCHEMA_VERSION } from '@/types';

/**
 * Record-level migrations, applied on read/import to any row whose
 * `schemaVersion` is behind {@link SCHEMA_VERSION}.
 *
 * Dexie handles the *store* (index) upgrades in db.ts via `.version(n).stores()`.
 * This module handles the *shape* of individual records — including records
 * arriving from an old JSON backup file, which Dexie never sees.
 *
 * To add a migration:
 *   1. Bump SCHEMA_VERSION in src/types/index.ts.
 *   2. Add `{ to: <newVersion>, migrate: (row) => ({...}) }` to MIGRATIONS below.
 *   3. Add a Dexie `.version()` block in db.ts if indexes changed.
 */

export interface RecordMigration {
  /** Version this migration produces. */
  to: number;
  describe: string;
  migrate: (row: Record<string, unknown>) => Record<string, unknown>;
}

export const MIGRATIONS: RecordMigration[] = [
  // Example for the next schema change — keep as a template:
  // {
  //   to: 2,
  //   describe: 'Add ExerciseResult.formGood defaulting to null',
  //   migrate: (row) => ({ ...row, formGood: row.formGood ?? null }),
  // },
];

export function migrateRecord<T extends { schemaVersion?: number }>(row: T): T {
  let current: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  let version = typeof row.schemaVersion === 'number' ? row.schemaVersion : 0;
  for (const migration of MIGRATIONS) {
    if (migration.to > version) {
      current = migration.migrate(current);
      version = migration.to;
    }
  }
  current.schemaVersion = Math.max(version, SCHEMA_VERSION);
  return current as T;
}

export function migrateAll<T extends { schemaVersion?: number }>(rows: T[]): T[] {
  return rows.map(migrateRecord);
}

/** True when a backup file is too new for this build to understand. */
export function isFutureSchema(version: number): boolean {
  return version > SCHEMA_VERSION;
}
