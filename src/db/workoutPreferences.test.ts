import { beforeEach, expect, it } from 'vitest';
import { db } from './db';
import { ensureSeeded, getSettings, updateSettings } from './repository';
import { migrateRecord } from './migrations';
import { makeSettings } from '@/test/factories';
import { SCHEMA_VERSION, userSettingsSchema } from '@/types';
import { buildBackup, restoreBackup } from '@/utils/backup';

beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.plans.clear(), db.sessions.clear(), db.meta.clear()]);
});

it('migrates older installations and backup settings without requesting permission', async () => {
  const { keepScreenOn: _wake, notifyOnRestEnd: _notify, ...old } = makeSettings();
  const migrated = migrateRecord({ ...old, schemaVersion: 4 });
  expect(migrated).toMatchObject({
    schemaVersion: SCHEMA_VERSION,
    keepScreenOn: false,
    notifyOnRestEnd: false,
  });
  expect(userSettingsSchema.parse(old)).toMatchObject({
    keepScreenOn: false,
    notifyOnRestEnd: false,
  });
  await db.settings.put({ ...old, schemaVersion: 4 } as ReturnType<typeof makeSettings>);
  await ensureSeeded();
  expect(await getSettings()).toMatchObject({ keepScreenOn: false, notifyOnRestEnd: false });
});

it('persists opt-ins and includes them in a backup round trip', async () => {
  await ensureSeeded();
  await updateSettings({ keepScreenOn: true, notifyOnRestEnd: true });
  const backup = await buildBackup();
  await updateSettings({ keepScreenOn: false, notifyOnRestEnd: false });
  await restoreBackup(backup);
  expect(await getSettings()).toMatchObject({ keepScreenOn: true, notifyOnRestEnd: true });
});
