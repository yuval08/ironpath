import type { WorkoutSession } from '@/types';

/** Deterministic legacy IDs survive repeat reads/imports; persisted IDs survive reordering. */
export function withSessionIdentity(session: WorkoutSession): WorkoutSession {
  return {
    ...session,
    syncRevision: session.syncRevision ?? 0,
    results: session.results.map((result) => ({
      ...result,
      sets: result.sets.map((set) => ({
        ...set,
        id: set.id ?? `legacy:${session.id}:${result.prescriptionId}:${set.setNumber}`,
      })),
    })),
  };
}
