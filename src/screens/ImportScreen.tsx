import { useRef, useState } from 'react';
import { Check, FileSpreadsheet, Trash2 } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { EXERCISES, exerciseName } from '@/data/exercises';
import { db } from '@/db/db';
import { updateSettings } from '@/db/repository';
import { parseLegacyTracker } from '@/utils/excelImport';
import { suggestStartWeight } from '@/utils/progression';
import type { ImportedWeight } from '@/types';

/**
 * Screen 1: upload a previous Excel tracker.
 * Screen 2: confirm the detected exercise mappings and the suggested start loads.
 */
export default function ImportScreen() {
  const { importedWeights, settings } = useAppData();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!settings) return null;

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const { rowsParsed, weights } = await parseLegacyTracker(buffer, settings.weightUnit);
      if (weights.length === 0) {
        toast('No exercise rows with weights found in that file');
        return;
      }
      await db.importedWeights.clear();
      await db.importedWeights.bulkPut(weights);
      toast(`Parsed ${rowsParsed} rows → ${weights.length} exercises`);
    } catch (error) {
      toast(`Could not read that file: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const update = async (row: ImportedWeight, patch: Partial<ImportedWeight>) => {
    await db.importedWeights.put({ ...row, ...patch, updatedAt: new Date().toISOString() });
  };

  const applyConfirmed = async () => {
    const confirmed = importedWeights.filter((w) => w.confirmed && w.mappedExerciseId);
    if (confirmed.length === 0) {
      toast('Confirm at least one mapping first');
      return;
    }
    const overrides = { ...settings.weightOverrides };
    for (const row of confirmed) {
      if (row.mappedExerciseId && row.suggestedStartWeight != null) {
        overrides[row.mappedExerciseId] = row.suggestedStartWeight;
      }
    }
    await updateSettings({ weightOverrides: overrides });
    toast(`Applied ${confirmed.length} starting weights`);
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <div className="row tight">
            <FileSpreadsheet size={18} />
            <h3>Import a previous tracker</h3>
          </div>
        </div>
        <p className="muted tiny">
          Upload your old workout Excel file. The app scans every sheet for a row containing
          &quot;Exercise&quot; and reads the &quot;S1 Wt / S1 Reps&quot; style columns beneath it,
          then suggests a starting load of roughly 40-60% of your previous working weight — the
          right range for a technique and tolerance block.
        </p>
        <button
          className="btn primary block"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? 'Reading…' : 'Choose Excel file'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {importedWeights.length > 0 && (
        <>
          <div className="card">
            <div className="card-title">
              <h3>Confirm mappings</h3>
              <span className="pill">
                {importedWeights.filter((w) => w.confirmed).length}/{importedWeights.length}
              </span>
            </div>
            <p className="muted tiny" style={{ margin: 0 }}>
              Check each detected exercise, adjust the mapping and edit the starting weight. Nothing
              is applied until you confirm it.
            </p>
          </div>

          {importedWeights
            .slice()
            .sort((a, b) => b.bestWeight - a.bestWeight)
            .map((row) => (
              <div className="card" key={row.id}>
                <div className="card-title">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: '0.92rem' }}>{row.sourceExerciseName}</strong>
                    <div className="muted tiny">
                      Previous best {row.bestWeight} {row.unit}
                      {row.bestReps ? ` × ${row.bestReps} reps` : ''} · seen {row.occurrences}×
                    </div>
                  </div>
                  <button
                    className="btn ghost small icon"
                    aria-label={`Remove ${row.sourceExerciseName}`}
                    onClick={() => void db.importedWeights.delete(row.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <label className="field">
                  Maps to
                  <select
                    value={row.mappedExerciseId ?? ''}
                    onChange={(e) => void update(row, { mappedExerciseId: e.target.value || null })}
                  >
                    <option value="">Not mapped — ignore</option>
                    {EXERCISES.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid-2" style={{ marginTop: 10 }}>
                  <label className="field">
                    Starting weight ({row.unit})
                    <input
                      type="number"
                      inputMode="decimal"
                      step={0.5}
                      value={row.suggestedStartWeight ?? ''}
                      onChange={(e) =>
                        void update(row, {
                          suggestedStartWeight:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="stat">
                    <div className="label">Suggested (50%)</div>
                    <div className="value" style={{ fontSize: '1rem' }}>
                      {suggestStartWeight(row.bestWeight)} {row.unit}
                    </div>
                  </div>
                </div>

                <button
                  className={`btn block small ${row.confirmed ? 'primary' : ''}`}
                  style={{ marginTop: 10 }}
                  onClick={() => void update(row, { confirmed: !row.confirmed })}
                  disabled={!row.mappedExerciseId}
                >
                  <Check size={14} />{' '}
                  {row.confirmed
                    ? `Confirmed → ${exerciseName(row.mappedExerciseId ?? '')}`
                    : 'Confirm this mapping'}
                </button>
              </div>
            ))}

          <button className="btn primary block" onClick={() => void applyConfirmed()}>
            Apply confirmed starting weights
          </button>
          <p className="muted tiny" style={{ marginTop: 8 }}>
            Applied weights become the recommended load in new sessions and stay editable
            everywhere. Exercises with no previous data start at bodyweight, the lightest band, or
            light dumbbells.
          </p>
        </>
      )}
    </div>
  );
}
