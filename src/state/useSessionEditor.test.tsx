import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createSession, getSession, saveSession } from '@/db/repository';
import { makePlan } from '@/test/factories';
import type { WorkoutSession } from '@/types';
import { openReviews } from '@/watch/reviews';
import { useSessionEditor } from './useSessionEditor';
import type { SessionEditorOptions } from './useSessionEditor';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let editor: ReturnType<typeof useSessionEditor>;
let root: ReturnType<typeof createRoot>;
let session: WorkoutSession;
const options: SessionEditorOptions = {};

function Probe({ id }: { id: string }) {
  editor = useSessionEditor(id, options);
  return null;
}

/** Waits for Dexie live queries and queued commits to settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  });

/** A watch import: a canonical write that bypasses the editor. */
async function watchImport(mutate: (draft: WorkoutSession) => void) {
  const draft = (await getSession(session.id))!;
  mutate(draft);
  await saveSession(draft);
}

const phone = (mutate: (draft: WorkoutSession) => void) =>
  act(async () => {
    const draft = structuredClone(editor.current()!);
    mutate(draft);
    editor.change(draft);
  });

/** Holds commits until released, to model a slow write racing a watch import. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  options.guard = () => opened;
  return release;
}

beforeEach(async () => {
  await Promise.all([db.sessions.clear(), db.plans.clear(), db.meta.clear()]);
  const plan = makePlan();
  await db.plans.put(plan);
  session = (await getSession((await createSession(plan, plan.weeks[0]!.days[0]!)).id))!;
  options.guard = undefined;
  options.onConflict = vi.fn();
  options.onError = vi.fn();
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe id={session.id} />));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it('follows the live session and rebases untouched fields under a pending edit', async () => {
  expect(editor.session?.id).toBe(session.id);
  const release = gate();
  await phone((draft) => void (draft.results[0]!.sets[0]!.weight = 70));
  await watchImport((draft) => {
    Object.assign(draft.results[0]!.sets[0]!, { completed: true, reps: 8 });
  });
  await settle();
  // The pending phone weight stays visible on top of the imported watch fields.
  expect(editor.session!.results[0]!.sets[0]).toMatchObject({
    completed: true,
    reps: 8,
    weight: 70,
  });
  release();
  await settle();
  expect((await getSession(session.id))!.results[0]!.sets[0]).toMatchObject({
    completed: true,
    reps: 8,
    weight: 70,
  });
  expect(options.onConflict).not.toHaveBeenCalled();
});

it('preserves typed input across several edits in one batch', async () => {
  await act(async () => {
    for (const text of ['G', 'Go', 'Goo', 'Good']) {
      const draft = structuredClone(editor.current()!);
      draft.sessionNotes = text;
      editor.change(draft);
    }
  });
  expect(editor.session!.sessionNotes).toBe('Good');
  expect(await editor.flush()).toBe(false);
  await settle();
  expect((await getSession(session.id))!.sessionNotes).toBe('Good');
});

it('drops a raced edit from the display and records it for review', async () => {
  const release = gate();
  await phone((draft) => void (draft.results[0]!.sets[0]!.reps = 8));
  expect(editor.session!.results[0]!.sets[0]!.reps).toBe(8);
  await watchImport((draft) => void (draft.results[0]!.sets[0]!.reps = 10));
  await settle();
  expect(editor.session!.results[0]!.sets[0]!.reps).toBe(10);
  release();
  await settle();
  expect(options.onConflict).toHaveBeenCalledOnce();
  expect((await getSession(session.id))!.results[0]!.sets[0]!.reps).toBe(10);
  expect(await openReviews(session.id)).toMatchObject([
    { origin: 'phone', fields: [{ field: 'reps', phone: 10, requested: 8 }] },
  ]);
});

it('reports refused commits through flush and onError', async () => {
  options.guard = async () => {
    throw new Error('Take control on the phone before editing this workout.');
  };
  await phone((draft) => void (draft.sessionNotes = 'locked'));
  expect(await editor.flush()).toBe(true);
  expect(await editor.flush()).toBe(false);
  expect(options.onError).toHaveBeenCalledOnce();
  await settle();
  expect(editor.session!.sessionNotes).toBe('');
});

it('accepts an edit made before the live query first resolves when seeded', async () => {
  await act(async () => root.unmount());
  root = createRoot(document.createElement('div'));
  const seeded = { ...options, initial: session };
  function Early() {
    editor = useSessionEditor(session.id, seeded);
    return null;
  }
  let opId: string | null = null;
  await act(async () => {
    root.render(<Early />);
  });
  // No settle(): the live query may not have answered yet.
  await act(async () => {
    const draft = structuredClone(editor.current()!);
    draft.sessionNotes = 'early';
    opId = editor.change(draft);
  });
  expect(opId).toEqual(expect.any(String));
  await editor.flush();
  await settle();
  expect((await getSession(session.id))!.sessionNotes).toBe('early');
});
