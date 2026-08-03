import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, requestPersistentStorage } from '@/db/db';
import { ensureSeeded } from '@/db/repository';
import { migrateAll } from '@/db/migrations';
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
  plan: WorkoutPlan | undefined;
  settings: UserSettings | undefined;
  sessions: WorkoutSession[];
  records: PersonalRecord[];
  suggestions: ProgressionSuggestion[];
  assessment: FinalAssessment | undefined;
  importedWeights: ImportedWeight[];
  storagePersisted: boolean;
}

const AppDataContext = createContext<AppData>({
  ready: false,
  plan: undefined,
  settings: undefined,
  sessions: [],
  records: [],
  suggestions: [],
  assessment: undefined,
  importedWeights: [],
  storagePersisted: false,
});

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [seeded, setSeeded] = useState(false);
  const [storagePersisted, setStoragePersisted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureSeeded();
      const persisted = await requestPersistentStorage();
      if (cancelled) return;
      setStoragePersisted(persisted);
      setSeeded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = useLiveQuery(async () => {
    const row = await db.plans.toCollection().first();
    return row ? migrateAll([row])[0] : undefined;
  }, [seeded]);

  const settings = useLiveQuery(async () => {
    const row = await db.settings.toCollection().first();
    return row ? migrateAll([row])[0] : undefined;
  }, [seeded]);

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
      settings,
      sessions: sessions ?? [],
      records: records ?? [],
      suggestions: suggestions ?? [],
      assessment,
      importedWeights: importedWeights ?? [],
      storagePersisted,
    }),
    [
      seeded,
      plan,
      settings,
      sessions,
      records,
      suggestions,
      assessment,
      importedWeights,
      storagePersisted,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  return useContext(AppDataContext);
}
