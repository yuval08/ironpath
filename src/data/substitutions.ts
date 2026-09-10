/**
 * Programmed substitutions offered when pain is flagged or an exercise is skipped.
 * Ordered by preference.
 */
export const SUBSTITUTIONS: Record<string, string[]> = {
  'strict-pull-up': ['band-assisted-pull-up', 'negative-pull-up'],
  'chin-up': ['band-assisted-pull-up', 'negative-pull-up'],
  'decline-push-up': ['standard-push-up'],
  'pike-push-up': ['pike-push-up-elevated'],
  'inverted-row': ['band-row'],
  'trx-row': ['inverted-row', 'band-row'],
  'goblet-squat': ['bodyweight-squat-supported'],
  'supported-split-squat': ['step-up'],
  'sl-rdl-bodyweight': ['kickstand-rdl'],
  'bear-crawl': ['quadruped-shoulder-tap'],
  'backward-treadmill-walk': ['backward-floor-walk'],
  'farmer-carry': ['suitcase-carry'],
  'step-up': ['bodyweight-squat-supported'],
  'hip-thrust': ['glute-bridge'],

  /* --------------------------------- 14-week hypertrophy block */
  'incline-dumbbell-press': ['incline-smith-press'],
  'flat-dumbbell-press': ['chest-press-machine'],
  'cable-lateral-raise': ['dumbbell-lateral-raise'],
  'seated-leg-curl': ['lying-leg-curl'],
  // Back-supported only — this program deliberately has no hanging leg raises.
  'captains-chair-leg-raise': ['lying-leg-raise'],
};

export function substitutionsFor(exerciseId: string): string[] {
  return SUBSTITUTIONS[exerciseId] ?? [];
}
