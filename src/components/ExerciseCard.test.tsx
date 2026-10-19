import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { programFor } from '@/data/programs';
import { makeResult } from '@/test/factories';
import type { ExerciseResult } from '@/types';
import { ExerciseCard } from './ExerciseCard';

// React's act flushes event updates before assertions in this jsdom environment.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const prescription = programFor('hypertrophy-14wk')
  .buildWeeks({ weightUnit: 'lb' })[0]!
  .days[0]!.prescriptions.find((p) => p.exerciseId === 'incline-dumbbell-press')!;
const previous = makeResult('incline-dumbbell-press', [
  { weight: 25, reps: 5, isWarmUp: true },
  { weight: 35, reps: 10 },
  { weight: 40, reps: 8 },
]);
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function render(result: ExerciseResult) {
  const host = document.createElement('div');
  const root = createRoot(host);
  const onChange = vi.fn();
  const onRest = vi.fn();
  const draw = async (next: ExerciseResult) => {
    await act(async () =>
      root.render(
        <ExerciseCard
          prescription={prescription}
          result={next}
          previous={previous}
          weightUnit="lb"
          isCurrent
          expanded
          onToggleExpand={() => {}}
          onChange={onChange}
          onRest={onRest}
        />,
      ),
    );
  };
  await draw(result);
  cleanup = async () => {
    await act(async () => root.unmount());
  };
  const click = async (selector: string) => {
    await act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
    return onChange.mock.lastCall![0] as ExerciseResult;
  };
  return { host, onChange, onRest, draw, click };
}

describe('completing sets accepts visible history', () => {
  it('saves shown hints, then retains them when the set is unchecked', async () => {
    const result = makeResult('incline-dumbbell-press', [{ completed: false }], {
      completed: false,
    });
    const ui = await render(result);
    expect(ui.host.querySelector('input')!.placeholder).toBe('35');
    const saved = await ui.click('.check-btn');
    expect(saved.sets[0]).toMatchObject({ completed: true, weight: 35, reps: 10 });
    expect(saved.completed).toBe(true);
    await ui.draw(saved);
    const undone = await ui.click('.check-btn');
    expect(undone.sets[0]).toMatchObject({ completed: false, weight: 35, reps: 10 });
  });

  it('Complete all accepts each open working row, leaving ramps and completed rows intact', async () => {
    const result = makeResult(
      'incline-dumbbell-press',
      [
        { isWarmUp: true, completed: false },
        { completed: true, weight: null, reps: 7 },
        { completed: false, weight: 45 },
        { completed: false },
      ],
      { completed: false },
    );
    const ui = await render(result);
    const button = [...ui.host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Complete all'),
    )!;
    await act(async () => button.click());
    const saved = ui.onChange.mock.lastCall![0] as ExerciseResult;
    expect(saved.sets[0]).toEqual(result.sets[0]);
    expect(saved.sets[1]).toEqual(result.sets[1]);
    expect(saved.sets[2]).toMatchObject({ completed: true, weight: 45, reps: 8 });
    expect(saved.sets[3]).toMatchObject({ completed: true, weight: 40, reps: 8 });
  });

  it('uses ramp history separately without triggering working-set rest', async () => {
    const ui = await render(
      makeResult(
        'incline-dumbbell-press',
        [{ isWarmUp: true, completed: false }, { completed: false }],
        { completed: false },
      ),
    );
    const saved = await ui.click('.check-btn');
    expect(saved.sets[0]).toMatchObject({ weight: 25, reps: 5, completed: true });
    expect(saved.sets[1]).toMatchObject({ weight: null, reps: null, completed: false });
    expect(ui.onRest).not.toHaveBeenCalled();
  });
});
