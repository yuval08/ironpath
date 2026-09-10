import type {
  DayType,
  ExercisePrescription,
  Weekday,
  WeekPhase,
  WeekPlan,
  WorkoutDay,
} from '@/types';
import { substitutionsFor } from '../substitutions';
import { estimateSessionMinutes, type TimingOptions } from './timing';
import type { ProgramDefinition } from './index';

/**
 * ONE canonical four-day template. All fifteen weeks are generated from it by a
 * phase-driven scaling function — there is no duplicated week data. Twelve
 * hypertrophy weeks written out longhand would be twelve places to forget an
 * edit, and the whole point of double progression is that the *user's*
 * performance moves the load, not the calendar.
 *
 * The general warm-up happens outside the app (hence `warmUp: []`); the only
 * in-app preparation is the scapular pull-up on the two upper days.
 */

type TemplateItem = Omit<
  ExercisePrescription,
  'id' | 'substitutionIds' | 'perSide' | 'optional' | 'recommendedWeight'
> & {
  perSide?: boolean;
  optional?: boolean;
  recommendedWeight?: number | null;
};

interface DayTemplate {
  weekday: Weekday;
  dayType: DayType;
  title: string;
  focus: string;
  items: TemplateItem[];
}

/**
 * Rest is written on the LAST member of a superset only. `restSeconds: 0`
 * is the mechanism that says "go straight to the next slot" — the UI, the
 * time estimate and the tests all read it that way, so it must never be
 * a non-zero placeholder on a non-final member.
 */
const REST = {
  finisher: 45,
  short: 60,
  pump: 70,
  accessory: 85,
  press: 90,
  compound: 135,
};

/** Load steps that a lifter can actually make on this equipment. */
const STEP = {
  dumbbell: 2,
  cable: 2.5,
  stack: 5,
  legPress: 10,
};

