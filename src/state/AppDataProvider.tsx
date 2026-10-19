import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, requestPersistentStorage } from '@/db/db';
import { ensureSeeded, syncPlansWithPrograms } from '@/db/repository';
import { migrateAll } from '@/db/migrations';
import { reconcileWatchInbox } from '@/watch/transport';
import type {
  FinalAssessment,
  ImportedWeight,
  PersonalRecord,
  ProgressionSuggestion,
  UserSettings,
  WorkoutPlan,
  WorkoutSession,
} from '@/types';

interface AppData {
  ready: boolean;
  /** The active plan — what the Dashboard and Workout screens train. */
  plan: WorkoutPlan | undefined;
  /** Every plan, active and archived, for the plan switcher. */
  plans: WorkoutPlan[];
  settings: UserSettings | undefined;
  sessions: WorkoutSession[];
  records: PersonalRecord[];
  suggestions: ProgressionSuggestion[];
  assessment: FinalAssessment | undefined;
  importedWeights: ImportedWeight[];
  storagePersisted: boolean;
  /** Set when startup failed — the app shows a recovery screen instead of hanging. */
  startupError: Error | null;
}

const AppDataContext = createContext<AppData>({
  ready: false,
  plan: undefined,
  plans: [],
  settings: undefined,
  sessions: [],
  records: [],
  suggestions: [],
  assessment: undefined,
  importedWeights: [],
  storagePersisted: false,
  startupError: null,
});

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [seeded, setSeeded] = useState(false);
  const [storagePersisted, setStoragePersisted] = useState(false);
  const [startupError, setStartupError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureSeeded();
        await reconcileWatchInbox();
      } catch (error) {
        // Without this the whole app would sit on "Loading your plan…" forever —
        // including Settings, so there would be no way to export a backup of data
        // that is still perfectly intact on disk.
        if (!cancelled) setStartupError(error as Error);
        return;
      }
      // Deliberately non-fatal: if a program update cannot be applied, the plan the
      // user already has is still a complete, trainable plan.
      await syncPlansWithPrograms().catch((error: unknown) =>
        console.error('[plans] could not apply program updates', error),
      );
      const persisted = await requestPersistentStorage().catch(() => false);
      if (cancelled) return;
      setStoragePersisted(persisted);
      setSeeded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!seeded) return;
    const reconcile = () => {
      if (document.visibilityState === 'visible')
        void reconcileWatchInbox().catch((error: unknown) =>
          console.error('[watch] could not reconcile pending commands', error),
        );
    };
    const interval = window.setInterval(reconcile, 2000);
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('focus', reconcile);
    };
  }, [seeded]);

  const plans = useLiveQuery(
    async () =>
      migrateAll(await db.plans.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [seeded],
    [] as WorkoutPlan[],
  );

  const settings = useLiveQuery(async () => {
    const row = await db.settings.toCollection().first();
    return row ? migrateAll([row])[0] : undefined;
  }, [seeded]);

  // Same resolution order as repository.getPlan(): the pinned plan, else the first
  // non-archived one, else whatever exists. Both must agree or a write through the
  // repository would land on a different plan than the screen is showing.
  const plan = useMemo(() => {
    const list = plans ?? [];
    const pinned = settings?.activePlanId
      ? list.find((p) => p.id === settings.activePlanId)
      : undefined;
    return pinned ?? list.find((p) => !p.archived) ?? list[0];
  }, [plans, settings?.activePlanId]);

  // Deliberately unfiltered: screens narrow to the active plan themselves, and
  // export has to emit every plan's history.
  const sessions = useLiveQuery(
    async () =>
      migrateAll(await db.sessions.toArray()).sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      ),
    [seeded],
    [] as WorkoutSession[],
  );

  const records = useLiveQuery(
    async () => migrateAll(await db.personalRecords.toArray()),
    [seeded],
    [] as PersonalRecord[],
  );

  const suggestions = useLiveQuery(
    async () => migrateAll(await db.suggestions.toArray()),
    [seeded],
    [] as ProgressionSuggestion[],
  );

  const importedWeights = useLiveQuery(
    async () => migrateAll(await db.importedWeights.toArray()),
    [seeded],
    [] as ImportedWeight[],
  );

  const assessment = useLiveQuery(async () => {
    if (!plan) return undefined;
    const rows = await db.assessments.where('planId').equals(plan.id).toArray();
    return rows.sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [plan?.id]);

  const value = useMemo<AppData>(
    () => ({
      ready: seeded && !!plan && !!settings,
      plan,
      plans: plans ?? [],
      settings,
      sessions: sessions ?? [],
      records: records ?? [],
      suggestions: suggestions ?? [],
      assessment,
      importedWeights: importedWeights ?? [],
      storagePersisted,
      startupError,
    }),
    [
      seeded,
      plan,
      plans,
      settings,
      sessions,
      records,
      suggestions,
      assessment,
      importedWeights,
      storagePersisted,
      startupError,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  return useContext(AppDataContext);
}
