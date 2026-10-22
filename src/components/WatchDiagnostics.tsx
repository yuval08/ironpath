import { useCallback, useEffect, useRef, useState } from 'react';
import { WatchLink, watchLinkSupported } from '@/utils/watchLink';
import { exportDiagnostics, loadDiagnostics } from '@/watch/diagnostics';
import type { DiagnosticsView } from '@/watch/diagnostics';

const time = (at: number | null) => (at ? new Date(at).toLocaleString() : 'never');

/** Delivery diagnostics kept on both devices; exported only when the user asks. */
export function WatchDiagnostics() {
  const [view, setView] = useState<DiagnosticsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    try {
      const next = await loadDiagnostics(100);
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) setMessage('Diagnostics are unavailable in this app version.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (watchLinkSupported()) void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);
  if (!watchLinkSupported()) return null;

  const fetchFromWatch = async () => {
    setBusy(true);
    try {
      const { requested, reason } = await WatchLink.requestWatchDiagnostics();
      setMessage(
        requested
          ? 'Requested watch events. They appear here once the watch replies.'
          : reason === 'legacyWatch'
            ? 'Update the watch app to 0.5.0 to retrieve its diagnostics.'
            : 'No watch is connected.',
      );
      if (requested) window.setTimeout(() => void reload(), 2000);
    } catch {
      setMessage('Could not reach the watch. Retry when it is connected.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const exportAll = async () => {
    setBusy(true);
    try {
      setMessage(`Exported ${await exportDiagnostics()}.`);
    } catch {
      setMessage('Could not export diagnostics. Please try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const summary = view?.summary;
  return (
    <section className="card">
      <h3>Watch sync diagnostics</h3>
      <p className="muted tiny">
        The last 500 events per device for up to 14 days, kept on this phone. Nothing is uploaded.
      </p>
      {summary && (
        <ul className="tiny">
          <li>
            Phone: {summary.phone.count} events since {time(summary.phone.oldestAt)}
          </li>
          <li>
            Watch: {summary.watch.count} events, last retrieved{' '}
            {time(summary.watch.lastRetrievedAt)}
          </li>
        </ul>
      )}
      <div className="row tight">
        <button className="btn small" disabled={busy} onClick={() => void fetchFromWatch()}>
          Fetch from watch
        </button>
        <button className="btn small" disabled={busy} onClick={() => void exportAll()}>
          Export diagnostics
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {view && view.events.length > 0 && (
        <details>
          <summary>Latest {view.events.length} events</summary>
          <ol className="tiny" style={{ paddingLeft: 18 }}>
            {view.events.map((event) => (
              <li key={`${event.device}:${event.id}`}>
                {new Date(event.at).toLocaleTimeString()} · {event.device} · {event.type}
                {Object.keys(event.data).length > 0 && (
                  <span className="muted"> {JSON.stringify(event.data).slice(0, 160)}</span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
