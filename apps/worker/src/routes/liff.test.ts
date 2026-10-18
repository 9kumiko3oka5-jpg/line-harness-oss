import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Stub the DB graph — these tests focus on the /api/liff/link
// friend-not-found -> pending-ref-attribution path, without touching real D1.
vi.mock('@line-crm/db', () => ({
  getFriendByLineUserId: vi.fn(),
  // /api/liff/link resolves the friend per account (upstream v0.24); every
  // case here is the friend-not-found path.
  getFriendByLineUserIdForAccount: vi.fn().mockResolvedValue(null),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  savePendingRefAttribution: vi.fn().mockResolvedValue(undefined),
  // Unused by this endpoint's happy/404 paths under test, but imported by
  // liff.ts at module scope so the mock module must export them.
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  linkFriendToUser: vi.fn(),
  upsertFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  recordRefTracking: vi.fn(),
  addTagToFriend: vi.fn(),
  getLineAccountByChannelId: vi.fn(),
  getLineAccountById: vi.fn(),
  getTrafficPoolBySlug: vi.fn(),
  getTrafficPoolById: vi.fn(),
  getRandomPoolAccount: vi.fn(),
  getPoolAccounts: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  jstNow: vi.fn(),
}));

import {
  getFriendByLineUserId,
  getLineAccounts,
  savePendingRefAttribution,
} from '@line-crm/db';
import { liffRoutes } from './liff.js';

function setupApp() {
  const app = new Hono();
  app.route('/', liffRoutes);
  return app;
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_LOGIN_CHANNEL_ID: 'login-channel-default',
} as Record<string, unknown>;

function mockLineVerifyOk(sub: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sub }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLineAccounts).mockResolvedValue([]);
});

describe('POST /api/liff/link — pending ref attribution (friend not found)', () => {
  test('friend not found + ref あり → savePendingRefAttribution が呼ばれ、404を返す', async () => {
    mockLineVerifyOk('U-new');
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);

    const app = setupApp();
    const res = await app.request(
      '/api/liff/link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'id-token', ref: 'osaka-yuka-form' }),
      },
      baseEnv,
    );

    expect(res.status).toBe(404);
    expect(savePendingRefAttribution).toHaveBeenCalledWith(
      baseEnv.DB,
      { lineUserId: 'U-new', refCode: 'osaka-yuka-form' },
    );
  });

  test('friend not found + ref が xh: トークン → savePendingRefAttribution は呼ばれない', async () => {
    mockLineVerifyOk('U-new');
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);

    const app = setupApp();
    const res = await app.request(
      '/api/liff/link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'id-token', ref: 'xh:one-time-token' }),
      },
      baseEnv,
    );

    expect(res.status).toBe(404);
    expect(savePendingRefAttribution).not.toHaveBeenCalled();
  });

  test('friend not found + ref なし → savePendingRefAttribution は呼ばれない', async () => {
    mockLineVerifyOk('U-new');
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);

    const app = setupApp();
    const res = await app.request(
      '/api/liff/link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'id-token' }),
      },
      baseEnv,
    );

    expect(res.status).toBe(404);
    expect(savePendingRefAttribution).not.toHaveBeenCalled();
  });

  test('savePendingRefAttribution が失敗しても404レスポンスは正常に返る', async () => {
    mockLineVerifyOk('U-new');
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(savePendingRefAttribution).mockRejectedValue(new Error('D1 down'));

    const app = setupApp();
    const res = await app.request(
      '/api/liff/link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'id-token', ref: 'osaka-yuka-form' }),
      },
      baseEnv,
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toEqual({ success: false, error: 'Friend not found' });
  });
});
