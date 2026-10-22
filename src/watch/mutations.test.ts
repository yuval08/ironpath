import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { commitSessionPatch, createSession, getSession, saveSession } from '@/db/repository';
import { makePlan } from '@/test/factories';
import type { WorkoutSession } from '@/types';
import { applySessionPatch, diffSession, mergeFields, patchIsEmpty, same } from './mutations';
import { openReviews } from './reviews';

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../android/wear-link/src/test/resources/sync-v2/merge-cases.json'),
    'utf8',
  ),
) as {
  version: number;
  cases: {
    name: string;
    current: Record<string, unknown>;
    expected: Record<string, unknown>;
    changes: Record<string, unknown>;
    outcome: string;
    result: Record<string, unknown>;
    conflicts: string[];
  }[];
};

describe('shared merge fixture (merge-cases.json)', () => {
  it('is the version this implementation was written against', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(7);
  });
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const merged = mergeFields(c.current, c.expected, c.changes);
    expect(merged.outcome).toBe(c.outcome);
    expect(merged.result).toEqual(c.result);
    expect(merged.conflicts).toEqual(c.conflicts);
  });
});

describe('same', () => {
  it('compares numbers by value, null only to null, and other values canonically', () => {
    expect(same(60, 60.0)).toBe(true);
    expect(same(0, null)).toBe(false);
    expect(same(undefined, null)).toBe(true);
    expect(same(false, 0)).toBe(false);
    expect(same({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(same('light', 'medium')).toBe(false);
  });
});

let session: WorkoutSession;
beforeEach(async () => {
  await Promise.all([db.sessions.clear(), db.plans.clear(), db.meta.clear()]);
  const plan = makePlan();
  await db.plans.put(plan);
  session = (await getSession((await createSession(plan, plan.weeks[0]!.days[0]!)).id))!;
});
const edit = (mutate: (draft: WorkoutSession) => void) => {
  const next = structuredClone(session);
  mutate(next);
  return next;
};

describe('diffSession', () => {
  it('records only changed set, exercise and session fields with their base values', () => {
    const patch = diffSession(
      session,
      edit((draft) => {
        draft.results[0]!.sets[0]!.reps = 8;
        draft.results[0]!.sets[0]!.band = 'medium';
        draft.results[1]!.notes = 'grip';
        draft.results[1]!.skippedReason = 'pain';
        draft.sessionNotes = 'good';
        draft.warmUpCompletedAt = '2026-10-22T10:00:00.000Z';
        draft.elapsedSeconds = 90;
      }),
    );
    expect(patch.sets).toEqual([
      {
        prescriptionId: session.results[0]!.prescriptionId,
        setId: session.results[0]!.sets[0]!.id,
        expected: { reps: null, band: session.results[0]!.sets[0]!.band ?? null },
        changes: { reps: 8, band: 'medium' },
      },
    ]);
    expect(patch.exercises).toEqual([
      {
        prescriptionId: session.results[1]!.prescriptionId,
        expected: { notes: '', skippedReason: null },
        changes: { notes: 'grip', skippedReason: 'pain' },
      },
    ]);
    expect(patch.session.changes).toEqual({
      sessionNotes: 'good',
      warmUpCompletedAt: '2026-10-22T10:00:00.000Z',
    });
    expect(patch.structure).toEqual([]);
    expect(patch.elapsedSeconds).toBe(90);
  });
  it('is empty for an unchanged session and round-trips through applySessionPatch', () => {
    expect(patchIsEmpty(diffSession(session, structuredClone(session)))).toBe(true);
    const next = edit((draft) => {
      draft.results[0]!.sets[1]!.completed = true;
      draft.results[0]!.sets[1]!.weight = 62.5;
      draft.results[0]!.formGood = true;
      draft.painBefore = {
        leftKnee: 1,
        rightKnee: 0,
        leftShoulder: 0,
        rightShoulder: 0,
        lowerBack: 0,
        fatigue: 2,
        comments: '',
      };
    });
    const applied = applySessionPatch(session, diffSession(session, next));
    expect(applied.state).toBe('committed');
    expect(applied.session.results).toEqual(next.results);
    expect(applied.session.painBefore).toEqual(next.painBefore);
  });
  it('captures added/removed sets as a structure change guarded by the base id list', () => {
    const extra = { ...session.results[0]!.sets.at(-1)!, id: 'added-set', setNumber: 99 };
    const next = edit((draft) => {
      draft.results[0]!.sets = [...draft.results[0]!.sets.slice(1), extra];
    });
    const patch = diffSession(session, next);
    expect(patch.structure).toHaveLength(1);
    expect(patch.structure[0]!.added.map((s) => s.id)).toEqual(['added-set']);
    expect(applySessionPatch(session, patch).session.results[0]!.sets.map((s) => s.id)).toEqual(
      next.results[0]!.sets.map((s) => s.id),
    );
    // Another tab already changed this exercise's structure.
    const moved = edit((draft) => {
      draft.results[0]!.sets.pop();
    });
    const refused = applySessionPatch(moved, patch);
    expect(refused.state).toBe('conflict');
    expect(refused.state === 'conflict' && refused.conflicts[0]!.kind).toBe('structure');
  });
});

describe('applySessionPatch', () => {
  it('merges a phone edit with a different field the watch changed on the same set', () => {
    const watched = edit((draft) => {
      draft.results[0]!.sets[0]!.completed = true;
      draft.results[0]!.sets[0]!.reps = 8;
    });
    const phone = diffSession(
      session,
      edit((draft) => {
        draft.results[0]!.sets[0]!.weight = 70;
      }),
    );
    const applied = applySessionPatch(watched, phone);
    expect(applied.state).toBe('committed');
    expect(applied.session.results[0]!.sets[0]).toMatchObject({
      completed: true,
      reps: 8,
      weight: 70,
    });
  });
  it('refuses the whole patch when any field conflicts and keeps the max elapsed time', () => {
    const watched = edit((draft) => {
      draft.results[0]!.sets[0]!.reps = 10;
      draft.elapsedSeconds = 300;
    });
    const phone = diffSession(
      session,
      edit((draft) => {
        draft.results[0]!.sets[0]!.reps = 8;
        draft.sessionNotes = 'not applied either';
        draft.elapsedSeconds = 100;
      }),
    );
    const refused = applySessionPatch(watched, phone);
    expect(refused.state).toBe('conflict');
    expect(refused.session).toBe(watched);
    const ok = applySessionPatch(
      watched,
      diffSession(
        session,
        edit((draft) => void (draft.elapsedSeconds = 100)),
      ),
    );
    expect(ok.session.elapsedSeconds).toBe(300);
  });
  it('recomputes exercise completion from its working sets', () => {
    const next = edit((draft) => {
      for (const set of draft.results[0]!.sets) set.completed = true;
    });
    const applied = applySessionPatch(session, diffSession(session, next));
    expect(applied.session.results[0]!.completed).toBe(true);
  });
});

describe('commitSessionPatch', () => {
  it('commits against a newer revision without losing the watch import', async () => {
    const base = session;
    const imported = edit((draft) => void (draft.results[0]!.sets[0]!.reps = 8));
    await saveSession(imported);
    const result = await commitSessionPatch(
      session.id,
      diffSession(
        base,
        edit((draft) => void (draft.sessionNotes = 'phone')),
      ),
    );
    expect(result.state).toBe('committed');
    const stored = (await getSession(session.id))!;
    expect(stored.sessionNotes).toBe('phone');
    expect(stored.results[0]!.sets[0]!.reps).toBe(8);
    expect(stored.syncRevision).toBe((base.syncRevision ?? 0) + 2);
  });
  it('records a phone-origin review for a raced set field and leaves canonical data alone', async () => {
    await saveSession(edit((draft) => void (draft.results[0]!.sets[0]!.reps = 10)));
    const patch = diffSession(
      session,
      edit((draft) => void (draft.results[0]!.sets[0]!.reps = 8)),
    );
    const result = await commitSessionPatch(session.id, patch);
    expect(result).toMatchObject({ state: 'conflict', reviewId: patch.opId });
    expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(10);
    expect(await openReviews(session.id)).toMatchObject([
      {
        id: patch.opId,
        origin: 'phone',
        code: 'fieldConflict',
        fields: [{ field: 'reps', phone: 10, requested: 8 }],
      },
    ]);
  });
  it('refuses a closed workout', async () => {
    await db.sessions.update(session.id, { status: 'completed' });
    const patch = diffSession(
      session,
      edit((draft) => void (draft.sessionNotes = 'late')),
    );
    expect((await commitSessionPatch(session.id, patch)).state).toBe('closed');
  });
});

describe('phone-origin review fields', () => {
  it('lists every changed field so applying the phone edit keeps its completion', async () => {
    await saveSession(edit((draft) => void (draft.results[0]!.sets[0]!.reps = 10)));
    const patch = diffSession(
      session,
      edit((draft) => Object.assign(draft.results[0]!.sets[0]!, { completed: true, reps: 8 })),
    );
    expect((await commitSessionPatch(session.id, patch)).state).toBe('conflict');
    const [review] = await openReviews(session.id);
    expect(review!.fields).toEqual([
      { field: 'completed', phone: false, requested: true, conflict: false },
      { field: 'reps', phone: 10, requested: 8, conflict: true },
    ]);
    const { resolveReview } = await import('./recovery');
    expect(await resolveReview(review!.id, 'watch', { completed: false, reps: 10 })).toBe(
      'applied',
    );
    expect((await getSession(session.id))!.results[0]!.sets[0]).toMatchObject({
      completed: true,
      reps: 8,
    });
  });
});
