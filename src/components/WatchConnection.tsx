import { useEffect, useRef, useState } from 'react';
import { WatchLink, watchLinkSupported } from '@/utils/watchLink';

/** Phase-one diagnostics; no workout data or control ownership changes. */
export function WatchConnection() {
  const [status, setStatus] = useState(
    'Install Ironpath on your paired watch to test the connection.',
  );
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
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
      <p className="muted tiny">Workout controls are coming next.</p>
    </section>
  );
}
