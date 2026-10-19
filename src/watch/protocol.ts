import { z } from 'zod';

export const WATCH_PROTOCOL_VERSION = 1;
export const WATCH_MAX_BYTES = 96 * 1024;
const id = z.string().min(1).max(512);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metric = z.number().finite().min(0).max(100_000).nullable();
export const watchSetStateSchema = z
  .object({
    completed: z.boolean(),
    reps: metric,
    repsLeft: metric,
    repsRight: metric,
    weight: metric,
    rpe: z.number().finite().min(0).max(10).nullable(),
    rir: z.number().finite().min(0).max(100).nullable(),
  })
  .strict();
export type WatchSetState = z.infer<typeof watchSetStateSchema>;
export const watchCommandSchema = z
  .object({
    protocolVersion: z.literal(WATCH_PROTOCOL_VERSION),
    epoch: z.string().uuid(),
    sessionId: id,
    deviceId: z.string().uuid(),
    sequence: count.refine((value) => value > 0),
    baseRevision: count,
    action: z.literal('set'),
    prescriptionId: id,
    setId: id,
    exerciseId: id,
    expected: watchSetStateSchema,
    changes: watchSetStateSchema
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();
export type WatchCommand = z.infer<typeof watchCommandSchema>;
export const watchResultSchema = z
  .object({
    commandId: z.string().uuid(),
    epoch: z.string(),
    sessionId: z.string(),
    state: z.enum(['committed', 'rejected', 'conflict', 'deferred']),
    revision: count,
    reason: z.string().max(512),
  })
  .strict();
export type WatchResult = z.infer<typeof watchResultSchema>;
export const watchSnapshotSchema = z
  .object({
    protocolVersion: z.literal(WATCH_PROTOCOL_VERSION),
    epoch: z.string().uuid(),
    sessionId: id,
    revision: count,
    title: z.string().max(256),
    status: z.literal('inProgress'),
    elapsedSeconds: z.number().finite().nonnegative(),
    controlRevision: count.optional(),
    vibrate: z.boolean().optional(),
    sequences: z
      .record(z.string().uuid(), count)
      .refine((value) => Object.keys(value).length <= 32)
      .optional(),
    steps: z
      .array(
        z
          .object({
            setId: id,
            prescriptionId: id,
            exerciseId: id,
            name: z.string().max(256),
            setNumber: z.number().int().positive(),
            workingNumber: count,
            workingTotal: count,
            isWarmUp: z.boolean(),
            entryStyle: z.string().max(40),
            loadType: z.string().max(40),
            unit: z.enum(['kg', 'lb']),
            target: z.string().max(256),
            recommendedWeight: metric,
            band: z.string().max(40).nullable(),
            restAfter: z.number().int().min(0).max(86_400),
            supported: z.boolean(),
            actual: watchSetStateSchema,
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export type WatchSnapshot = z.infer<typeof watchSnapshotSchema>;

export interface WorkPacket {
  version: 1;
  id: string;
  type: 'snapshot' | 'command' | 'result' | 'control';
  body: unknown;
}

export function packet(
  type: WorkPacket['type'],
  body: unknown,
  id: string = crypto.randomUUID(),
): WorkPacket {
  const value: WorkPacket = { version: 1, id, type, body };
  if (new TextEncoder().encode(JSON.stringify(value)).length > WATCH_MAX_BYTES) {
    throw new Error('This workout is too large to send to the watch.');
  }
  return value;
}

/** Stable content comparison, independent of object property order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
