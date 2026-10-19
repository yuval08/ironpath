import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { buildBackup, backupFileName, restoreBackup } from './backup';
import { makePlan, makeResult, makeSession, makeSettings } from '@/test/factories';
import { PROGRAMS } from '@/data/programs';
import { getPlan } from '@/db/repository';

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
      'ironpath-backup-2026-08-28.json',
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
    expect(backup.app).toBe('ironpath');
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
    // A real backup always carries a plan and settings — restoring one without
    // them is rejected outright (see the empty-backup guard below).
    await db.plans.put(makePlan());
    await db.settings.put(makeSettings());
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

  it('rejects settings that cannot be read by the app without erasing local data', async () => {
    await db.plans.put(makePlan());
    await db.settings.put(makeSettings());
    await db.sessions.put(makeSession({ id: 'keep-me' }));
    const backup = await buildBackup();
    backup.settings = [makeSettings({ id: 'wrong-settings-key' })];
    backup.sessions = [];

    await expect(restoreBackup(backup)).rejects.toThrow(/invalid settings/i);
    expect(await db.settings.get('settings')).toBeDefined();
    expect(await db.sessions.get('keep-me')).toBeDefined();
  });

  it('rejects duplicate IDs instead of silently dropping workout history', async () => {
    await db.plans.put(makePlan());
    await db.settings.put(makeSettings());
    await db.sessions.put(makeSession({ id: 'keep-me' }));
    const backup = await buildBackup();
    backup.sessions = [
      makeSession({ id: 'duplicate', results: [makeResult('standard-push-up', [{ reps: 15 }])] }),
      makeSession({ id: 'duplicate', results: [makeResult('standard-push-up', [{ reps: 20 }])] }),
    ];

    await expect(restoreBackup(backup)).rejects.toThrow(/duplicate sessions IDs/i);
    expect(await db.sessions.get('keep-me')).toBeDefined();
    expect(await db.sessions.get('duplicate')).toBeUndefined();
  });

  it('rejects a future-version row even when the file version is supported', async () => {
    await db.plans.put(makePlan());
    await db.settings.put(makeSettings());
    await db.sessions.put(makeSession({ id: 'keep-me' }));
    const backup = await buildBackup();
    backup.sessions = [makeSession({ id: 'future', schemaVersion: 99 })];

    await expect(restoreBackup(backup)).rejects.toThrow(/newer version of the app/i);
    expect(await db.sessions.get('keep-me')).toBeDefined();
  });
});

describe('empty backup guard (regression)', () => {
  /**
   * Restoring an empty-but-schema-valid backup used to clear every table and
   * leave the app on the loading screen, since seeding only runs at startup.
   */
  it('refuses a backup with no plan or settings and leaves data intact', async () => {
    await db.plans.put(makePlan());
    await db.sessions.put(makeSession({ id: 'keep' }));
    const backup = await buildBackup();

    await expect(restoreBackup({ ...backup, plans: [], settings: [] })).rejects.toThrow(
      /no plan or settings/i,
    );

    expect(await db.plans.count()).toBe(1);
    expect(await db.sessions.get('keep')).toBeDefined();
  });
});

