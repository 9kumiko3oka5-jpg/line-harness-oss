import { jstNow } from './utils.js';

export interface PendingRefAttribution {
  id: string;
  line_user_id: string;
  ref_code: string;
  created_at: string;
}

const PENDING_REF_ATTRIBUTION_MAX_AGE_HOURS = 24;

/**
 * ref を LINE userId に紐づけて一時保存する。/api/liff/link が friend
 * レコード作成前に ref 付きで呼ばれた場合の取りこぼし対策。
 * first-touch wins — UNIQUE(line_user_id) への INSERT OR IGNORE なので、
 * follow 前に複数回リンクを踏んでも最初の ref だけが残る。
 */
export async function savePendingRefAttribution(
  db: D1Database,
  input: { lineUserId: string; refCode: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO pending_ref_attribution (id, line_user_id, ref_code, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), input.lineUserId, input.refCode, jstNow())
    .run();
}

/**
 * 保留中の ref を取り出して削除する (読み取り即消費)。24時間より古い行は
 * 期限切れとして扱い null を返す (行自体はどちらのケースも削除する)。
 */
export async function consumePendingRefAttribution(
  db: D1Database,
  lineUserId: string,
): Promise<{ refCode: string } | null> {
  const row = await db
    .prepare(`SELECT * FROM pending_ref_attribution WHERE line_user_id = ?`)
    .bind(lineUserId)
    .first<PendingRefAttribution>();
  if (!row) return null;

  await db
    .prepare(`DELETE FROM pending_ref_attribution WHERE id = ?`)
    .bind(row.id)
    .run();

  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > PENDING_REF_ATTRIBUTION_MAX_AGE_HOURS * 60 * 60 * 1000) {
    return null;
  }
  return { refCode: row.ref_code };
}

/**
 * 誰にも回収されなかった保留行 (24時間以内に follow が来なかった=結局
 * 友だち追加しなかった人) を掃除する。6時間ごとのcronから呼ぶ想定。
 */
export async function deleteExpiredPendingRefAttributions(
  db: D1Database,
  maxAgeHours = PENDING_REF_ATTRIBUTION_MAX_AGE_HOURS,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000 + 9 * 60 * 60_000)
    .toISOString()
    .slice(0, -1) + '+09:00';
  const result = await db
    .prepare(`DELETE FROM pending_ref_attribution WHERE created_at < ?`)
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
