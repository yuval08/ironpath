import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, HardDrive, Info, Upload, Video } from 'lucide-react';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { ConfirmButton, Sheet } from '@/components/Sheet';
import { EXERCISES } from '@/data/exercises';
import { getVideo } from '@/data/exerciseVideos';
import { REST_PRESETS } from '@/hooks/useTimers';
import {
  applyResumeChoice,
  deleteAllData,
  ensureSeeded,
  findInProgressSession,
  getAssessment,
  resetCurrentWorkout,
  updateSettings,
} from '@/db/repository';
import { downloadBackup, readJsonFile, restoreBackup } from '@/utils/backup';
import { downloadExcel } from '@/utils/excelExport';
import { storageEstimate } from '@/db/db';
import type { ThemeMode, VideoReference, WeightUnit } from '@/types';

export default function SettingsScreen() {
  const { plan, settings, sessions, records, storagePersisted } = useAppData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const jsonInput = useRef<HTMLInputElement>(null);
  const [videoSheet, setVideoSheet] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, [sessions]);

  if (!plan || !settings) return null;

  const exportExcel = async () => {
    setBusy(true);
    try {
      const assessment = await getAssessment(plan.id);
      const name = await downloadExcel({ plan, sessions, records, settings, assessment });
      toast(`Exported ${name}`);
    } catch (error) {
      toast(`Export failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const json = await readJsonFile(file);
      const result = await restoreBackup(json);
      toast(`Restored ${result.sessions} sessions and ${result.plans} plan(s)`);
    } catch (error) {
      toast((error as Error).message);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">
          <h3>Profile</h3>
        </div>
        <label className="field">
          Name
          <input
            value={settings.userName}
            onChange={(e) => void updateSettings({ userName: e.target.value })}
            placeholder="Shown on the Excel summary sheet"
          />
        </label>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <label className="field">
            Weight unit
            <select
              value={settings.weightUnit}
              onChange={(e) => void updateSettings({ weightUnit: e.target.value as WeightUnit })}
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </label>
          <label className="field">
            Bodyweight
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              value={settings.bodyweight ?? ''}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                void updateSettings({
                  bodyweight:
                    e.target.value === '' || !Number.isFinite(parsed) || parsed <= 0
                      ? null
                      : parsed,
                });
              }}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Appearance &amp; timers</h3>
        </div>
        <label className="field">
          Theme
          <select
            value={settings.theme}
            onChange={(e) => void updateSettings({ theme: e.target.value as ThemeMode })}
          >
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          Default rest
          <select
            value={settings.restDefaultSeconds}
            onChange={(e) => void updateSettings({ restDefaultSeconds: Number(e.target.value) })}
          >
            {REST_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p} seconds
              </option>
            ))}
          </select>
        </label>
        <div className="switch">
          <span>Vibrate when rest ends</span>
          <input
            type="checkbox"
            checked={settings.vibrateOnRestEnd}
            onChange={(e) => void updateSettings({ vibrateOnRestEnd: e.target.checked })}
          />
        </div>
        <div className="switch">
          <span>Beep when rest ends</span>
          <input
            type="checkbox"
            checked={settings.soundOnRestEnd}
            onChange={(e) => void updateSettings({ soundOnRestEnd: e.target.checked })}
          />
        </div>
        <div className="switch">
          <span>Collapse completed exercises</span>
          <input
            type="checkbox"
            checked={settings.autoCollapseCompleted}
            onChange={(e) => void updateSettings({ autoCollapseCompleted: e.target.checked })}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div className="row tight">
            <Video size={17} />
            <h3>Videos</h3>
          </div>
          <button className="btn small ghost" onClick={() => setVideoSheet(true)}>
            Manage
          </button>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>
          {Object.keys(settings.videoOverrides).length} custom link
          {Object.keys(settings.videoOverrides).length === 1 ? '' : 's'} saved. Links shown as
          &quot;Search YouTube&quot; are searches, not verified videos.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Export &amp; backup</h3>
        </div>
        <div className="stack">
          <button className="btn primary block" disabled={busy} onClick={() => void exportExcel()}>
            <FileSpreadsheet size={17} /> Export workout history to Excel
          </button>
          <button
            className="btn block"
            onClick={() =>
              void downloadBackup()
                .then((n) => toast(`Saved ${n}`))
                .catch((error: Error) => toast(`Backup failed: ${error.message}`))
            }
          >
            <Download size={17} /> Export all data as JSON
          </button>
          <button className="btn block" onClick={() => jsonInput.current?.click()}>
            <Upload size={17} /> Import JSON backup
          </button>
          <input
            ref={jsonInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = '';
            }}
          />
          <button className="btn block" onClick={() => navigate('/import')}>
            <FileSpreadsheet size={17} /> Import old workout Excel
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <div className="row tight">
            <HardDrive size={17} />
            <h3>Storage</h3>
          </div>
          <span className={`pill ${storagePersisted ? 'green' : 'yellow'}`}>
            {storagePersisted ? 'Persistent' : 'Best effort'}
          </span>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>
          {storage
            ? `${(storage.usage / 1024 / 1024).toFixed(1)} MB used of ${(storage.quota / 1024 / 1024).toFixed(0)} MB available.`
            : 'Storage estimate unavailable in this browser.'}
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <div className="row tight">
            <Info size={17} />
            <h3>Version</h3>
          </div>
        </div>
        {/* The only way to tell an up-to-date install from a stale cached one. */}
        <div className="row tight" style={{ justifyContent: 'space-between' }}>
          <span className="muted tiny">Build</span>
          <span className="tiny" style={{ fontWeight: 700 }}>
            {__BUILD_ID__}
          </span>
        </div>
        <p className="muted tiny" style={{ margin: '8px 0 0' }}>
          If this is older than the build on your machine, the app is still running from cache —
          relaunch and tap Update when prompted.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Reset</h3>
        </div>
        <div className="stack">
          <ConfirmButton
            className="btn block"
            label="Reset current workout"
            confirmLabel="Delete the workout currently in progress?"
            onConfirm={() => {
              void findInProgressSession().then(async (s) => {
                if (!s) {
                  toast('No workout in progress');
                  return;
                }
                await resetCurrentWorkout(s.id);
                toast('Current workout deleted');
              });
            }}
          />
          <ConfirmButton
            className="btn block"
            label="Reset current week"
            confirmLabel="Delete every session logged in the current week?"
            onConfirm={() => {
              void applyResumeChoice('restartWeek').then(() => toast('Current week reset'));
            }}
          />
          <ConfirmButton
            className="btn block"
            label="Reset full four-week plan"
            confirmLabel="Delete all sessions and restart at Week 1?"
            onConfirm={() => {
              void applyResumeChoice('restartBlock').then(() => toast('Plan restarted at Week 1'));
            }}
          />
          <ConfirmButton
            label="Delete all local data"
            confirmLabel="This permanently deletes every workout, record and setting on this device. Export a backup first. Continue?"
            onConfirm={() => {
              void deleteAllData()
                .then(ensureSeeded)
                .then(() => {
                  toast('All local data deleted');
                  navigate('/');
                });
            }}
          />
        </div>
      </div>

      <Sheet open={videoSheet} title="Manage videos" onClose={() => setVideoSheet(false)}>
        <VideoManager />
      </Sheet>
    </div>
  );
}

function VideoManager() {
  const { settings } = useAppData();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  if (!settings) return null;

  const overrides = settings.videoOverrides;
  const list = EXERCISES.filter((ex) => ex.name.toLowerCase().includes(query.toLowerCase()));

  const setUrl = async (exerciseId: string, url: string) => {
    const current = getVideo(exerciseId, overrides);
    if (!url) {
      const next = { ...overrides };
      delete next[exerciseId];
      await updateSettings({ videoOverrides: next });
      toast('Reverted to the default link');
      return;
    }
    const override: VideoReference = {
      exerciseId,
      title: current?.title ?? exerciseId,
      creator: current?.creator ?? 'User provided',
      url,
      verified: true,
      userProvided: true,
    };
    await updateSettings({ videoOverrides: { ...overrides, [exerciseId]: override } });
    toast('Custom video saved');
  };

  return (
    <div className="stack">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter exercises"
        aria-label="Filter exercises"
      />
      <p className="muted tiny" style={{ margin: 0 }}>
        Paste a YouTube URL to pin a specific video for an exercise. Clear the field to fall back to
        the default search link.
      </p>
      {list.map((ex) => {
        const video = getVideo(ex.id, overrides);
        const isOverride = !!overrides[ex.id];
        return (
          <label className="field" key={ex.id}>
            {ex.name} {isOverride && <span className="pill accent">custom</span>}
            <input
              type="url"
              defaultValue={isOverride ? video?.url : ''}
              placeholder={video && !isOverride ? 'Default: YouTube search' : 'https://youtu.be/…'}
              onBlur={(e) => void setUrl(ex.id, e.target.value.trim())}
            />
          </label>
        );
      })}
    </div>
  );
}
