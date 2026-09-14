import { DEFAULT_BAND_LABELS, SCHEMA_VERSION } from '@/types';

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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** v1 -> v2: multi-program plans, superset/progression metadata, ramp sets, band labels. */
function toV2(row: Record<string, unknown>): Record<string, unknown> {
  // migrateRecord runs over EVERY table (and over rows from old backup files), so
  // each branch sniffs the row shape instead of assuming a type. Anything that
  // matches nothing passes through untouched.

  if (Array.isArray(row.weeks)) {
    return {
      ...row,
      programId: row.programId ?? 'movement-resilience',
      archived: row.archived ?? false,
      weeks: row.weeks.map((week) => {
        if (!isRecord(week)) return week;
        return {
          ...week,
          phase: week.phase ?? 'base',
          blockWeek: week.blockWeek ?? null,
          days: Array.isArray(week.days)
            ? week.days.map((day) => {
                if (!isRecord(day)) return day;
                return {
                  ...day,
                  prescriptions: Array.isArray(day.prescriptions)
                    ? day.prescriptions.map((p) => {
                        if (!isRecord(p)) return p;
                        return {
                          ...p,
                          role: p.role ?? 'accessory',
                          progressionType: p.progressionType ?? 'fixed',
                          targetRirLow: p.targetRirLow ?? null,
                          targetRirHigh: p.targetRirHigh ?? null,
                          weightIncrement: p.weightIncrement ?? null,
                          rampSets: p.rampSets ?? 0,
                        };
                      })
                    : day.prescriptions,
                };
              })
            : week.days,
        };
      }),
    };
  }

  if (Array.isArray(row.results)) {
    return {
      ...row,
      results: row.results.map((result) => {
        if (!isRecord(result)) return result;
        return {
          ...result,
          sets: Array.isArray(result.sets)
            ? result.sets.map((set) =>
                isRecord(set) ? { ...set, isWarmUp: set.isWarmUp ?? false } : set,
              )
            : result.sets,
        };
      }),
    };
  }

  if (row.weightUnit !== undefined) {
    return {
      ...row,
      activePlanId: row.activePlanId ?? null,
      bandLabels: row.bandLabels ?? DEFAULT_BAND_LABELS,
    };
  }

  return row;
}

/** v2 -> v3: plans remember the fingerprint of the weeks they were built with. */
function toV3(row: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(row.weeks)) return row;
  return { ...row, builtFingerprint: row.builtFingerprint ?? null };
}

export const MIGRATIONS: RecordMigration[] = [
  {
    to: 2,
    describe:
      'Ironpath schema v2 — multi-program plans, superset/progression metadata, ramp sets, band labels',
    migrate: toV2,
  },
  {
    to: 3,
    describe: 'Plans record a build fingerprint so program updates can be applied safely',
    migrate: toV3,
  },
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
  // Stamp only the version actually reached. Claiming SCHEMA_VERSION here would
  // mark untransformed records as current — and repository writes persist that
  // lie — hiding the fact that a migration step was never registered.
  if (version < SCHEMA_VERSION && MIGRATIONS.length > 0) {
    console.warn(
      `[migrations] record left at schema ${version}, app expects ${SCHEMA_VERSION} — a migration step is missing.`,
    );
  }
  current.schemaVersion = version === 0 ? SCHEMA_VERSION : version;
  return current as T;
}

export function migrateAll<T extends { schemaVersion?: number }>(rows: T[]): T[] {
  return rows.map(migrateRecord);
}

/** True when a backup file is too new for this build to understand. */
export function isFutureSchema(version: number): boolean {
  return version > SCHEMA_VERSION;
}
