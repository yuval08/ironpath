import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlan, makeResult, makeSession, makeSettings } from '@/test/factories';
import { db } from '@/db/db';
import { completeSession, getSuggestions } from '@/db/repository';
import WorkoutScreen from './WorkoutScreen';
import { WorkoutAlertsProvider } from '@/state/WorkoutAlertsProvider';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), toast: vi.fn(), data: {} as unknown }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'session_test' }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/state/AppDataProvider', () => ({ useAppData: () => mocks.data }));
vi.mock('@/state/ToastProvider', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/db/repository', async (original) => ({
  ...(await original<typeof import('@/db/repository')>()),
  completeSession: vi.fn(),
  getSuggestions: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let cleanup: (() => Promise<void>) | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  await db.sessions.clear();
  await db.plans.clear();
  await db.meta.clear();
  const plan = makePlan();
  const session = makeSession({
    id: 'session_test',
    status: 'inProgress',
    completedAt: null,
    dayId: plan.weeks[0]!.days[0]!.id,
    // No exercises: focus the completion flow rather than exercise input behavior.
    results: [],
  });
  await db.plans.put(plan);
  await db.sessions.put(session);
  mocks.data = { plan, settings: makeSettings(), sessions: [session] };
  vi.mocked(getSuggestions).mockResolvedValue([]);
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function render(openFinish = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  await act(async () =>
    root.render(
      <WorkoutAlertsProvider>
        <WorkoutScreen />
      </WorkoutAlertsProvider>,
    ),
  );
  await act(async () => {
    await db.sessions.get('session_test');
  });
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    expect(button, `Button ${label}`).toBeDefined();
    await act(async () => button!.click());
  };
  if (openFinish) await click('Finish workout');
  return { host, click };
}

