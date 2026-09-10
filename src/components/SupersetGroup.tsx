import { useState } from 'react';
import { exerciseName } from '@/data/exercises';
import { ExerciseCard } from './ExerciseCard';
import type {
  BandLabels,
  PerformanceSnapshot,
  ProgressionVerdict,
} from '@/utils/doubleProgression';
import type { ExercisePrescription, ExerciseResult } from '@/types';

export interface SupersetMember {
  prescription: ExercisePrescription;
  result: ExerciseResult;
  lastSnapshot: PerformanceSnapshot | null;
  verdict: ProgressionVerdict | null;
}

/** 'A1' -> 'Superset A'; an unslotted pairing falls back to its block heading. */
function groupTitle(members: SupersetMember[]): string {
  const slot = members.find((m) => m.prescription.slot)?.prescription.slot;
  if (slot) return `Superset ${slot.slice(0, 1)}`;
  return members[0]?.prescription.blockLabel ?? 'Superset';
}

function memberLabel(member: SupersetMember): string {
  const name = exerciseName(member.result.substitutionExerciseId ?? member.result.exerciseId);
  return member.prescription.slot ? `${member.prescription.slot} · ${name}` : name;
}

/**
 * One performed superset. The rest timer belongs to the group, not to a member:
 * the program encodes that by giving every member but the last `restSeconds: 0`,
 * so a non-final set shows the "next slot" hint where the timer would have been.
 */
export function SupersetGroup({
  members,
  weightUnit,
  bandLabels,
  expandedId,
  currentId,
  onToggleExpand,
  onChange,
  onRest,
}: {
  members: SupersetMember[];
  weightUnit: string;
  bandLabels?: BandLabels;
  expandedId: string | null;
  currentId: string | null;
  onToggleExpand: (prescriptionId: string) => void;
  onChange: (next: ExerciseResult) => void;
  onRest: (seconds: number) => void;
}) {
  // Which member last logged a set; drives the inline "next slot" hint.
  const [hintFor, setHintFor] = useState<string | null>(null);

  const last = members[members.length - 1];
  const groupRest = last?.prescription.restSeconds ?? 0;
  // Members can be prescribed different set counts (3 pull-up rounds against 5
  // press sets); only the rounds they share are actually performed paired.
  const pairedRounds = Math.min(...members.map((m) => m.prescription.sets));
  const restLabel =
    groupRest > 0
      ? ` · rest ${groupRest} s after ${members.length === 2 ? 'both' : `all ${members.length}`}`
      : '';

  return (
    <div className="superset">
      <div className="block-head">
        {groupTitle(members)}
        {restLabel}
      </div>
      <div className="superset-group">
        {members.map((member, index) => {
          const next = members[index + 1];
          return (
            <ExerciseCard
              key={member.prescription.id}
              prescription={member.prescription}
              result={member.result}
              weightUnit={weightUnit}
              bandLabels={bandLabels}
              lastSnapshot={member.lastSnapshot}
              verdict={member.verdict}
              isCurrent={currentId === member.prescription.id}
              expanded={expandedId === member.prescription.id}
              pairedRounds={pairedRounds}
              straightRestSeconds={groupRest}
              nextHint={next && hintFor === member.prescription.id ? memberLabel(next) : null}
              onSetToggled={(completed) =>
                setHintFor(completed && next ? member.prescription.id : null)
              }
              onToggleExpand={() => onToggleExpand(member.prescription.id)}
              onChange={onChange}
              onRest={onRest}
            />
          );
        })}
      </div>
    </div>
  );
}
