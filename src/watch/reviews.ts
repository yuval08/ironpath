import { db, nowIso } from '@/db/db';
import type { ResultCode } from './protocol';
import { fieldOrder } from './mutations';

/** Needs-review record (design §2.4), stored in db.meta under `sync:review:<opId>`. */
export interface ReviewRecord {
  id: string;
  origin: 'watch' | 'phone';
  sessionId: string;
  setId: string;
  prescriptionId: string;
  exerciseId: string;
  code: ResultCode;
  reason: string;
  /**
   * Every field the op changed, so resolving can never drop a non-conflicting part
   * (such as a completion). `phone` is the canonical value at conflict time; the UI
   * re-reads the live value. Records from before `conflict` existed lack it.
   */
  fields: ReviewField[];
  expected: Record<string, unknown>;
  requested: Record<string, unknown>;
  createdAt: string;
  resolution: null | 'kept' | 'applied' | 'superseded';
  resolvedAt: string | null;
  resolvedBy: 'phone' | 'watch' | null;
}

export interface ReviewField {
  field: string;
  phone: unknown;
  requested: unknown;
  conflict?: boolean;
}

/** All changed fields in protocol order, flagging the conflicting ones. */
export function reviewFields(
  current: Record<string, unknown>,
  changes: Record<string, unknown>,
  conflicts: readonly string[],
): Required<ReviewField>[] {
  return Object.keys(changes)
    .sort(fieldOrder)
    .map((field) => ({
      field,
      phone: current[field] ?? null,
      requested: changes[field] ?? null,
      conflict: conflicts.includes(field),
    }));
}

/**
 * The review's fields with the flag filled in. Records written before the flag
 * listed only conflicts; their other requested fields are added as non-conflicting.
 */
export function allReviewFields(review: ReviewRecord): Required<ReviewField>[] {
  if (review.fields.every((row) => row.conflict !== undefined))
    return review.fields as Required<ReviewField>[];
  const listed = new Set(review.fields.map((row) => row.field));
  return [
    ...review.fields.map((row) => ({ ...row, conflict: true })),
    ...Object.keys(review.requested)
      .filter((field) => !listed.has(field))
      .map((field) => ({
        field,
        phone: null,
        requested: review.requested[field] ?? null,
        conflict: false,
      })),
  ].sort((a, b) => fieldOrder(a.field, b.field));
}

export const REVIEW_PREFIX = 'sync:review:';
export const reviewKey = (id: string) => `${REVIEW_PREFIX}${id}`;

export function newReview(
  fields: Omit<ReviewRecord, 'createdAt' | 'resolution' | 'resolvedAt' | 'resolvedBy'>,
): ReviewRecord {
  return { ...fields, createdAt: nowIso(), resolution: null, resolvedAt: null, resolvedBy: null };
}

/** Call inside a transaction that includes db.meta. */
export async function putReview(review: ReviewRecord): Promise<void> {
  await db.meta.put({ key: reviewKey(review.id), value: review });
}

export async function getReview(id: string): Promise<ReviewRecord | undefined> {
  return (await db.meta.get(reviewKey(id)))?.value as ReviewRecord | undefined;
}

export async function resolveReviewRecord(
  id: string,
  resolution: NonNullable<ReviewRecord['resolution']>,
  by: 'phone' | 'watch',
): Promise<void> {
  const review = await getReview(id);
  if (!review || review.resolution) return;
  await putReview({ ...review, resolution, resolvedAt: nowIso(), resolvedBy: by });
}

/** Unresolved reviews, oldest first. */
export async function openReviews(sessionId?: string): Promise<ReviewRecord[]> {
  const rows = await db.meta.where('key').startsWith(REVIEW_PREFIX).toArray();
  return rows
    .map((row) => row.value as ReviewRecord)
    .filter((review) => !review.resolution && (!sessionId || review.sessionId === sessionId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
