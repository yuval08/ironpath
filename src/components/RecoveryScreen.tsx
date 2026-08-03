import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { downloadBackup } from '@/utils/backup';

/**
 * Whatever went wrong, the first thing offered is a way to get the data OUT.
 * Logged workouts live only on this device, so a crash must never be a dead end.
 */
export function RecoveryScreen({ error, title }: { error: Error; title: string }) {
  return (
    <div className="card">
      <div className="row tight" style={{ marginBottom: 8 }}>
        <AlertTriangle size={18} />
        <h2>{title}</h2>
      </div>
      <p className="muted tiny">
        Your logged workouts are still stored on this device. Save a backup first, then try
        reloading.
      </p>
      <pre
        className="muted tiny"
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'var(--surface-2)',
          padding: 10,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {error.message || String(error)}
      </pre>
      <div className="stack" style={{ marginTop: 12 }}>
        <button className="btn primary block" onClick={() => void downloadBackup()}>
          <Download size={17} /> Export all data as JSON
        </button>
        <button className="btn block" onClick={() => window.location.reload()}>
          Reload the app
        </button>
      </div>
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Catches render-time throws. Without one, a single bad record or an unexpected
 * undefined would blank the screen mid-session with no way back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="app">
          <header className="app-header">
            <h1>Something went wrong</h1>
          </header>
          <main className="app-main">
            <RecoveryScreen error={this.state.error} title="The app hit an unexpected error" />
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}
