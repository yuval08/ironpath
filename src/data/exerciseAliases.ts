/** Import-only spellings; canonical IDs keep progression and history together. */
export const EXERCISE_IMPORT_ALIASES: Readonly<Record<string, string>> = {
  'assisted-pull-up': 'band-assisted-pull-up',
  'flat-dumbbell-bench-press': 'flat-dumbbell-press',
};

export function canonicalImportExerciseId(id: string): string {
  return Object.hasOwn(EXERCISE_IMPORT_ALIASES, id) ? EXERCISE_IMPORT_ALIASES[id]! : id;
}
