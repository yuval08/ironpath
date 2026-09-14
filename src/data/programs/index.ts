import type { DayType, ProgramId, WeightUnit, WeekPlan } from '@/types';
import type { WarmUpItem } from './timing';
import { movementResilienceProgram } from './movementResilience';
import { compileProgram } from './compile';
import hypertrophy14Json from './definitions/hypertrophy-14wk.json';

/**
 * The registry every screen, the repository and the exporter read from.
 * A plan stores only its `programId`, so anything that needs the shape of a
 * program — its warm-up, its day labels, how many weeks it has — resolves it
 * here rather than importing one program's module directly.
 */
export interface BuildOptions {
  weightUnit?: WeightUnit;
}

export interface ProgramDefinition {
  id: ProgramId;
  name: string;
  shortName: string;
  description: string;
  weekCount: number;
  daysPerWeek: number;
  /** Empty when the general warm-up is done outside the app. */
  warmUp: WarmUpItem[];
  dayLabels: Record<DayType, string>;
  /**
   * Weight steps are baked into the plan at creation, so the unit the user trains
   * in has to be known here — nothing converts stored weights later.
   */
  buildWeeks: (options?: BuildOptions) => WeekPlan[];
}

/**
 * Programs written as data live in `definitions/*.json` and are compiled here.
 * To change what a program trains, edit its JSON — no code changes. To add one,
 * drop in a JSON file, add its id to `programIdSchema`, and register it below.
 * The Movement Resilience block predates this and stays in TypeScript: its stored
 * sessions reference ids minted by that code, and it is finished work.
 */
const hypertrophy14Program = compileProgram(hypertrophy14Json, 'hypertrophy-14wk');

export const PROGRAMS: Record<ProgramId, ProgramDefinition> = {
  'movement-resilience': movementResilienceProgram,
  'hypertrophy-14wk': hypertrophy14Program,
};

/**
 * Falls back to movement-resilience rather than throwing: a v1 row that somehow
 * reaches here without a `programId` is real user history, and refusing to render
 * it would be worse than rendering it as the block it was actually written for.
 */
export function programFor(id: ProgramId): ProgramDefinition {
  return PROGRAMS[id] ?? PROGRAMS['movement-resilience'];
}

/** New plans are created from this unless the user picks another program. */
export const DEFAULT_PROGRAM_ID: ProgramId = 'hypertrophy-14wk';

export { estimateSessionMinutes, supersetGroups, type WarmUpItem } from './timing';
export {
  WARM_UP,
  DAY_LABELS,
  WEEKDAY_LABELS,
  PUSH_UP_EXERCISE_IDS,
  buildWeeks,
} from './movementResilience';
