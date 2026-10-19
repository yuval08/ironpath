import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlan, makeResult, makeSession, makeSettings } from '@/test/factories';
import { db } from '@/db/db';
import { completeSession, getSuggestions } from '@/db/repository';
import WorkoutScreen from './WorkoutScreen';

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
  await act(async () => root.render(<WorkoutScreen />));
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
    expect(mocks.toast).toHaveBeenCalledWith('Could not save workout. Please try again.');
    const retry = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save & complete workout',
    )!;
    expect(retry.disabled).toBe(false);

    await ui.click('Save & complete workout');
    expect(completeSession).toHaveBeenCalledTimes(2);
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
    expect(completeSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/progress');
    expect(mocks.toast).toHaveBeenCalledWith(
      'Workout saved. Records or suggestions could not be updated.',
    );
  });
});
