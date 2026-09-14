import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { programFor } from '@/data/programs';
import { planUpdateStatus } from '@/data/programs/planSync';
import { applyProgramUpdate } from '@/db/repository';
import { useToast } from '@/state/ToastProvider';
import type { WeightUnit, WorkoutPlan } from '@/types';

/**
 * Offers an updated program to a plan that startup could not update by itself.
 *
 * Unedited plans are brought up to date silently at launch, so this only ever
 * appears for a plan with changes made on this screen — the one case where
 * applying the update replaces something the user did. Logged workouts are never
 * affected either way, and the copy says so.
 */
export function ProgramUpdateBanner({
  plan,
  weightUnit,
}: {
  plan: WorkoutPlan;
  weightUnit: WeightUnit;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const program = programFor(plan.programId);
  const status = useMemo(
    () => planUpdateStatus(plan, program, weightUnit),
    [plan, program, weightUnit],
  );

  if (status !== 'edited') return null;

  const apply = async () => {
    const ok = window.confirm(
      `Update ${program.name} to the latest version? Changes you made to exercises on this ` +
        'screen will be replaced. Your logged workouts and your place in the plan are kept.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await applyProgramUpdate(plan.id);
      toast('Plan updated');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="banner info">
      <div className="row tight">
        <RefreshCw size={16} />
        <strong>An updated version of this program is available</strong>
      </div>
      <p className="tiny" style={{ margin: '4px 0 10px' }}>
        It was not applied automatically because you have edited exercises in this plan.
      </p>
      <button className="btn primary block small" disabled={busy} onClick={() => void apply()}>
        {busy ? 'Updating…' : 'Update plan'}
      </button>
    </div>
  );
}
