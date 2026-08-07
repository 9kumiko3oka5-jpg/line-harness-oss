import { describe, it, expect, vi } from 'vitest';
import {
  savePendingRefAttribution,
  consumePendingRefAttribution,
  deleteExpiredPendingRefAttributions,
} from '../src/pending-ref-attribution.js';

function mockDb(overrides: {
  first?: unknown;
  runResult?: { meta?: { changes?: number } };
} = {}) {
  const bindMock = vi.fn();
  const runMock = vi.fn().mockResolvedValue(overrides.runResult ?? {});
  const firstMock = vi.fn().mockResolvedValue(overrides.first ?? null);
  const stmt = { bind: bindMock, run: runMock, first: firstMock };
  bindMock.mockReturnValue(stmt);
  const prepareMock = vi.fn().mockReturnValue(stmt);
  const db = { prepare: prepareMock } as unknown as D1Database;
  return { db, prepareMock, bindMock, runMock, firstMock };
}

describe('savePendingRefAttribution', () => {
  it('INSERT OR IGNORE で line_user_id / ref_code / created_at を保存する', async () => {
    const { db, prepareMock, bindMock } = mockDb();

    await savePendingRefAttribution(db, { lineUserId: 'U-abc', refCode: 'osaka-yuka-form' });

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO pending_ref_attribution'));
    expect(bindMock).toHaveBeenCalledWith(expect.any(String), 'U-abc', 'osaka-yuka-form', expect.any(String));
  });
});

describe('consumePendingRefAttribution', () => {
  it('該当行がなければ null を返す', async () => {
    const { db } = mockDb({ first: null });
    const result = await consumePendingRefAttribution(db, 'U-abc');
    expect(result).toBeNull();
  });

  it('該当行があり24時間以内なら refCode を返し、行を削除する', async () => {
    const { db, prepareMock, bindMock } = mockDb({
      first: {
        id: 'row-1',
        line_user_id: 'U-abc',
        ref_code: 'osaka-yuka-form',
        created_at: new Date().toISOString(),
      },
    });

    const result = await consumePendingRefAttribution(db, 'U-abc');

    expect(result).toEqual({ refCode: 'osaka-yuka-form' });
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM pending_ref_attribution WHERE id = ?'));
    expect(bindMock).toHaveBeenCalledWith('row-1');
  });

  it('該当行が24時間より古ければ null を返す (行は削除される)', async () => {
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { db, prepareMock } = mockDb({
      first: {
        id: 'row-2',
        line_user_id: 'U-abc',
        ref_code: 'osaka-yuka-form',
        created_at: oldTimestamp,
      },
    });

    const result = await consumePendingRefAttribution(db, 'U-abc');

    expect(result).toBeNull();
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM pending_ref_attribution WHERE id = ?'));
  });
});

describe('deleteExpiredPendingRefAttributions', () => {
  it('cutoffより古い行を削除し、削除件数を返す', async () => {
    const { db, prepareMock, bindMock } = mockDb({ runResult: { meta: { changes: 3 } } });

    const deleted = await deleteExpiredPendingRefAttributions(db);

    expect(deleted).toBe(3);
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM pending_ref_attribution WHERE created_at < ?'));
    expect(bindMock).toHaveBeenCalledWith(expect.any(String));
  });

  it('meta.changes が無ければ 0 を返す', async () => {
    const { db } = mockDb({ runResult: {} });
    const deleted = await deleteExpiredPendingRefAttributions(db);
    expect(deleted).toBe(0);
  });
});
