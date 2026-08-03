import { Copy, ExternalLink, Search, VideoOff } from 'lucide-react';
import { getVideo, isSearchLink } from '@/data/exerciseVideos';
import { useAppData } from '@/state/AppDataProvider';
import { useToast } from '@/state/ToastProvider';
import { updateSettings } from '@/db/repository';
import type { VideoReference } from '@/types';

export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

interface Props {
  exerciseId: string;
  onViewed?: () => void;
  /** Hides the copy / mark-unavailable controls. */
  compact?: boolean;
  /** Icon-only trigger — used in dense lists like the warm-up. */
  iconOnly?: boolean;
}

/**
 * Opens the configured video externally. Search URLs are labelled "Search YouTube"
 * so an unverified link never masquerades as a checked demonstration.
 */
export function VideoLink({ exerciseId, onViewed, compact, iconOnly }: Props) {
  const { settings } = useAppData();
  const { toast } = useToast();
  const video = getVideo(exerciseId, settings?.videoOverrides ?? {});

  if (!video) return null;
  if (video.unavailable) {
    return (
      <span className="pill">
        <VideoOff size={13} /> Marked unavailable
      </span>
    );
  }

  const isSearch = isSearchLink(video);
  const label = isSearch ? 'Search YouTube' : 'Watch video';

  if (iconOnly) {
    return (
      <a
        className="btn small ghost icon"
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} for ${video.title}`}
        title={label}
        onClick={() => onViewed?.()}
      >
        {isSearch ? <Search size={16} /> : <ExternalLink size={16} />}
      </a>
    );
  }

  return (
    <div className="row tight">
      <a
        className="btn small"
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onViewed?.()}
      >
        {isSearch ? <Search size={14} /> : <ExternalLink size={14} />}
        {label}
      </a>
      {!compact && (
        <>
          <button
            className="btn small ghost icon"
            aria-label="Copy video link"
            onClick={() => {
              void copyLink(video.url).then((ok) =>
                toast(ok ? 'Link copied' : 'Could not copy — long-press the link instead'),
              );
            }}
          >
            <Copy size={14} />
          </button>
          <button
            className="btn small ghost icon"
            aria-label="Mark video unavailable"
            onClick={() => void markUnavailable(exerciseId, video, settings?.videoOverrides ?? {})}
          >
            <VideoOff size={14} />
          </button>
        </>
      )}
      {!compact && (
        <span className="muted tiny">
          {video.creator}
          {video.duration ? ` · ${video.duration}` : ''}
        </span>
      )}
    </div>
  );
}

async function markUnavailable(
  exerciseId: string,
  video: VideoReference,
  overrides: Record<string, VideoReference>,
): Promise<void> {
  await updateSettings({
    videoOverrides: { ...overrides, [exerciseId]: { ...video, unavailable: true } },
  });
}
