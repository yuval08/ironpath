import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { DiagnosticEvent, WatchSnapshot, WatchStatus, WorkPacket } from '@/watch/protocol';

export interface WatchLinkReport {
  protocolVersion: number;
  peers: { id: string; name: string }[];
  receipts: { peer: string; id: string; type: 'ping' | 'pong'; receivedAt: number }[];
}

/** Native capability/hello negotiation result (design §6.4). */
export interface WatchCompat {
  phoneProtocols: number[];
  peer: {
    nodeId: string;
    name: string;
    reachable: boolean;
    protocols: number[] | null;
    versionName: string | null;
    versionCode: number | null;
    helloAt: number | null;
  } | null;
  sharedMode: boolean;
  reason: 'ok' | 'noWatch' | 'multipleWatches' | 'watchUpdateRequired' | 'helloPending';
}

export interface DiagnosticsSummary {
  phone: { count: number; oldestAt: number | null };
  watch: { count: number; oldestAt: number | null; lastRetrievedAt: number | null };
}

export const WatchLink = registerPlugin<{
  inspect(): Promise<WatchLinkReport>;
  ping(): Promise<{ id: string }>;
  publishWorkout(options: { packet: WorkPacket }): Promise<void>;
  controlWorkout(options: { packet: WorkPacket }): Promise<void>;
  inspectWorkout(): Promise<WatchWorkReport>;
  flushWorkout(): Promise<void>;
  completeWorkoutCommand(options: { peer: string; packet: WorkPacket }): Promise<void>;
  compat(): Promise<WatchCompat>;
  diagnostics(options: {
    limit?: number;
  }): Promise<{ events: DiagnosticEvent[]; summary: DiagnosticsSummary }>;
  recordDiagnostic(options: {
    type: `js.${string}`;
    sessionId?: string;
    timerId?: string;
    data?: object;
  }): Promise<void>;
  requestWatchDiagnostics(): Promise<{
    requested: boolean;
    reason: '' | 'noWatch' | 'legacyWatch';
  }>;
  addListener(event: 'workChanged', listener: () => void): Promise<PluginListenerHandle>;
}>('WatchLink');

export interface WatchWorkReport {
  published?: WorkPacket | null;
  controlConfirmation?: {
    id: string;
    body: {
      state: 'received' | 'rejected';
      reason: string;
      code?: string;
      deviceId?: string;
      sequence?: number;
      freezeId?: string | null;
      restRemainingMs?: number;
    };
  } | null;
  snapshot: WatchSnapshot | null;
  confirmation: {
    id: string;
    body: { state: 'received' | 'rejected'; reason: string; code?: string };
  } | null;
  inbox: { peer: string; packet: WorkPacket }[];
  pending: { peer: string; packet: WorkPacket }[];
  results: { peer: string; packet: WorkPacket }[];
  watchStatus?: WatchStatus | null;
  compat?: WatchCompat;
}

export function watchLinkSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('WatchLink');
}

/** v2 bridge methods are absent on an older native build; treat that as legacy. */
export async function watchCompat(): Promise<WatchCompat | null> {
  if (!watchLinkSupported()) return null;
  try {
    return await WatchLink.compat();
  } catch {
    return null;
  }
}
