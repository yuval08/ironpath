import { db } from '@/db/db';
import type { WatchCommand, WatchResult } from './protocol';

export interface WatchRecoveryAction {
  id: string;
  command: WatchCommand;
  result: WatchResult;
  reviewed?: boolean;
}

/** Keep the requested values after final rejection, including across backup restore. */
export async function watchRecoveryActions(sessionId?: string): Promise<WatchRecoveryAction[]> {
  const rows = (
    await Promise.all(
      ['watch:command:', 'watch:recovery:'].map((prefix) =>
        db.meta.where('key').startsWith(prefix).toArray(),
      ),
    )
  ).flat();
  return rows.flatMap((row) => {
    const saved = row.value as {
      command?: WatchCommand;
      fingerprint?: string;
      result?: WatchResult;
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
    return command ? [{ id: row.key, command, result: saved.result }] : [];
  });
}

export async function reviewWatchAction(id: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const key = id;
    const row = await db.meta.get(key);
    if (!row) throw new Error('Watch action is unavailable.');
    await db.meta.put({ ...row, value: { ...(row.value as object), reviewed: true } });
  });
}
