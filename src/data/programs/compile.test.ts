import { describe, expect, it } from 'vitest';
import { compileProgram } from './compile';

/** The smallest valid program; each test breaks exactly one thing. */
function program(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hypertrophy-14wk',
    name: 'Test program',
    shortName: 'Test',
    description: '',
    idPrefix: 't',
    loadSteps: { kg: { cable: 2.5 }, lb: { cable: 5 } },
    days: [
      {
        weekday: 'monday',
        dayType: 'upperA',
        title: 'Upper A',
        focus: '',
        blocks: [
          {
            key: 'F',
            label: 'Finisher',
            superset: true,
            restSeconds: 60,
            exercises: [
              {
                exercise: 'cable-crunch',
                progression: 'double',
                sets: 3,
                reps: [10, 15],
                rir: [1, 2],
                loadStep: 'cable',
              },
              {
                exercise: 'cable-curl',
                progression: 'double',
                sets: 3,
                reps: [10, 15],
                rir: [1, 2],
                loadStep: 'cable',
              },
            ],
          },
        ],
      },
    ],
    weeks: [
      {
        phase: 'reload',
        title: 'Reload',
        focus: '',
        setCap: { main: 2, other: 2 },
        rir: [3, 3],
        rampSets: false,
      },
      { phase: 'hypertrophy', repeat: 3, title: 'Block week {n}', focus: '' },
    ],
    ...overrides,
  };
}

function withBlock(block: Record<string, unknown>) {
  const base = program();
  return { ...base, days: [{ ...base.days[0]!, blocks: [block] }] };
}

describe('compileProgram', () => {
  it('derives slots, superset key, order and rest from the block', () => {
    const [day] = compileProgram(program(), 'hypertrophy-14wk').buildWeeks()[1]!.days;
    expect(day!.prescriptions.map((p) => [p.slot, p.supersetKey, p.order, p.restSeconds])).toEqual([
      ['F1', 'upperA-F', 1, 0],
      ['F2', 'upperA-F', 2, 60],
    ]);
  });

  it('expands a repeated week into consecutive numbered weeks', () => {
    const weeks = compileProgram(program(), 'hypertrophy-14wk').buildWeeks();
    expect(weeks.map((w) => [w.weekNumber, w.title, w.blockWeek])).toEqual([
      [1, 'Reload', null],
      [2, 'Block week 1', 1],
      [3, 'Block week 2', 2],
      [4, 'Block week 3', 3],
    ]);
  });

  it('applies a week’s set cap and RIR override, and leaves full weeks alone', () => {
    const weeks = compileProgram(program(), 'hypertrophy-14wk').buildWeeks();
    const reload = weeks[0]!.days[0]!.prescriptions[0]!;
    const block = weeks[1]!.days[0]!.prescriptions[0]!;
    expect([reload.sets, reload.targetRirLow, reload.targetRirHigh]).toEqual([2, 3, 3]);
    expect([block.sets, block.targetRirLow, block.targetRirHigh]).toEqual([3, 1, 2]);
  });

  it('picks the load step for the unit the plan is built in', () => {
    const built = compileProgram(program(), 'hypertrophy-14wk');
    const step = (unit: 'kg' | 'lb') =>
      built.buildWeeks({ weightUnit: unit })[1]!.days[0]!.prescriptions[0]!.weightIncrement;
    expect(step('lb')).toBe(5);
    expect(step('kg')).toBe(2.5);
  });

  it('rejects a superset member that declares its own rest', () => {
    const bad = withBlock({
      key: 'A',
      label: 'Superset A',
      superset: true,
      restSeconds: 90,
      exercises: [
        { exercise: 'cable-crunch', sets: 3, reps: [10, 15], restSeconds: 30 },
        { exercise: 'cable-curl', sets: 3, reps: [10, 15] },
      ],
    });
    expect(() => compileProgram(bad, 'hypertrophy-14wk')).toThrow(/take no rest of their own/);
  });

  it('rejects a superset with no rest on the block', () => {
    const bad = withBlock({
      key: 'A',
      label: 'Superset A',
      superset: true,
      exercises: [
        { exercise: 'cable-crunch', sets: 3, reps: [10, 15] },
        { exercise: 'cable-curl', sets: 3, reps: [10, 15] },
      ],
    });
    expect(() => compileProgram(bad, 'hypertrophy-14wk')).toThrow(
      /needs `restSeconds` on the block/,
    );
  });

  it('names the exercise and where it is when an id is unknown', () => {
    const bad = withBlock({
      key: 'A',
      label: 'Main',
      restSeconds: 90,
      exercises: [{ exercise: 'romanian-deadlift', sets: 3, reps: [6, 10] }],
    });
    expect(() => compileProgram(bad, 'hypertrophy-14wk')).toThrow(
      /unknown exercise "romanian-deadlift" \(upperA \/ A\)/,
    );
  });

  it('rejects a load step with no value in one of the units', () => {
    const bad = program({ loadSteps: { kg: { cable: 2.5 }, lb: {} } });
    expect(() => compileProgram(bad, 'hypertrophy-14wk')).toThrow(/has no lb value/);
  });

  it('rejects a file registered under the wrong id', () => {
    expect(() => compileProgram(program(), 'movement-resilience')).toThrow(/registered as/);
  });

  it('rejects unknown keys, so a typo cannot be silently ignored', () => {
    const bad = withBlock({
      key: 'A',
      label: 'Main',
      restSeconds: 90,
      exercises: [{ exercise: 'cable-curl', sets: 3, reps: [10, 15], rest: 60 }],
    });
    expect(() => compileProgram(bad, 'hypertrophy-14wk')).toThrow(/Unrecognized key/);
  });

  it('rejects a key lift the plan never trains, which would be a permanently empty row', () => {
    expect(() => compileProgram(program({ keyLifts: ['leg-press'] }), 'hypertrophy-14wk')).toThrow(
      /key lift "leg-press" is not prescribed/,
    );
  });
});
