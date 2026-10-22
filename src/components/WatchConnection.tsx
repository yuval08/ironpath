import { useEffect, useRef, useState } from 'react';
import { WatchLink, watchLinkSupported } from '@/utils/watchLink';
import type { WatchCompat } from '@/utils/watchLink';

const REASONS: Record<WatchCompat['reason'], string> = {
  ok: 'Logging from both screens is available.',
  noWatch: 'No watch with Ironpath is connected.',
  multipleWatches: 'More than one watch has Ironpath installed. Keep it on one watch.',
  watchUpdateRequired: 'Update the watch app to 0.5.0 to log from both screens.',
  helloPending: 'Waiting for the watch app to report its version.',
};

/** Compatibility line: versions, protocols and whether shared logging is on. */
export function compatSummary(compat: WatchCompat): string {
  const phone = `Phone protocols ${compat.phoneProtocols.join(', ')}`;
  const peer = compat.peer
    ? `${compat.peer.name}${compat.peer.versionName ? ` ${compat.peer.versionName}` : ''}${
        compat.peer.protocols ? ` (protocols ${compat.peer.protocols.join(', ')})` : ''
      }${compat.peer.reachable ? '' : ', not reachable'}`
    : 'no watch';
  return `${phone} · ${peer}. ${REASONS[compat.reason]}`;
}

/** Connection test and compatibility; no workout data or control ownership changes. */
export function WatchConnection() {
  const [status, setStatus] = useState(
    'Install Ironpath on your paired watch to test the connection.',
  );
  const [busy, setBusy] = useState(false);
  const [compat, setCompat] = useState<WatchCompat | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    // Older native builds have no compat bridge; they simply show no summary.
    if (watchLinkSupported())
      void Promise.resolve()
        .then(() => WatchLink.compat())
        .then((value) => {
          if (mounted.current) setCompat(value);
        })
        .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!watchLinkSupported()) return null;

  const test = async () => {
    setBusy(true);
    setStatus('Contacting watch…');
    try {
      const { id } = await WatchLink.ping();
      for (let attempt = 0; attempt < 10 && mounted.current; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        if (!mounted.current) return;
        const report = await WatchLink.inspect();
        if (!mounted.current) return;
        if (report.receipts.some((receipt) => receipt.id === id && receipt.type === 'pong')) {
          setStatus('Watch replied. Connection verified.');
          return;
        }
      }
      if (mounted.current) setStatus('No reply yet. Open the watch app, check pairing, and retry.');
    } catch {
      if (mounted.current)
        setStatus(
          'Connection test failed. Check that both apps are installed and the watch is paired.',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Galaxy Watch</h3>
      <p role="status">{status}</p>
      <button className="btn" disabled={busy} onClick={() => void test()}>
        {busy ? 'Testing…' : 'Test watch connection'}
      </button>
      {compat && <p className="muted tiny">{compatSummary(compat)}</p>}
    </section>
  );
}
