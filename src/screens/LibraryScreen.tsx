import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import { EXERCISES, getExercise } from '@/data/exercises';
import { substitutionsFor } from '@/data/substitutions';
import { VideoLink } from '@/components/VideoLink';
import { Sheet } from '@/components/Sheet';
import type { ExerciseCategory } from '@/types';

const CATEGORIES: (ExerciseCategory | 'all')[] = [
  'all',
  'pull',
  'push',
  'row',
  'squat',
  'hinge',
  'carry',
  'core',
  'mobility',
  'balance',
  'prehab',
  'cardio',
];

export default function LibraryScreen() {
  const { exerciseId } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ExerciseCategory | 'all'>('all');

  const selected = exerciseId ? getExercise(exerciseId) : undefined;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXERCISES.filter((ex) => {
      if (category !== 'all' && ex.category !== category) return false;
      if (!q) return true;
      return (
        ex.name.toLowerCase().includes(q) ||
        ex.searchTerms.some((t) => t.includes(q)) ||
        ex.primaryGoal.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div>
      <div className="search-wrap row tight">
        <Search size={17} aria-hidden style={{ position: 'absolute', left: 12, opacity: 0.5 }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          style={{ paddingLeft: 36 }}
        />
      </div>

      <div className="chips">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip ${category === c ? 'on' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="muted tiny">{results.length} exercises</p>

      <div className="card flush">
        {results.map((ex) => (
          <button key={ex.id} className="list-item" onClick={() => navigate(`/library/${ex.id}`)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{ex.name}</div>
              <div className="muted tiny">
                {ex.category} · {ex.equipment.join(', ')}
              </div>
            </div>
            {ex.isNewMovement && (
              <span className="pill accent">
                <Sparkles size={11} /> New
              </span>
            )}
          </button>
        ))}
        {results.length === 0 && (
          <p className="muted tiny" style={{ padding: 14 }}>
            No matches.
          </p>
        )}
      </div>

      <Sheet
        open={!!selected}
        title={selected?.name ?? ''}
        onClose={() => navigate('/library', { replace: true })}
      >
        {selected && (
          <div className="stack">
            <div className="row tight">
              <span className="pill">{selected.category}</span>
              {selected.isNewMovement && <span className="pill accent">New movement</span>}
              <span className="pill">
                {selected.defaultSets} × {selected.defaultReps}
              </span>
              {selected.tempo && <span className="pill">Tempo {selected.tempo}</span>}
            </div>

            <VideoLink exerciseId={selected.id} />

            <div>
              <h3>Goal</h3>
              <p className="muted tiny">{selected.primaryGoal}</p>
            </div>

            <div>
              <h3>Equipment</h3>
              <p className="muted tiny">{selected.equipment.join(', ')}</p>
            </div>

            <div>
              <h3>How to do it</h3>
              <ol style={{ paddingLeft: 18, fontSize: '0.88rem', margin: 0 }}>
                {selected.instructions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>

            <div>
              <h3>Common mistakes</h3>
              <ul className="muted tiny" style={{ paddingLeft: 18, margin: 0 }}>
                {selected.commonMistakes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>Safety</h3>
              <ul className="muted tiny" style={{ paddingLeft: 18, margin: 0 }}>
                {selected.safetyNotes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="grid-2">
              <div className="stat">
                <div className="label">Regression</div>
                <div className="tiny">{selected.regression ?? '—'}</div>
              </div>
              <div className="stat">
                <div className="label">Progression</div>
                <div className="tiny">{selected.progression ?? '—'}</div>
              </div>
            </div>

            <div>
              <h3>Muscles &amp; joints</h3>
              <p className="muted tiny">{selected.targets.join(' · ')}</p>
            </div>

            {substitutionsFor(selected.id).length > 0 && (
              <div>
                <h3>Substitutions</h3>
                <p className="muted tiny">
                  {substitutionsFor(selected.id)
                    .map((id) => getExercise(id)?.name ?? id)
                    .join(' · ')}
                </p>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
