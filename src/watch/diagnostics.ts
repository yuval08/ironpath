import { format } from 'date-fns';
import { version as appVersion } from '../../package.json';
import { triggerDownload } from '@/utils/excelExport';
import { WatchLink, watchCompat, watchLinkSupported } from '@/utils/watchLink';
import type { DiagnosticsSummary, WatchCompat } from '@/utils/watchLink';
import { WATCH_PROTOCOLS } from './protocol';
import type { DiagnosticEvent } from './protocol';

export interface DiagnosticsView {
  events: DiagnosticEvent[];
  summary: DiagnosticsSummary;
}

const EMPTY: DiagnosticsView = {
  events: [],
  summary: {
    phone: { count: 0, oldestAt: null },
    watch: { count: 0, oldestAt: null, lastRetrievedAt: null },
  },
};

/** Newest first, bounded natively to 500 per device and 14 days. */
export async function loadDiagnostics(limit = 500): Promise<DiagnosticsView> {
  if (!watchLinkSupported()) return EMPTY;
  return WatchLink.diagnostics({ limit: Math.min(1000, Math.max(1, limit)) });
}

/** Never throws: diagnostics must not break the workflow they describe. */
export async function recordJsDiagnostic(
  type: `js.${string}`,
  fields: { sessionId?: string; timerId?: string; data?: object } = {},
): Promise<void> {
  if (!watchLinkSupported()) return;
  try {
    await WatchLink.recordDiagnostic({ type, ...fields });
  } catch {
    /* Older native builds have no diagnostics store. */
  }
}

export interface DiagnosticsExport {
  format: 'ironpath-diagnostics';
  version: 1;
  exportedAt: string;
  phone: { versionName: string; versionCode: number | null; protocols: number[] };
  watch: {
    versionName: string | null;
    versionCode: number | null;
    lastRetrievedAt: number | null;
  } | null;
  compat: WatchCompat | null;
  events: DiagnosticEvent[];
}

export async function buildDiagnosticsExport(now = new Date()): Promise<DiagnosticsExport> {
  const [view, compat] = await Promise.all([loadDiagnostics(1000), watchCompat()]);
  let versionCode: number | null = null;
  try {
    const { App } = await import('@capacitor/app');
    versionCode = Number((await App.getInfo()).build) || null;
  } catch {
    /* Browser builds have no native version code. */
  }
  return {
    format: 'ironpath-diagnostics',
    version: 1,
    exportedAt: now.toISOString(),
    phone: { versionName: appVersion, versionCode, protocols: [...WATCH_PROTOCOLS] },
    watch: compat?.peer
      ? {
          versionName: compat.peer.versionName,
          versionCode: compat.peer.versionCode,
          lastRetrievedAt: view.summary.watch.lastRetrievedAt,
        }
      : null,
    compat,
    events: view.events,
  };
}

/** Hands the export to the existing share flow; nothing is uploaded. */
export async function exportDiagnostics(now = new Date()): Promise<string> {
  const body = await buildDiagnosticsExport(now);
  const name = `ironpath-diagnostics-${format(now, 'yyyy-MM-dd')}.json`;
  await triggerDownload(
    new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
    name,
  );
  return name;
}
