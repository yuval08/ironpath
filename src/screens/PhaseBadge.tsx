import type { WeekPlan } from '@/types';

/**
 * `Reload` / `Hypertrophy W7` / `Deload`. Returns null for `base`, the phase every
 * pre-Ironpath week migrates to — the resilience block has no phases to show and a
 * badge reading "Base" on all four of its weeks is noise.
 */
export function phaseLabel(week: Pick<WeekPlan, 'phase' | 'blockWeek'>): string | null {
  switch (week.phase) {
    case 'reload':
      return 'Reload';
    case 'deload':
      return 'Deload';
    case 'hypertrophy':
      return week.blockWeek != null ? `Hypertrophy W${week.blockWeek}` : 'Hypertrophy';
    default:
      return null;
  }
}

export function PhaseBadge({ week }: { week: Pick<WeekPlan, 'phase' | 'blockWeek'> }) {
  const label = phaseLabel(week);
  if (!label) return null;
  return <span className={`pill phase-${week.phase}`}>{label}</span>;
}