describe('multi-program backups', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('round-trips every plan and each plan’s sessions, not just the active one', async () => {
    const resilience = makePlan({ id: 'plan_res', programId: 'movement-resilience' });
    const hypertrophy = makePlan({
      id: 'plan_hyp',
      name: '14-Week Hypertrophy — Upper / Lower',
      programId: 'hypertrophy-14wk',
      weeks: PROGRAMS['hypertrophy-14wk'].buildWeeks(),
    });
    await db.plans.bulkPut([resilience, hypertrophy]);
    await db.sessions.bulkPut([
      makeSession({ id: 's_res', planId: resilience.id }),
      makeSession({ id: 's_hyp', planId: hypertrophy.id }),
    ]);
    await db.settings.put(makeSettings({ activePlanId: hypertrophy.id }));

    const backup = await buildBackup();
    expect(backup.plans.map((p) => p.id).sort()).toEqual(['plan_hyp', 'plan_res']);

    await clearAll();
    const result = await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(result.plans).toBe(2);
    expect((await db.plans.get('plan_hyp'))?.weeks).toHaveLength(15);
    expect((await db.plans.get('plan_hyp'))?.programId).toBe('hypertrophy-14wk');
    expect(await db.sessions.get('s_res')).toBeDefined();
    expect(await db.sessions.get('s_hyp')).toBeDefined();
    expect((await db.settings.get('settings'))?.activePlanId).toBe('plan_hyp');
  });

  /**
   * Backups taken before the Ironpath rename carry app: 'movement-resilience'.
   * Rejecting them would strand the only copy of a user's history.
   */
  it('imports a backup written under the old app name', async () => {
    await db.plans.put(makePlan());
    await db.settings.put(makeSettings());
    const backup = await buildBackup();

    await clearAll();
    const legacy = { ...JSON.parse(JSON.stringify(backup)), app: 'movement-resilience' };
    await expect(restoreBackup(legacy)).resolves.toMatchObject({ plans: 1 });
    expect(await db.plans.count()).toBe(1);
  });

  it('rejects a file whose app literal is neither', async () => {
    await db.plans.put(makePlan());
    await db.settings.put(makeSettings());
    const backup = await buildBackup();
    await expect(restoreBackup({ ...backup, app: 'some-other-app' })).rejects.toThrow(
      /not a valid backup/i,
    );
  });

  it('carries ramp sets through a round trip', async () => {
    const plan = makePlan();
    await db.plans.put(plan);
    await db.settings.put(makeSettings());
    await db.sessions.put(
      makeSession({
        id: 's_ramp',
        planId: plan.id,
        results: [
          makeResult('standard-push-up', [
            { setNumber: 1, reps: 5, weight: 20, isWarmUp: true },
            { setNumber: 2, reps: 10, weight: 40 },
          ]),
        ],
      }),
    );

    const backup = await buildBackup();
    await clearAll();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));

    const sets = (await db.sessions.get('s_ramp'))?.results[0]?.sets ?? [];
    expect(sets.map((s) => s.isWarmUp)).toEqual([true, false]);
  });
});

describe('active plan pointer after a restore', () => {
  beforeEach(async () => {
    await clearAll();
  });

  /**
   * Settings and plans travel in the same backup, so the pointer normally still
   * resolves. A backup taken after a plan was deleted can carry a stale id, and a
   * dangling pointer that resolved to `undefined` would strand the app on the
   * loading screen with no route to Settings — the same unrecoverable startup the
   * RecoveryScreen exists to prevent.
   */
  it('drops an activePlanId that names a plan the backup does not contain', async () => {
    await db.plans.put(makePlan({ id: 'plan_kept' }));
    await db.settings.put(makeSettings({ activePlanId: 'plan_that_was_deleted' }));
    const backup = await buildBackup();

    await clearAll();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));

    // The restore normalises it rather than leaving a pointer nothing can follow.
    expect((await db.settings.get('settings'))?.activePlanId).toBeNull();
    const active = await getPlan();
    expect(active?.id).toBe('plan_kept');
  });

  it('drops a dangling pointer even when other plans are present', async () => {
    await db.plans.bulkPut([
      makePlan({ id: 'plan_archived', archived: true }),
      makePlan({ id: 'plan_live' }),
    ]);
    await db.settings.put(makeSettings({ activePlanId: 'gone' }));
    const backup = await buildBackup();

    await clearAll();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));

    expect((await db.settings.get('settings'))?.activePlanId).toBeNull();
    // null resolves to the first NON-archived plan, not simply the first.
    expect((await getPlan())?.id).toBe('plan_live');
  });

  it('restores a pointer that does resolve, across two plans', async () => {
    await db.plans.bulkPut([
      makePlan({ id: 'plan_a', archived: true }),
      makePlan({ id: 'plan_b', programId: 'hypertrophy-14wk' }),
    ]);
    await db.settings.put(makeSettings({ activePlanId: 'plan_b' }));
    const backup = await buildBackup();

    await clearAll();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));

    expect((await getPlan())?.id).toBe('plan_b');
  });
});
