import { db } from '@/db/db';
import { commitSessionPatch } from '@/db/repository';
import type { WatchCommand, WatchMutationV2, WatchResult, WatchResultV2 } from './protocol';
import { allReviewFields, getReview, openReviews, resolveReviewRecord } from './reviews';
import type { ReviewRecord } from './reviews';

export interface WatchRecoveryAction {
  kind: 'legacy';
  id: string;
  command: WatchCommand;
  result: WatchResult;
  reviewed?: boolean;
}
/** A v2 mutation refused before any review could be recorded (restored or reset phone). */
export interface WatchRecoveryEvidence {
  kind: 'evidence';
  id: string;
  command: WatchMutationV2;
  result: WatchResultV2;
}
export interface WatchReviewItem {
  kind: 'review';
  id: string;
  review: ReviewRecord;
}
export type ReviewItem = WatchRecoveryAction | WatchRecoveryEvidence | WatchReviewItem;

/**
 * Everything that needs the user's attention: v1 ledger/recovery rows kept after final
 * rejection (including across backup restore) and unresolved v2 reviews.
 */
export async function watchRecoveryActions(sessionId?: string): Promise<ReviewItem[]> {
  const rows = (
    await Promise.all(
      ['watch:command:', 'watch:recovery:'].map((prefix) =>
        db.meta.where('key').startsWith(prefix).toArray(),
      ),
    )
  ).flat();
  const evidence = rows.flatMap((row): ReviewItem[] => {
    const saved = row.value as {
      command?: WatchCommand | WatchMutationV2;
      fingerprint?: string;
      result?: WatchResult | WatchResultV2;
      reviewed?: boolean;
    };
    if (
      !saved.result ||
      !['rejected', 'conflict'].includes(saved.result.state) ||
      saved.reviewed ||
      (sessionId && saved.result.sessionId !== sessionId)
    )
      return [];
    // Phase-two ledgers retained the full canonical JSON as their fingerprint.
    let command = saved.command;
    if (!command && saved.fingerprint) {
      try {
        command = JSON.parse(saved.fingerprint) as WatchCommand;
      } catch {
        /* Keep malformed evidence stored. */
      }
    }
    if (!command) return [];
    if (command.protocolVersion !== 2)
      return [{ kind: 'legacy', id: row.key, command, result: saved.result as WatchResult }];
    // v2 ledger refusals are listed through their review record instead.
    return row.key.startsWith('watch:recovery:')
      ? [{ kind: 'evidence', id: row.key, command, result: saved.result as WatchResultV2 }]
      : [];
  });
  const reviews = (await openReviews(sessionId)).map((review): ReviewItem => ({
    kind: 'review',
    id: review.id,
    review,
  }));
  return [...evidence, ...reviews];
}

/** Marks v1/evidence rows as reviewed; the original request stays stored. */
export async function reviewWatchAction(id: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const key = id;
    const row = await db.meta.get(key);
    if (!row) throw new Error('Watch action is unavailable.');
    await db.meta.put({ ...row, value: { ...(row.value as object), reviewed: true } });
  });
}

export type ResolveOutcome = 'kept' | 'applied' | 'conflict' | 'closed';

/**
 * Keep phone values, or apply the requested values as a NEW conditional patch whose
 * `expected` is what the user was shown. A conflict supersedes this review with a
 * fresh one; nothing is overwritten silently (§2.4).
 */
export async function resolveReview(
  id: string,
  keep: 'phone' | 'watch',
  shown?: Record<string, unknown>,
): Promise<ResolveOutcome> {
  return db.transaction('rw', db.sessions, db.meta, async () => {
    const review = await getReview(id);
    if (!review) throw new Error('This review is no longer available.');
    if (review.resolution) return review.resolution === 'kept' ? 'kept' : 'applied';
    if (keep === 'phone') {
      await resolveReviewRecord(id, 'kept', 'phone');
      return 'kept';
    }
    const fields = allReviewFields(review);
    if (!fields.length) throw new Error('There are no watch values to apply.');
    // Every requested field, not only the conflicting ones: a completion that merged
    // cleanly was held back by the atomic op and must be applied with the rest.
    const expected: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};
    for (const row of fields) {
      expected[row.field] = shown && row.field in shown ? shown[row.field] : row.phone;
      changes[row.field] = row.requested;
    }
    const committed = await commitSessionPatch(review.sessionId, {
      opId: crypto.randomUUID(),
      sets: [{ prescriptionId: review.prescriptionId, setId: review.setId, expected, changes }],
      exercises: [],
      session: { expected: {}, changes: {} },
      structure: [],
      elapsedSeconds: 0,
    });
    if (committed.state === 'closed') return 'closed';
    // Structure changes leave no field review to replace this one.
    if (committed.state === 'conflict' && !committed.reviewId) return 'conflict';
    await resolveReviewRecord(
      id,
      committed.state === 'committed' ? 'applied' : 'superseded',
      'phone',
    );
    return committed.state === 'committed' ? 'applied' : 'conflict';
  });
}
