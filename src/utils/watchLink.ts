import { Capacitor, registerPlugin } from '@capacitor/core';

export interface WatchLinkReport {
  protocolVersion: number;
  peers: { id: string; name: string }[];
  receipts: { peer: string; id: string; type: 'ping' | 'pong'; receivedAt: number }[];
}

export const WatchLink = registerPlugin<{
  inspect(): Promise<WatchLinkReport>;
  ping(): Promise<{ id: string }>;
  publishWorkout(options: { packet: import('@/watch/protocol').WorkPacket }): Promise<void>;
  controlWorkout(options: { packet: import('@/watch/protocol').WorkPacket }): Promise<void>;
  inspectWorkout(): Promise<WatchWorkReport>;
  flushWorkout(): Promise<void>;
  completeWorkoutCommand(options: {
    peer: string;
    packet: import('@/watch/protocol').WorkPacket;
  }): Promise<void>;
}>('WatchLink');

export interface WatchWorkReport {
  published?: import('@/watch/protocol').WorkPacket | null;
  controlConfirmation?: {
    id: string;
    body: {
      state: 'received' | 'rejected';
      reason: string;
      deviceId?: string;
      sequence?: number;
      restRemainingMs?: number;
    };
  } | null;
  snapshot: import('@/watch/protocol').WatchSnapshot | null;
  confirmation: { id: string; body: { state: 'received' | 'rejected'; reason: string } } | null;
  inbox: { peer: string; packet: import('@/watch/protocol').WorkPacket }[];
  pending: { peer: string; packet: import('@/watch/protocol').WorkPacket }[];
  results: { peer: string; packet: import('@/watch/protocol').WorkPacket }[];
}

export function watchLinkSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('WatchLink');
}