describe('workout completion failure recovery', () => {
  it('shows the owning plan’s exercise cards after the active plan has changed', async () => {
    const owner = makePlan();
    const prescription = owner.weeks[0]!.days[0]!.prescriptions[0]!;
    const stored = (await db.sessions.get('session_test'))!;
    const session = {
      ...stored,
      results: [
        makeResult(prescription.exerciseId, [{ reps: 8 }], {
          prescriptionId: prescription.id,
          completed: false,
        }),
      ],
    };
    await db.sessions.put(session);
    mocks.data = {
      plan: makePlan({ id: 'other_plan', weeks: [] }),
      settings: makeSettings(),
      sessions: [session],
    };

    const ui = await render(false);

    expect(ui.host.querySelector(`#ex-${prescription.id}`)).not.toBeNull();
    expect(ui.host.querySelector('h2')!.textContent).toBe(owner.weeks[0]!.days[0]!.title);
  });

  it('enables retry after a failed workout write and completes on the next attempt', async () => {
    vi.mocked(completeSession)
      .mockRejectedValueOnce(new Error('Storage failed'))
      .mockImplementationOnce(async (s) => s);
    const ui = await render();
    await ui.click('Save & complete workout');
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => {
      await vi.waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith('Could not save workout. Please try again.'),
      );
    });
    const retry = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save & complete workout',
    )!;
    expect(retry.disabled).toBe(false);

    await ui.click('Save & complete workout');
    await act(async () => {
      await vi.waitFor(() => expect(completeSession).toHaveBeenCalledTimes(2));
    });
    expect(vi.mocked(completeSession).mock.lastCall![0].status).toBe('completed');
    await act(async () => {
      await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/progress'));
    });
  });

  it('leaves a successfully saved workout when updating suggestions fails', async () => {
    vi.mocked(completeSession).mockImplementationOnce(async (s) => s);
    vi.mocked(getSuggestions).mockRejectedValueOnce(new Error('Suggestions failed'));
    const ui = await render();
    await ui.click('Save & complete workout');
    await act(async () => {
      await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/progress'));
    });
    expect(completeSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/progress');
    expect(mocks.toast).toHaveBeenCalledWith(
      'Workout saved. Records or suggestions could not be updated.',
    );
  });
  it('finishes from the latest imported database values rather than the open screen copy', async () => {
    vi.mocked(completeSession).mockImplementationOnce(async (s) => s);
    const ui = await render();
    await db.sessions.update('session_test', {
      sessionNotes: 'Imported while screen was open',
      syncRevision: 4,
    });
    await ui.click('Save & complete workout');
    await act(async () => {
      await vi.waitFor(() => expect(completeSession).toHaveBeenCalledOnce());
    });
    expect(vi.mocked(completeSession).mock.lastCall![0]).toMatchObject({
      sessionNotes: 'Imported while screen was open',
      syncRevision: 4,
    });
    await act(async () => {
      await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/progress'));
    });
  });

  it('keeps a watch import and a later phone set edit instead of refusing a stale save', async () => {
    const owner = makePlan();
    const prescription = owner.weeks[0]!.days[0]!.prescriptions[0]!;
    const stored = (await db.sessions.get('session_test'))!;
    const session = {
      ...stored,
      syncRevision: 0,
      warmUpCompletedAt: new Date().toISOString(),
      results: [
        makeResult(
          prescription.exerciseId,
          [
            { id: 'set-1', completed: false, reps: null },
            { id: 'set-2', completed: false, reps: null },
          ],
          { prescriptionId: prescription.id, completed: false },
        ),
      ],
    };
    await db.sessions.put(session);
    mocks.data = { plan: owner, settings: makeSettings(), sessions: [session] };
    const ui = await render(false);
    // A watch import lands while the screen is open (v1 refused the next phone save).
    await act(async () => {
      await db.sessions.update('session_test', {
        syncRevision: 1,
        results: [
          {
            ...session.results[0]!,
            sets: session.results[0]!.sets.map((set) =>
              set.id === 'set-1' ? { ...set, completed: true, reps: 9 } : set,
            ),
          },
        ],
      });
    });
    // Renders flush only when act() ends, so poll outside of it.
    const imported = '[aria-label="Mark set 1 of 2 incomplete"]';
    for (let i = 0; i < 20 && !ui.host.querySelector(imported); i++)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    expect(ui.host.querySelector(imported)).not.toBeNull();
    await act(async () =>
      ui.host.querySelector<HTMLButtonElement>('[aria-label="Mark set 2 of 2 complete"]')!.click(),
    );
    await act(async () => {
      await vi.waitFor(async () => {
        const sets = (await db.sessions.get('session_test'))!.results[0]!.sets;
        expect(sets.map((set) => set.completed)).toEqual([true, true]);
        expect(sets[0]!.reps).toBe(9);
      });
    });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('skips the rest a set started when that set is un-ticked, but not a later set’s rest', async () => {
    const owner = makePlan();
    const prescription = { ...owner.weeks[0]!.days[0]!.prescriptions[0]!, restSeconds: 60 };
    owner.weeks[0]!.days[0]!.prescriptions[0] = prescription;
    const stored = (await db.sessions.get('session_test'))!;
    const session = {
      ...stored,
      syncRevision: 0,
      warmUpCompletedAt: new Date().toISOString(),
      results: [
        makeResult(
          prescription.exerciseId,
          [
            { id: 'set-1', completed: false, reps: null },
            { id: 'set-2', completed: false, reps: null },
          ],
          { prescriptionId: prescription.id, completed: false },
        ),
      ],
    };
    await db.sessions.put(session);
    await db.plans.put(owner);
    // Keep the card open once both sets are done.
    mocks.data = {
      plan: owner,
      settings: makeSettings({ autoCollapseCompleted: false }),
      sessions: [session],
    };
    const ui = await render(false);
    const press = async (label: string) => {
      for (let i = 0; i < 20 && !ui.host.querySelector(`[aria-label="${label}"]`); i++)
        await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
      await act(async () =>
        ui.host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(),
      );
    };
    const resting = () => ui.host.querySelector('.rest-overlay') != null;
    await press('Mark set 1 of 2 complete');
    expect(resting()).toBe(true);
    await press('Mark set 1 of 2 incomplete');
    expect(resting()).toBe(false);
    // Set 1 again, then set 2 restarts the rest: un-ticking set 1 leaves set 2's rest.
    await press('Mark set 1 of 2 complete');
    await press('Mark set 2 of 2 complete');
    expect(resting()).toBe(true);
    await press('Mark set 1 of 2 incomplete');
    expect(resting()).toBe(true);
    // A preset rest has no source set and survives un-ticking.
    const preset = [...ui.host.querySelectorAll('button')].find((b) => b.textContent === '45s')!;
    await act(async () => preset.click());
    await press('Mark set 2 of 2 incomplete');
    expect(resting()).toBe(true);
  });
});
