import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { EXERCISES, exerciseName } from '@/data/exercises';
import { PainScale } from '@/components/PainScale';
import { getAssessment, saveAssessment } from '@/db/repository';
import {
  completedSessions,
  completionPercent,
  maxDurationForExercise,
  maxRepsForExercise,
  maxTreadmillMinutes,
  pushUpTotal,
} from '@/utils/stats';
import type { FinalAssessment } from '@/types';

type Draft = Partial<FinalAssessment>;

export default function FinalAssessmentScreen() {
  const { plan, sessions } = useAppData();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!plan) return;
    void getAssessment(plan.id).then((existing) => {
      if (existing) {
        setDraft(existing);
        setSaved(true);
      }
    });
  }, [plan]);

  if (!plan) return null;
  const done = completedSessions(sessions);

  const num = (v: string) => (v === '' ? null : Number(v));

  const toggle = (key: 'favoriteExercises' | 'painfulExercises', id: string) => {
    const list = draft[key] ?? [];
    setDraft({
      ...draft,
      [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    });
  };

  const save = async () => {
    await saveAssessment(plan.id, draft);
    setSaved(true);
    toast('Final assessment saved — it is included in the Excel export');
  };

  return (
    <div>
      <div className="card">
        <div className="row tight" style={{ marginBottom: 6 }}>
          <ClipboardCheck size={18} />
          <h2>Final assessment</h2>
        </div>
        <p className="muted tiny">
          Complete this at the end of Week 4. Test when you are fresh, keep every rep clean, and
          stop any test that provokes pain.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Your logged bests</h3>
          <span className="pill accent">{completionPercent(sessions)}% complete</span>
        </div>
        <div className="grid-2">
          <div className="stat">
            <div className="value">{maxRepsForExercise(done, 'strict-pull-up')}</div>
            <div className="label">Pull-up best set</div>
          </div>
          <div className="stat">
            <div className="value">{maxRepsForExercise(done, 'chin-up')}</div>
            <div className="label">Chin-up best set</div>
          </div>
          <div className="stat">
            <div className="value">{maxRepsForExercise(done, 'standard-push-up')}</div>
            <div className="label">Push-up best set</div>
          </div>
          <div className="stat">
            <div className="value">{maxDurationForExercise(done, 'dead-hang')}s</div>
            <div className="label">Dead hang</div>
          </div>
          <div className="stat">
            <div className="value">{maxTreadmillMinutes(done, 'backward-treadmill-walk')}m</div>
            <div className="label">Backward treadmill</div>
          </div>
          <div className="stat">
            <div className="value">{pushUpTotal(done)}</div>
            <div className="label">Total push-ups</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Test results</h3>
        </div>
        <div className="grid-2">
          <label className="field">
            Max strict pull-ups
            <input
              type="number"
              inputMode="numeric"
              value={draft.maxStrictPullUps ?? ''}
              onChange={(e) => setDraft({ ...draft, maxStrictPullUps: num(e.target.value) })}
            />
          </label>
          <label className="field">
            Max chin-ups
            <input
              type="number"
              inputMode="numeric"
              value={draft.maxChinUps ?? ''}
              onChange={(e) => setDraft({ ...draft, maxChinUps: num(e.target.value) })}
            />
          </label>
          <label className="field">
            Max push-ups (one set)
            <input
              type="number"
              inputMode="numeric"
              value={draft.maxPushUps ?? ''}
              onChange={(e) => setDraft({ ...draft, maxPushUps: num(e.target.value) })}
            />
          </label>
          <label className="field">
            Dead hang (seconds)
            <input
              type="number"
              inputMode="numeric"
              value={draft.deadHangSeconds ?? ''}
              onChange={(e) => setDraft({ ...draft, deadHangSeconds: num(e.target.value) })}
            />
          </label>
          <label className="field">
            Single-leg balance (seconds)
            <input
              type="number"
              inputMode="numeric"
              value={draft.singleLegBalanceSeconds ?? ''}
              onChange={(e) => setDraft({ ...draft, singleLegBalanceSeconds: num(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>How the joints feel</h3>
        </div>
        <p className="muted tiny">0 = completely comfortable, 10 = very uncomfortable.</p>
        <PainScale
          label="Knee comfort"
          value={draft.kneeComfort ?? null}
          onChange={(v) => setDraft({ ...draft, kneeComfort: v })}
        />
        <PainScale
          label="Shoulder comfort"
          value={draft.shoulderComfort ?? null}
          onChange={(v) => setDraft({ ...draft, shoulderComfort: v })}
        />
        <PainScale
          label="Lower-back comfort"
          value={draft.lowerBackComfort ?? null}
          onChange={(v) => setDraft({ ...draft, lowerBackComfort: v })}
        />
        <PainScale
          label="Overall energy (10 = excellent)"
          value={draft.overallEnergy ?? null}
          onChange={(v) => setDraft({ ...draft, overallEnergy: v })}
        />
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Favourite exercises</h3>
        </div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {EXERCISES.map((ex) => (
            <button
              key={ex.id}
              className={`chip ${(draft.favoriteExercises ?? []).includes(ex.id) ? 'on' : ''}`}
              onClick={() => toggle('favoriteExercises', ex.id)}
            >
              {ex.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Exercises that caused pain</h3>
        </div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {EXERCISES.map((ex) => (
            <button
              key={ex.id}
              className={`chip ${(draft.painfulExercises ?? []).includes(ex.id) ? 'on' : ''}`}
              onClick={() => toggle('painfulExercises', ex.id)}
            >
              {ex.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <label className="field">
          Ready for the next four-day program?
          <select
            value={draft.readyForNextProgram ?? 'unsure'}
            onChange={(e) =>
              setDraft({
                ...draft,
                readyForNextProgram: e.target.value as FinalAssessment['readyForNextProgram'],
              })
            }
          >
            <option value="yes">Yes — ready to start</option>
            <option value="partly">Partly — a few things still niggle</option>
            <option value="no">No — needs more time</option>
            <option value="unsure">Unsure</option>
          </select>
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          Notes
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="What changed, what still needs work"
          />
        </label>
        <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => void save()}>
          Save assessment
        </button>
      </div>

      {saved && (
        <div className="card">
          <div className="card-title">
            <h3>Summary</h3>
          </div>
          <ul style={{ paddingLeft: 18, fontSize: '0.88rem', margin: 0 }}>
            <li>
              Completed {done.length} of 20 sessions ({completionPercent(sessions)}%).
            </li>
            <li>
              Strict pull-ups: {draft.maxStrictPullUps ?? '—'} · Chin-ups: {draft.maxChinUps ?? '—'}{' '}
              · Push-ups: {draft.maxPushUps ?? '—'}
            </li>
            <li>
              Dead hang {draft.deadHangSeconds ?? '—'}s · Balance{' '}
              {draft.singleLegBalanceSeconds ?? '—'}s
            </li>
            <li>
              Comfort — knee {draft.kneeComfort ?? '—'}, shoulder {draft.shoulderComfort ?? '—'},
              lower back {draft.lowerBackComfort ?? '—'}
            </li>
            <li>Readiness for the next block: {draft.readyForNextProgram ?? 'unsure'}</li>
            {(draft.painfulExercises ?? []).length > 0 && (
              <li>Watch: {(draft.painfulExercises ?? []).map(exerciseName).join(', ')}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
