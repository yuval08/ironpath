import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createSession, getSession, saveSession } from '@/db/repository';
import { makePlan } from '@/test/factories';
import type { WorkoutSession } from '@/types';
import { getReview, newReview, openReviews, putReview } from '@/watch/reviews';
import { resolveReview } from '@/watch/recovery';
import { WatchRecovery } from './WatchRecovery';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let session: WorkoutSession;
const REVIEW = '00000000-0000-4000-8000-00000000abcd';

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  });
const setReps = async (reps: number) => {
  const draft = (await getSession(session.id))!;
  draft.results[0]!.sets[0]!.reps = reps;
  await saveSession(draft);
};
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

beforeEach(async () => {
  await Promise.all([db.sessions.clear(), db.plans.clear(), db.meta.clear()]);
  const plan = makePlan();
  await db.plans.put(plan);
  session = (await getSession((await createSession(plan, plan.weeks[0]!.days[0]!)).id))!;
  await setReps(8);
  const exercise = session.results[0]!;
  await putReview(
    newReview({
      id: REVIEW,
      origin: 'watch',
      sessionId: session.id,
      setId: exercise.sets[0]!.id!,
      prescriptionId: exercise.prescriptionId,
      exerciseId: exercise.exerciseId,
      code: 'fieldConflict',
      reason: 'This set changed on the other device.',
      fields: [{ field: 'reps', phone: 8, requested: 10 }],
      expected: { reps: null },
      requested: { reps: 10 },
    }),
  );
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root.render(<WatchRecovery sessionId={session.id} />));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it('compares live phone values with the requested watch values', async () => {
  expect(host.textContent).toContain('Phone now');
  expect(host.querySelector('tbody')!.textContent).toBe('Reps810');
  await setReps(9);
  await settle();
  // The display re-reads the live value instead of the one stored at conflict time.
  expect(host.querySelector('tbody')!.textContent).toBe('Reps910');
});

it('applies watch values as a conditional patch against what was shown', async () => {
  await act(async () => button('Apply watch values').click());
  await settle();
  expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(10);
  expect((await getReview(REVIEW))!).toMatchObject({ resolution: 'applied', resolvedBy: 'phone' });
  expect(host.textContent).toBe('');
});

it('keeps phone values without changing the workout', async () => {
  await act(async () => button('Keep phone values').click());
  await settle();
  expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(8);
  expect((await getReview(REVIEW))!.resolution).toBe('kept');
});

it('never overwrites a value that changed after it was shown', async () => {
  await setReps(9);
  expect(await resolveReview(REVIEW, 'watch', { reps: 8 })).toBe('conflict');
  expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(9);
  expect((await getReview(REVIEW))!.resolution).toBe('superseded');
  expect(await openReviews(session.id)).toMatchObject([
    { origin: 'phone', fields: [{ field: 'reps', phone: 9, requested: 10 }] },
  ]);
});

it('shows a held-back completion and says Keep phone values leaves it out', async () => {
  const exercise = session.results[0]!;
  await putReview(
    newReview({
      id: '00000000-0000-4000-8000-00000000abce',
      origin: 'watch',
      sessionId: session.id,
      setId: exercise.sets[1]!.id!,
      prescriptionId: exercise.prescriptionId,
      exerciseId: exercise.exerciseId,
      code: 'fieldConflict',
      reason: 'This set changed on the other device.',
      fields: [
        { field: 'completed', phone: false, requested: true, conflict: false },
        { field: 'reps', phone: 8, requested: 10, conflict: true },
      ],
      expected: { completed: false, reps: null },
      requested: { completed: true, reps: 10 },
    }),
  );
  await settle();
  expect(host.textContent).toContain('Completed (no conflict)');
  expect(host.querySelector('[role="note"]')!.textContent).toContain(
    'Keep phone values also leaves out the watch’s Completed: ✓',
  );
});
