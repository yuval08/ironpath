import { useState } from 'react';
import { Copy, ExternalLink, PlayCircle, Search } from 'lucide-react';
import {
  MOBILITY_FOLLOW_ALONG,
  MOBILITY_FOLLOW_ALONG_CANDIDATES,
  isSearchLink,
} from '@/data/exerciseVideos';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { updateSettings } from '@/db/repository';
import { copyLink } from './VideoLink';
import type { VideoReference } from '@/types';

const OVERRIDE_KEY = 'mobility-follow-along';

/**
 * Wednesday's single follow-along routine, shown alongside the individual movement
 * demonstrations on each exercise card. Candidate links are labelled unverified until
 * the user watches one and pins it.
 */
export function FollowAlongVideo() {
  const { settings } = useAppData();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const current: VideoReference = settings?.videoOverrides?.[OVERRIDE_KEY] ?? MOBILITY_FOLLOW_ALONG;
  const isSearch = isSearchLink(current);

  const pin = async (video: VideoReference) => {
    await updateSettings({
      videoOverrides: {
        ...(settings?.videoOverrides ?? {}),
        [OVERRIDE_KEY]: { ...video, verified: true, userProvided: true },
      },
    });
    setOpen(false);
    toast('Follow-along routine pinned');
  };

  return (
    <div className="card">
      <div className="card-title">
        <div className="row tight">
          <PlayCircle size={18} />
          <h3>Follow-along routine</h3>
        </div>
        {isSearch && <span className="pill yellow">Unverified</span>}
      </div>

      <p className="muted tiny">
        A 15-25 minute full-body routine covering shoulders, thoracic spine, hips and ankles. Each
        exercise below also links to its own movement demonstration.
      </p>

      <div className="row tight">
        <a
          className="btn primary small"
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flex: 1 }}
        >
          {isSearch ? <Search size={15} /> : <ExternalLink size={15} />}
          {isSearch
            ? 'Search YouTube for a follow-along routine'
            : 'Watch follow-along mobility routine'}
        </a>
        <button
          className="btn ghost small icon"
          aria-label="Copy follow-along link"
          onClick={() =>
            void copyLink(current.url).then((ok) => toast(ok ? 'Link copied' : 'Copy failed'))
          }
        >
          <Copy size={15} />
        </button>
      </div>

      <button
        className="btn ghost small block"
        style={{ marginTop: 8 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide suggestions' : 'Suggested routines'}
      </button>

      {open && (
        <div className="stack" style={{ marginTop: 10 }}>
          <p className="muted tiny" style={{ margin: 0 }}>
            These were not independently verified — watch one first, then pin it.
          </p>
          {MOBILITY_FOLLOW_ALONG_CANDIDATES.map((candidate) => (
            <div key={candidate.url} className="row tight">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{candidate.title}</div>
                <div className="muted tiny">
                  {candidate.creator}
                  {candidate.duration ? ` · ${candidate.duration}` : ''}
                </div>
              </div>
              <a
                className="btn small"
                href={candidate.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} /> Open
              </a>
              <button className="btn small primary" onClick={() => void pin(candidate)}>
                Pin
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
