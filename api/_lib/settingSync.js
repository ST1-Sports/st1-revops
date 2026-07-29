/**
 * Safe read-modify-write for a Setting row under concurrent writers.
 *
 * A plain findUnique-then-upsert (the shape api/state.js and the first cut
 * of api/intel.js both used) is a textbook lost-update race: two requests
 * that read the same row before either writes will have the second write
 * silently discard the first's changes. Real exposure here is multi-tab/
 * multi-device use, which this app is explicitly designed for.
 *
 * Uses updatedAt as an optimistic-concurrency token: the write only commits
 * if the row's updatedAt still matches what was just read; otherwise another
 * writer won the race and the whole read-modify-write cycle retries against
 * the fresh value.
 */
import { prisma } from './prisma.js';

export async function updateSettingSafely(key, mutate, { maxRetries = 5 } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    const nextValue = await mutate(existing?.value);

    if (!existing) {
      try {
        await prisma.setting.create({ data: { key, value: nextValue } });
        return nextValue;
      } catch (e) {
        if (e.code === 'P2002') continue; // someone else created it first — retry against their row
        throw e;
      }
    }

    const result = await prisma.setting.updateMany({
      where: { key, updatedAt: existing.updatedAt },
      data:  { value: nextValue },
    });
    if (result.count === 1) return nextValue;
    // else updatedAt no longer matches — another writer won this round, retry
  }
  throw new Error(`updateSettingSafely: too much contention on Setting "${key}"`);
}