export const DAY_TEMPLATES: DayTemplate[] = [
  /* ---------------------------------------------------------- Monday */
  {
    weekday: 'monday',
    dayType: 'upperA',
    title: 'Upper A — Pull-Up + Chest',
    focus: 'Vertical pulling, incline pressing, side delts, abs',
    items: [
      {
        exerciseId: 'scapular-pull-up',
        block: 'prep',
        blockLabel: 'Prep',
        order: 1,
        role: 'prep',
        progressionType: 'reps',
        sets: 2,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: REST.short,
        entryStyle: 'reps',
        targetRirLow: null,
        targetRirHigh: null,
        weightIncrement: null,
        rampSets: 0,
        notes: 'Full hang between reps. This primes the pull-up, it is not a working set.',
      },
      {
        exerciseId: 'band-assisted-pull-up',
        block: 'A',
        blockLabel: 'Superset A',
        slot: 'A1',
        supersetKey: 'upperA-A',
        order: 2,
        role: 'main',
        progressionType: 'bandAssist',
        sets: 3,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: 0,
        entryStyle: 'reps',
        recommendedBand: 'medium',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: null,
        rampSets: 0,
        notes: 'Progress by moving to a lighter band, never by grinding a rep.',
      },
      {
        exerciseId: 'incline-dumbbell-press',
        block: 'A',
        blockLabel: 'Superset A',
        slot: 'A2',
        supersetKey: 'upperA-A',
        order: 3,
        role: 'main',
        progressionType: 'double',
        sets: 5,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: REST.press,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.dumbbell,
        rampSets: 1,
        notes:
          'Only the first 3 sets pair with the pull-up; the last 2 are straight sets with full rest.',
      },
      {
        exerciseId: 'chest-supported-row',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B1',
        supersetKey: 'upperA-B',
        order: 4,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: 0,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'cable-lateral-raise',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B2',
        supersetKey: 'upperA-B',
        order: 5,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 12,
        repsHigh: 20,
        restSeconds: REST.pump,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.cable,
        rampSets: 0,
      },
      {
        exerciseId: 'cable-face-pull',
        block: 'C',
        blockLabel: 'Rear Delts',
        order: 6,
        role: 'accessory',
        progressionType: 'double',
        sets: 2,
        repsLow: 12,
        repsHigh: 20,
        restSeconds: REST.short,
        entryStyle: 'reps',
        targetRirLow: 2,
        targetRirHigh: 3,
        weightIncrement: STEP.cable,
        rampSets: 0,
        notes: 'Shoulder health work — keep a rep or two spare, it is not a strength set.',
      },
      {
        exerciseId: 'cable-crunch',
        block: 'finisher',
        blockLabel: 'Finisher',
        order: 7,
        role: 'finisher',
        progressionType: 'double',
        sets: 3,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: REST.finisher,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.cable,
        rampSets: 0,
      },
    ],
  },
  /* --------------------------------------------------------- Tuesday */
  {
    weekday: 'tuesday',
    dayType: 'lowerA',
    title: 'Lower A — Smith Squat',
    focus: 'Squat pattern, hamstrings, glutes, calves',
    items: [
      {
        exerciseId: 'smith-machine-squat',
        block: 'A',
        blockLabel: 'Main Lift',
        order: 1,
        role: 'main',
        progressionType: 'double',
        sets: 3,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: REST.compound,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 2,
        // Never supersetted: the heaviest lift of the week gets undivided attention.
        notes: 'Take full rest. Ramp up in two light sets before the first working set.',
      },
      {
        exerciseId: 'seated-leg-curl',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B1',
        supersetKey: 'lowerA-B',
        order: 2,
        role: 'accessory',
        progressionType: 'double',
        sets: 4,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: 0,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
        notes: 'The only direct hamstring work in the program — do not skip it.',
      },
      {
        exerciseId: 'leg-extension',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B2',
        supersetKey: 'lowerA-B',
        order: 3,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: REST.accessory,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'hip-thrust',
        block: 'C',
        blockLabel: 'Superset C',
        slot: 'C1',
        supersetKey: 'lowerA-C',
        order: 4,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: 0,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'standing-calf-raise',
        block: 'C',
        blockLabel: 'Superset C',
        slot: 'C2',
        supersetKey: 'lowerA-C',
        order: 5,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: REST.press,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'tibialis-raise',
        block: 'finisher',
        blockLabel: 'Finisher',
        order: 6,
        role: 'finisher',
        progressionType: 'reps',
        sets: 2,
        repsLow: 15,
        repsHigh: 20,
        restSeconds: REST.finisher,
        entryStyle: 'reps',
        targetRirLow: null,
        targetRirHigh: null,
        weightIncrement: null,
        rampSets: 0,
      },
    ],
  },
  /* -------------------------------------------------------- Thursday */
  {
    weekday: 'thursday',
    dayType: 'upperB',
    title: 'Upper B — Pull-Up + Shoulders',
    focus: 'Vertical pulling, overhead and flat pressing, side delts, abs',
    items: [
      {
        exerciseId: 'scapular-pull-up',
        block: 'prep',
        blockLabel: 'Prep',
        order: 1,
        role: 'prep',
        progressionType: 'reps',
        sets: 2,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: REST.short,
        entryStyle: 'reps',
        targetRirLow: null,
        targetRirHigh: null,
        weightIncrement: null,
        rampSets: 0,
        notes: 'Full hang between reps. This primes the pull-up, it is not a working set.',
      },
      {
        exerciseId: 'band-assisted-pull-up',
        block: 'A',
        blockLabel: 'Superset A',
        slot: 'A1',
        supersetKey: 'upperB-A',
        order: 2,
        role: 'main',
        progressionType: 'bandAssist',
        sets: 3,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: 0,
        entryStyle: 'reps',
        recommendedBand: 'medium',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: null,
        rampSets: 0,
        notes: 'Progress by moving to a lighter band, never by grinding a rep.',
      },
      {
        exerciseId: 'seated-dumbbell-shoulder-press',
        block: 'A',
        blockLabel: 'Superset A',
        slot: 'A2',
        supersetKey: 'upperB-A',
        order: 3,
        role: 'main',
        progressionType: 'double',
        sets: 3,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: REST.press,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.dumbbell,
        rampSets: 1,
      },
      {
        exerciseId: 'neutral-grip-lat-pulldown',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B1',
        supersetKey: 'upperB-B',
        order: 4,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: 0,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'flat-dumbbell-press',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B2',
        supersetKey: 'upperB-B',
        order: 5,
        role: 'main',
        progressionType: 'double',
        sets: 5,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: REST.press,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.dumbbell,
        rampSets: 0,
        notes:
          'Only the first 3 sets pair with the pulldown; the last 2 are straight sets with full rest.',
      },
      {
        exerciseId: 'cable-lateral-raise',
        block: 'C',
        blockLabel: 'Side Delts',
        order: 6,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 12,
        repsHigh: 20,
        restSeconds: REST.short,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.cable,
        rampSets: 0,
      },
      {
        exerciseId: 'captains-chair-leg-raise',
        block: 'finisher',
        blockLabel: 'Finisher',
        order: 7,
        role: 'finisher',
        progressionType: 'reps',
        sets: 3,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: REST.finisher,
        entryStyle: 'reps',
        targetRirLow: null,
        targetRirHigh: null,
        weightIncrement: null,
        rampSets: 0,
        notes: 'Back supported throughout. No hanging leg raises in this program.',
      },
    ],
  },
  /* ---------------------------------------------------------- Friday */
  {
    weekday: 'friday',
    dayType: 'lowerB',
    title: 'Lower B — Leg Press',
    focus: 'Quad volume, hamstrings, glutes, calves',
    items: [
      {
        exerciseId: 'leg-press',
        block: 'A',
        blockLabel: 'Main Lift',
        order: 1,
        role: 'main',
        progressionType: 'double',
        sets: 3,
        repsLow: 6,
        repsHigh: 10,
        restSeconds: REST.compound,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.legPress,
        rampSets: 2,
        // Never supersetted, for the same reason as the Smith squat.
        notes: 'Take full rest. Ramp up in two light sets before the first working set.',
      },
      {
        exerciseId: 'supported-split-squat',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B1',
        supersetKey: 'lowerB-B',
        order: 2,
        role: 'accessory',
        progressionType: 'double',
        sets: 2,
        repsLow: 8,
        repsHigh: 12,
        perSide: true,
        restSeconds: 0,
        entryStyle: 'repsPerSide',
        targetRirLow: 2,
        targetRirHigh: 2,
        weightIncrement: STEP.dumbbell,
        rampSets: 0,
        optional: true,
        notes:
          'Optional. This is the first set to drop if sessions consistently run past 55 minutes — the quad volume survives it. No reverse lunges; swap to a low step-up if the knee objects.',
      },
      {
        exerciseId: 'seated-leg-curl',
        block: 'B',
        blockLabel: 'Superset B',
        slot: 'B2',
        supersetKey: 'lowerB-B',
        order: 3,
        role: 'accessory',
        progressionType: 'double',
        sets: 4,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: REST.accessory,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'hip-thrust',
        block: 'C',
        blockLabel: 'Superset C',
        slot: 'C1',
        supersetKey: 'lowerB-C',
        order: 4,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: 0,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'standing-calf-raise',
        block: 'C',
        blockLabel: 'Superset C',
        slot: 'C2',
        supersetKey: 'lowerB-C',
        order: 5,
        role: 'accessory',
        progressionType: 'double',
        sets: 3,
        repsLow: 10,
        repsHigh: 15,
        restSeconds: REST.press,
        entryStyle: 'reps',
        targetRirLow: 1,
        targetRirHigh: 2,
        weightIncrement: STEP.stack,
        rampSets: 0,
      },
      {
        exerciseId: 'tibialis-raise',
        block: 'finisher',
        blockLabel: 'Finisher',
        order: 6,
        role: 'finisher',
        progressionType: 'reps',
        sets: 2,
        repsLow: 15,
        repsHigh: 20,
        restSeconds: REST.finisher,
        entryStyle: 'reps',
        targetRirLow: null,
        targetRirHigh: null,
        weightIncrement: null,
        rampSets: 0,
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Phase scaling                                                       */
/* ------------------------------------------------------------------ */

interface PhaseRule {
  /** Sets for `role: 'main'` prescriptions, given the canonical template count. */
  mainSets: (base: number) => number;
  /** Sets for everything else. */
  otherSets: (base: number) => number;
  /** Overrides the template's target RIR; null keeps whatever the template asks for. */
  rir: [number, number] | null;
  /**
   * Reload week 1 runs deliberately light, so a ramp-up would be a ramp to
   * nothing. Ramps are offered from reload week 2 onward.
   */
  allowRamp: boolean;
}

const PHASE_RULES: Record<'reload1' | 'reload2' | 'hypertrophy' | 'deload', PhaseRule> = {
  reload1: {
    mainSets: (base) => Math.min(base, 2),
    otherSets: (base) => Math.min(base, 2),
    rir: [3, 3],
    allowRamp: false,
  },
  reload2: {
    mainSets: (base) => base,
    otherSets: (base) => Math.min(base, 3),
    rir: [2, 3],
    allowRamp: true,
  },
  hypertrophy: {
    mainSets: (base) => base,
    otherSets: (base) => base,
    rir: null,
    allowRamp: true,
  },
  deload: {
    mainSets: (base) => Math.min(base, 2),
    otherSets: (base) => Math.min(base, 2),
    rir: [3, 3],
    allowRamp: true,
  },
};

interface WeekMeta {
  weekNumber: number;
  phase: WeekPhase;
  blockWeek: number | null;
  rule: PhaseRule;
  title: string;
  focus: string;
  guidance: string[];
}

const RELOAD_1_GUIDANCE = [
  'Two sets of everything. This week exists to remember the movements, not to test them.',
  'Stop every working set with 3 reps in reserve (RIR 3).',
  'Do not reduce band assistance this week even if the reps feel easy.',
  'Do the general warm-up before you open the app — the session timer covers the lifting only.',
];

const RELOAD_2_GUIDANCE = [
  'Main lifts return to full sets; accessories stay capped at 3.',
  'Stop working sets with 2-3 reps in reserve (RIR 2-3).',
  'This is the week you settle on real starting loads — write down what you used.',
  'Ramp sets are available again on the Smith squat, leg press and the dumbbell presses.',
];

const HYPERTROPHY_GUIDANCE = [
  'Full sets. Stop working sets with 1-2 reps in reserve (RIR 1-2); the last set of an isolation exercise may reach RIR 0-1.',
  'Add load only when every working set hit the TOP of the rep range with good form — the app will tell you when.',
  'Ramp sets are not counted. Log them if you want the record, skip them if you do not.',
  'Non-final superset slots have no rest: go straight to the next exercise.',
];

const DELOAD_GUIDANCE = [
  'Two sets of everything, at the loads you were already using.',
  'Stop every working set with 3 reps in reserve (RIR 3). Nothing is tested this week.',
  'The point is to arrive at the next block fresher than you left this one.',
];

const WEEK_META: WeekMeta[] = [
  {
    weekNumber: 1,
    phase: 'reload',
    blockWeek: null,
    rule: PHASE_RULES.reload1,
    title: 'Reload Week 1 — Technique & Load Reintroduction',
    focus: 'Re-groove the patterns at conservative loads',
    guidance: RELOAD_1_GUIDANCE,
  },
  {
    weekNumber: 2,
    phase: 'reload',
    blockWeek: null,
    rule: PHASE_RULES.reload2,
    title: 'Reload Week 2 — Establish Starting Loads',
    focus: 'Find the weights the twelve-week block will build on',
    guidance: RELOAD_2_GUIDANCE,
  },
  ...Array.from({ length: 12 }, (_, i): WeekMeta => {
    const blockWeek = i + 1;
    return {
      weekNumber: blockWeek + 2,
      phase: 'hypertrophy',
      blockWeek,
      rule: PHASE_RULES.hypertrophy,
      title: `Hypertrophy Week ${blockWeek}`,
      focus: 'Full working volume, progressed by performance',
      guidance: HYPERTROPHY_GUIDANCE,
    };
  }),
  {
    weekNumber: 15,
    phase: 'deload',
    blockWeek: null,
    rule: PHASE_RULES.deload,
    title: 'Deload Week — Recover & Reset',
    focus: 'Halve the volume, keep the loads, recover',
    guidance: DELOAD_GUIDANCE,
  },
];

function scale(item: TemplateItem, rule: PhaseRule): TemplateItem {
  const sets = item.role === 'main' ? rule.mainSets(item.sets) : rule.otherSets(item.sets);
  // An item with no target RIR (prep and rep-progressed finishers) never gains one.
  const rir = rule.rir != null && item.targetRirLow != null ? rule.rir : null;
  return {
    ...item,
    sets,
    rampSets: rule.allowRamp ? item.rampSets : 0,
    targetRirLow: rir ? rir[0] : item.targetRirLow,
    targetRirHigh: rir ? rir[1] : item.targetRirHigh,
  };
}

/**
 * Every id this program mints is program-prefixed. Both programs have a week 1
 * upperA day, and sessions are looked up by bare `dayId` — an unprefixed
 * `w1-upperA` here would collide with the resilience block's day and hand back
 * the wrong program's session. The resilience scheme stays unprefixed because
 * stored sessions already reference those ids.
 */
const ID_PREFIX = 'h14';

/**
 * Loaded sets with a controlled eccentric run slower than the resilience
 * block's bodyweight and mobility work, and every superset here pairs two
 * machines you have to walk between. See the note in timing.ts: this is
 * deliberately NOT the shared default.
 */
export const HYPERTROPHY_TIMING: TimingOptions = {
  secondsPerRep: 4,
  intraSupersetSeconds: 15,
};

export function buildWorkoutDay(
  template: DayTemplate,
  weekNumber: number,
  rule: PhaseRule,
): WorkoutDay {
  const prescriptions = template.items.map((raw) => {
    const item = scale(raw, rule);
    return {
      ...item,
      id: `${ID_PREFIX}-w${weekNumber}-${template.dayType}-${item.exerciseId}-${item.order}`,
      perSide: item.perSide ?? false,
      optional: item.optional ?? false,
      recommendedWeight: item.recommendedWeight ?? null,
      substitutionIds: substitutionsFor(item.exerciseId),
    } satisfies ExercisePrescription;
  });

  return {
    id: `${ID_PREFIX}-w${weekNumber}-${template.dayType}`,
    weekNumber,
    weekday: template.weekday,
    dayType: template.dayType,
    title: template.title,
    focus: template.focus,
    // Computed, never hand-written — a stale constant hid a real overrun.
    estimatedMinutes: estimateSessionMinutes(prescriptions, HYPERTROPHY_TIMING),
    prescriptions,
  };
}

export function buildWeeks(): WeekPlan[] {
  return WEEK_META.map((meta) => ({
    weekNumber: meta.weekNumber,
    title: meta.title,
    focus: meta.focus,
    guidance: meta.guidance,
    phase: meta.phase,
    blockWeek: meta.blockWeek,
    days: DAY_TEMPLATES.map((t) => buildWorkoutDay(t, meta.weekNumber, meta.rule)),
  }));
}

export const DAY_LABELS: Record<DayType, string> = {
  upperA: 'Upper A — Pull-Up + Chest',
  lowerA: 'Lower A — Smith Squat',
  // This program has no mobility day; the label exists so the record is total.
  mobility: 'Mobility',
  upperB: 'Upper B — Pull-Up + Shoulders',
  lowerB: 'Lower B — Leg Press',
};

export const hypertrophy14Program: ProgramDefinition = {
  id: 'hypertrophy-14wk',
  name: '14-Week Hypertrophy — Upper / Lower',
  shortName: 'Hypertrophy 14',
  description:
    'Two reload weeks, twelve hypertrophy weeks and a deload, run as an upper/lower split four days a week. Double progression on load, band progression on the pull-up, no deadlift variations.',
  weekCount: WEEK_META.length,
  daysPerWeek: DAY_TEMPLATES.length,
  // The general warm-up is done outside the app so it does not eat the session timer.
  warmUp: [],
  dayLabels: DAY_LABELS,
  buildWeeks,
};
