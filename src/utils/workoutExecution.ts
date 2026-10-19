import type { ExercisePrescription, WorkoutDay } from '@/types';

/** A repeated superset key later in the day starts a separate group. */
export function prescriptionGroups(day: WorkoutDay): ExercisePrescription[][] {
  const groups: ExercisePrescription[][] = [];
  for (const prescription of [...day.prescriptions].sort((a, b) => a.order - b.order)) {
    const prior = groups.at(-1);
    const first = prior?.[0];
    if (
      first &&
      first.blockLabel === prescription.blockLabel &&
      prescription.supersetKey != null &&
      first.supersetKey === prescription.supersetKey
    )
      prior!.push(prescription);
    else groups.push([prescription]);
  }
  return groups;
}
