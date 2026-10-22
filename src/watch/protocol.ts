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
  version: 1 | 2;
  id: string;
  type:
    | 'snapshot'
    | 'command'
    | 'result'
    | 'control'
    | 'hello'
    | 'mutation'
    | 'ack'
    | 'status'
    | 'diagRequest'
    | 'diagChunk';
  body: unknown;
}

export function packet(
  type: WorkPacket['type'],
  body: unknown,
  id: string = crypto.randomUUID(),
  version: WorkPacket['version'] = 1,
): WorkPacket {
  const value: WorkPacket = { version, id, type, body };
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

/* ------------------------------------------------------------------ */
/* Protocol v2 (plan/galaxy-watch-sync-v2-design.md §1)                */
/* ------------------------------------------------------------------ */

export const WATCH_PROTOCOL_V2 = 2;
export const WATCH_PROTOCOLS = [1, 2] as const;
export const WATCH_MAX_MUTATION_BYTES = 8 * 1024;
export const WATCH_MAX_REST_BYTES = 4 * 1024;
export const WATCH_SET_FIELDS = [
  'completed',
  'reps',
  'repsLeft',
  'repsRight',
  'weight',
  'rpe',
  'rir',
] as const;
export type WatchSetField = (typeof WATCH_SET_FIELDS)[number];
export const RESULT_CODES = [
  'ok',
  'noop',
  'fieldConflict',
  'setMissing',
  'exerciseChanged',
  'exerciseSkipped',
  'unsupportedStyle',
  'sessionClosed',
  'epochMismatch',
  'sequenceReused',
  'idReused',
  'invalid',
  'reviewMissing',
  'pending',
  'closed',
  'frozen',
  'stale',
] as const;
export type ResultCode = (typeof RESULT_CODES)[number];
export const MUTATION_OPS = ['complete', 'edit', 'undo', 'resolve'] as const;

const uuid = z.string().uuid();
const label = z.object({ title: z.string().max(120), text: z.string().max(200) }).strict();
const fieldValue = z.union([z.boolean(), metric]);
/** Every field the op changed; `conflict` marks the ones that raced. */
const reviewField = z
  .object({
    field: z.enum(WATCH_SET_FIELDS),
    phone: fieldValue,
    requested: fieldValue,
    conflict: z.boolean(),
  })
  .strict();
const sparseState = watchSetStateSchema.partial().strict();

export const helloSchema = z
  .object({
    role: z.enum(['phone', 'watch']),
    protocols: z.array(z.number().int().min(1).max(99)).min(1).max(8),
    versionName: z.string().min(1).max(20),
    versionCode: z.number().int().positive(),
    installId: uuid,
    reply: z.boolean(),
    features: z.array(z.enum(['mutations2', 'rest2', 'diag1', 'resolve1'])).max(8),
  })
  .strict();
export type Hello = z.infer<typeof helloSchema>;

export const watchStepV2Schema = watchSnapshotSchema.shape.steps.element
  .extend({
    slot: z.string().max(8).nullable(),
    group: z.number().int().min(0).max(400),
    bandLabel: z.string().max(40).nullable(),
    review: z.boolean(),
  })
  .strict();
export type WatchStepV2 = z.infer<typeof watchStepV2Schema>;

export const watchSnapshotV2Schema = z
  .object({
    protocolVersion: z.literal(2),
    epoch: uuid,
    sessionId: id,
    revision: count,
    controlRevision: count,
    title: z.string().max(256),
    status: z.literal('inProgress'),
    elapsedSeconds: z.number().finite().nonnegative(),
    elapsedRunning: z.boolean(),
    capturedAtWall: count,
    vibrate: z.boolean(),
    sequences: z.record(uuid, count).refine((v) => Object.keys(v).length <= 32),
    freeze: z
      .object({ id: uuid, reason: z.enum(['finish', 'switch']) })
      .strict()
      .nullable(),
    reviews: z
      .array(
        z
          .object({
            id: uuid,
            setId: id,
            origin: z.enum(['watch', 'phone']),
            code: z.enum(RESULT_CODES),
            reason: z.string().max(512),
            fields: z.array(reviewField).max(7),
          })
          .strict(),
      )
      .max(50),
    phone: z
      .object({ versionName: z.string().max(20), versionCode: z.number().int().positive() })
      .strict(),
    steps: z.array(watchStepV2Schema).max(400),
  })
  .strict();
export type WatchSnapshotV2 = z.infer<typeof watchSnapshotV2Schema>;

type MutationShape = {
  op: (typeof MUTATION_OPS)[number];
  expected: Record<string, unknown>;
  changes: Record<string, unknown>;
  undoOf: string | null;
  resolves: string | null;
  keep: 'phone' | 'watch' | null;
};

/** Mirrored by MutationRules.validateShape in Java. */
export function mutationShapeRules(value: MutationShape, ctx: z.RefinementCtx): void {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const changeKeys = Object.keys(value.changes).sort();
  const expectedKeys = Object.keys(value.expected).sort();
  if (changeKeys.join() !== expectedKeys.join()) fail('expected and changes keys differ');
  const empty = changeKeys.length === 0;
  const resolvePhone = value.op === 'resolve' && value.keep === 'phone';
  if (resolvePhone ? !empty : empty) fail(resolvePhone ? 'keep phone carries no changes' : 'empty');
  if ((value.op === 'undo') !== (value.undoOf != null)) fail('undoOf is only for undo');
  if ((value.op === 'resolve') !== (value.resolves != null)) fail('resolves is only for resolve');
  if ((value.op === 'resolve') !== (value.keep != null)) fail('keep is only for resolve');
  if (
    value.op === 'complete' &&
    (value.changes.completed !== true || value.expected.completed !== false)
  )
    fail('complete must change completed from false to true');
  if (value.op === 'edit' && 'completed' in value.changes) fail('edit cannot change completed');
}

export const watchMutationV2Schema = z
  .object({
    protocolVersion: z.literal(2),
    opId: uuid,
    epoch: uuid,
    sessionId: id,
    deviceId: uuid,
    sequence: count.refine((v) => v > 0),
    baseRevision: count,
    controlRevision: count,
    op: z.enum(MUTATION_OPS),
    target: z.object({ prescriptionId: id, exerciseId: id, setId: id }).strict(),
    expected: sparseState,
    changes: sparseState,
    undoOf: uuid.nullable(),
    resolves: uuid.nullable(),
    keep: z.enum(['phone', 'watch']).nullable(),
    createdAtWall: count,
  })
  .strict()
  .superRefine(mutationShapeRules);
export type WatchMutationV2 = z.infer<typeof watchMutationV2Schema>;

export const watchResultV2Schema = z
  .object({
    opId: uuid,
    epoch: z.string().max(36),
    sessionId: z.string().max(512),
    state: z.enum(['committed', 'rejected', 'conflict']),
    code: z.enum(RESULT_CODES),
    revision: count,
    reason: z.string().max(512),
    review: z.boolean(),
    fields: z.array(reviewField).max(7),
  })
  .strict();
export type WatchResultV2 = z.infer<typeof watchResultV2Schema>;
export type ReviewFieldValue = z.infer<typeof reviewField>;

export const ackV2Schema = z
  .object({
    type: z.enum(['snapshot', 'mutation', 'result', 'control', 'status']),
    state: z.enum(['received', 'rejected']),
    code: z.enum(RESULT_CODES),
    reason: z.string().max(512),
    deviceId: uuid.optional(),
    sequence: count.optional(),
    freezeId: uuid.nullable().optional(),
  })
  .strict();

export const controlV2Schema = z
  .object({
    epoch: uuid,
    sessionId: id,
    controlRevision: count,
    action: z.enum(['freeze', 'unfreeze', 'closed']),
    freezeId: uuid.nullable(),
    reason: z.enum(['finish', 'switch', 'completed', 'removed', 'restored']),
  })
  .strict();
export type ControlV2 = z.infer<typeof controlV2Schema>;

export const watchStatusSchema = z
  .object({
    epoch: uuid.nullable(),
    sessionId: id.nullable(),
    pendingMutations: count,
    receivedMutations: count,
    pendingRestOps: count,
    reviewCount: count,
    lastSequence: count,
    diagnosticsLastSeq: count,
    measuredAtWall: count,
  })
  .strict();
export type WatchStatus = z.infer<typeof watchStatusSchema>;

export const DIAGNOSTIC_TYPES = [
  'app.start',
  'perm.snapshot',
  'sync.peer',
  'sync.hello',
  'sync.snapshot',
  'sync.mutation',
  'sync.review',
  'sync.queueFull',
  'sync.storageFailure',
  'sync.freeze',
  'sync.unfreeze',
  'sync.closed',
  'sync.migration',
  'rest.op',
  'rest.scheduled',
  'rest.armed',
  'rest.callback',
  'rest.delivered',
  'rest.suppressed',
  'rest.fallback',
  'rest.recovered',
  'rest.failure',
  'rest.feedback',
  'diag.request',
  'diag.import',
] as const;

export const diagnosticEventSchema = z
  .object({
    id: uuid,
    seq: count,
    device: z.enum(['phone', 'watch']),
    type: z.string().max(40),
    at: count,
    elapsed: count,
    boot: z.number().int().nonnegative(),
    sessionId: z.string().max(512).nullable(),
    timerId: uuid.nullable(),
    revision: count.nullable(),
    opId: uuid.nullable(),
    data: z.record(z.unknown()),
  })
  .strict();
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;

export const diagRequestSchema = z
  .object({ afterSeq: count, max: z.number().int().min(1).max(150) })
  .strict();
export const diagChunkSchema = z
  .object({ events: z.array(diagnosticEventSchema).max(150), lastSeq: count, more: z.boolean() })
  .strict();

export const restOpSchema = z
  .object({
    protocolVersion: z.literal(2),
    opId: uuid,
    deviceId: uuid,
    restSequence: count.refine((v) => v > 0),
    epoch: uuid,
    sessionId: id,
    op: z.enum(['start', 'adjust', 'skip', 'cancel']),
    timerId: uuid,
    baseRevision: count.nullable(),
    durationMs: z.number().int().min(1000).max(86_400_000).nullable(),
    deltaMs: z
      .number()
      .int()
      .min(-3_600_000)
      .max(3_600_000)
      .refine((v) => v !== 0)
      .nullable(),
    sourceOp: uuid.nullable(),
    reason: z.enum(['user', 'undo', 'zeroRest', 'closed']),
    next: label.nullable(),
    clock: z.object({ ageMs: count, uncertain: z.boolean() }).strict(),
  })
  .strict();

export const restTimerWireSchema = z
  .object({
    timerId: uuid,
    state: z.enum(['running', 'ended', 'skipped', 'cancelled', 'replaced']),
    startedAgoMs: count,
    remainingMs: count,
    durationMs: z.number().int().min(0).max(86_400_000),
    origin: z.enum(['phone', 'watch']),
    originDevice: uuid,
    sourceOp: uuid.nullable(),
    next: label.nullable(),
    alert: z
      .object({
        preferred: z.enum(['watch', 'phone']),
        watchArmedRevision: count.nullable(),
        phoneBackup: z.enum(['scheduled', 'suppressed', 'off', 'delivered']),
      })
      .strict(),
  })
  .strict();

export const restStateSchema = z
  .object({
    protocolVersion: z.literal(2),
    epoch: uuid,
    sessionId: id.nullable(),
    revision: count,
    watermarks: z.record(uuid, count).refine((v) => Object.keys(v).length <= 8),
    timer: restTimerWireSchema.nullable(),
    outcomes: z
      .array(
        z
          .object({
            opId: uuid,
            outcome: z.enum(['applied', 'stale', 'superseded', 'expired', 'rejected']),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export const restArmedSchema = z
  .object({
    deviceId: uuid,
    timerId: uuid,
    revision: count,
    armed: z.boolean(),
    reason: z.enum([
      'ok',
      'notificationsOff',
      'channelOff',
      'exactDenied',
      'serviceFailed',
      'pendingOps',
    ]),
    exact: z.boolean(),
  })
  .strict();
