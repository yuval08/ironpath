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
      // Re-check for a new build every hour while the app stays open.
      if (registration) {
        window.setInterval(() => void registration.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh && !offlineReady) return null;

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
        <button className="btn primary small" onClick={() => void updateServiceWorker(true)}>
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
