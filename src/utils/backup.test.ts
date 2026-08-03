import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { buildBackup, backupFileName, restoreBackup } from './backup';
import { makePlan, makeResult, makeSession, makeSettings } from '@/test/factories';

async function clearAll() {
  await Promise.all([
    db.plans.clear(),
    db.sessions.clear(),
    db.personalRecords.clear(),
    db.settings.clear(),
    db.suggestions.clear(),
    db.assessments.clear(),
    db.importedWeights.clear(),
  ]);
}

describe('backup', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('names the file with the export date', () => {
    expect(backupFileName(new Date('2026-08-28T09:00:00Z'))).toBe(
      'movement-resilience-backup-2026-08-28.json',
    );
  });

  it('round-trips a plan, its sessions and settings', async () => {
    const plan = makePlan();
    const session = makeSession({
      planId: plan.id,
      results: [makeResult('standard-push-up', [{ reps: 15 }])],
    });
    await db.plans.put(plan);
    await db.sessions.put(session);
    await db.settings.put(makeSettings());

    const backup = await buildBackup();
    expect(backup.app).toBe('movement-resilience');
    expect(backup.sessions).toHaveLength(1);

    await clearAll();
    expect(await db.sessions.count()).toBe(0);

    const result = await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(result).toMatchObject({ plans: 1, sessions: 1 });

    const restored = await db.sessions.get(session.id);
    expect(restored?.results[0]?.sets[0]?.reps).toBe(15);
    expect((await db.plans.get(plan.id))?.weeks).toHaveLength(4);
  });

  it('replaces existing data rather than merging it', async () => {
    await db.sessions.put(makeSession({ id: 'stale' }));
    const backup = await buildBackup();
    backup.sessions = [makeSession({ id: 'fresh' })];
    await restoreBackup(JSON.parse(JSON.stringify(backup)));

    expect(await db.sessions.get('stale')).toBeUndefined();
    expect(await db.sessions.get('fresh')).toBeDefined();
  });

  it('rejects a file that is not a backup', async () => {
    await expect(restoreBackup({ hello: 'world' })).rejects.toThrow(/not a valid backup/i);
  });

  it('rejects a backup from a newer schema version', async () => {
    const backup = await buildBackup();
    await expect(restoreBackup({ ...backup, schemaVersion: 99 })).rejects.toThrow(
      /newer version of the app/i,
    );
  });

  it('leaves existing data untouched when the import is invalid', async () => {
    await db.sessions.put(makeSession({ id: 'keep-me' }));
    await expect(restoreBackup({ nope: true })).rejects.toThrow();
    expect(await db.sessions.get('keep-me')).toBeDefined();
  });
});
