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
};

export function substitutionsFor(exerciseId: string): string[] {
  return SUBSTITUTIONS[exerciseId] ?? [];
}
