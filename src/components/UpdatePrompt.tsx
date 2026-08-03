import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

/** Shows a prompt when a new service-worker build is waiting, and an offline-ready toast. */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Re-check for a new build every hour while the app stays open. The catch
      // matters: with no signal in a gym this would otherwise be an unhandled
      // rejection every hour.
      if (registration) {
        window.setInterval(
          () => {
            registration.update().catch(() => undefined);
          },
          60 * 60 * 1000,
        );
      }
    },
  });

  // The offline-ready toast is fixed-position with no auto-dismiss; on a short
  // screen it sat on top of the primary button and ate the user's first tap.
  useEffect(() => {
    if (!offlineReady) return undefined;
    const id = window.setTimeout(() => setOfflineReady(false), 4000);
    return () => window.clearTimeout(id);
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh && !offlineReady) return null;

  /**
   * On the very first app session no service worker controls the page, so a new
   * worker activates immediately and workbox's `controlling` event — the only
   * thing that triggers the reload — never fires. Without the fallback the
   * Update button is a silent no-op while the old JS keeps running.
   */
  const applyUpdate = async () => {
    await updateServiceWorker(true);
    if (typeof navigator !== 'undefined' && !navigator.serviceWorker?.controller) {
      window.location.reload();
    }
  };

  if (needRefresh) {
    return (
      // Sits one bar above the workout sticky bar so the two never overlap.
      <div
        className="sticky-bar"
        style={{
          bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 58px)',
          zIndex: 40,
        }}
      >
        <RefreshCw size={18} />
        <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600 }}>
          A new version is ready
        </span>
        <button className="btn primary small" onClick={() => void applyUpdate()}>
          Update
        </button>
        <button
          className="btn ghost small icon"
          aria-label="Dismiss"
          onClick={() => setNeedRefresh(false)}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="toast" role="status" onClick={() => setOfflineReady(false)}>
      Ready to work offline
    </div>
  );
}
