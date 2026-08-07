import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  pushMessage: vi.fn(),
  pushTextMessage: vi.fn(),
}));

// Stub the DB graph — these tests focus on webhook guard behavior and the
// first-contact friend registration path without touching real D1/LINE.
vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendById: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getFriendById: vi.fn(),
  consumePendingRefAttribution: vi.fn().mockResolvedValue(null),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => lineClientMocks),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  expandVariables: vi.fn(),
  messageToLogPayload: vi.fn(),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  addTagToFriend,
  advanceFriendScenario,
  completeFriendScenario,
  computeNextDeliveryAt,
  consumePendingRefAttribution,
  enrollFriendInScenario,
  getEntryRouteByRefCode,
  getFriendById,
  getFriendByLineUserId,
  getLineAccounts,
  getMessageTemplateById,
  getScenarioSteps,
  getScenarios,
  jstNow,
  resolveStepContent,
  updateFriendFollowStatus,
  upsertChatOnMessage,
  upsertFriend,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { buildMessage, messageToLogPayload } from '../services/step-delivery.js';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const baseExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLineAccounts).mockResolvedValue([]);
});

describe('POST /webhook — DoS defenses (#104)', () => {
  test('rejects with 413 when Content-Length declares an oversized body', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024), // 2 MiB > 1 MiB cap
          'X-Line-Signature': 'whatever',
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    // Signature verification must not even be attempted on an oversized body.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('rejects with 413 when actual body exceeds the cap even if Content-Length is absent', async () => {
    const app = setupApp();
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'whatever',
        },
        body: oversizedBody,
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('verifies signature before parsing JSON — malformed body with invalid signature never reaches the parser', async () => {
    vi.mocked(verifySignature).mockResolvedValue(false);

    const app = setupApp();
    // 44-char signature (valid HMAC-SHA256 base64 length) so it clears the
    // length pre-check and reaches verifySignature. Malformed JSON body: if
    // signature were verified *after* parse (old behavior), we'd hit the
    // parser-failure branch first. With signature-first, we get the invalid-
    // signature branch and never attempt to parse.
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: '{not valid json',
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // verifySignature must run; rejection happens before any parse attempt.
    expect(verifySignature).toHaveBeenCalled();
    expect(verifySignature).toHaveBeenCalledWith('env-default-secret', '{not valid json', validShapedSignature);
  });

  test('rejects unsigned or malformed-signature requests without hitting verifySignature or D1', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Line-Signature header entirely.
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // Fast-rejected before any crypto / DB work.
    expect(verifySignature).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — first-contact existing friends', () => {
  test('auto-registers an unknown text-message sender without firing friend_add handling', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(jstNow).mockReturnValue('2026-06-18T12:00:00.000+09:00');
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: 'https://example.com/profile.jpg',
      status_message: 'hello',
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });
    vi.mocked(upsertChatOnMessage).mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'unread',
      notes: null,
      last_message_at: '2026-06-18T12:00:00.000+09:00',
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              message: { type: 'text', id: 'message-1', text: 'こんにちは' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    expect(lineClientMocks.getProfile).toHaveBeenCalledWith('U-existing');
    expect(upsertFriend).toHaveBeenCalledWith(db, {
      lineUserId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'message_received',
      expect.objectContaining({ friendId: 'friend-1' }),
      'env-default-token',
      null,
    );
    expect(getScenarios).not.toHaveBeenCalled();
    expect(enrollFriendInScenario).not.toHaveBeenCalled();

    // Keep the unrelated DB stubs quiet but type-checked as mocked imports.
    expect(updateFriendFollowStatus).not.toHaveBeenCalled();
    expect(getScenarioSteps).not.toHaveBeenCalled();
    expect(advanceFriendScenario).not.toHaveBeenCalled();
    expect(completeFriendScenario).not.toHaveBeenCalled();
    expect(computeNextDeliveryAt).not.toHaveBeenCalled();
    expect(resolveStepContent).not.toHaveBeenCalled();
    expect(addTagToFriend).not.toHaveBeenCalled();
    expect(getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(getMessageTemplateById).not.toHaveBeenCalled();
  });

  test('notifies the owner via pushTextMessage on incoming text message when OWNER_NOTIFY_LINE_USER_ID is set', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(jstNow).mockReturnValue('2026-06-18T12:00:00.000+09:00');
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: 'https://example.com/profile.jpg',
      status_message: 'hello',
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });
    vi.mocked(upsertChatOnMessage).mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'unread',
      notes: null,
      last_message_at: '2026-06-18T12:00:00.000+09:00',
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Line-Signature': validShapedSignature },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              message: { type: 'text', id: 'message-1', text: 'こんにちは' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db, OWNER_NOTIFY_LINE_USER_ID: 'U-owner' },
      executionCtx,
    );
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    expect(res.status).toBe(200);
    expect(lineClientMocks.pushTextMessage).toHaveBeenCalledWith(
      'U-owner',
      '【通知】Existing Friendさんからメッセージ：こんにちは',
    );
  });

  test('does not notify the owner for non-text messages (e.g. stickers)', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(jstNow).mockReturnValue('2026-06-18T12:00:00.000+09:00');
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: null,
      statusMessage: null,
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Line-Signature': validShapedSignature },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              message: { type: 'sticker', id: 'message-2', packageId: '1', stickerId: '1' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-2',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db, OWNER_NOTIFY_LINE_USER_ID: 'U-owner' },
      executionCtx,
    );
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    expect(res.status).toBe(200);
    expect(lineClientMocks.pushTextMessage).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — owner notification', () => {
  function followEventBody() {
    return JSON.stringify({
      destination: 'bot',
      events: [
        {
          type: 'follow',
          replyToken: 'reply-token',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'U-follow' },
          webhookEventId: 'event-follow-1',
          deliveryContext: { isRedelivery: false },
          mode: 'active',
        },
      ],
    });
  }

  function mockFollowFriend() {
    const friend = {
      id: 'friend-2',
      line_user_id: 'U-follow',
      display_name: 'FUSAE',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-23T17:17:57.836+09:00',
      updated_at: '2026-07-23T17:17:57.836+09:00',
      // ref_code が既に付いている friend を返すことで、webhook.ts 内の
      // ref_code 再試行ループ（getFriendById 呼び出し）を経由せずに
      // friendRefCode が即座に解決される。
      ref_code: 'osaka-yuka-form',
    } as unknown as Awaited<ReturnType<typeof upsertFriend>>;
    vi.mocked(upsertFriend).mockResolvedValue(friend);
    return friend;
  }

  function stubDb() {
    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    };
    stmt.bind.mockReturnValue(stmt);
    return { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;
  }

  function runFollowEvent(db: D1Database, env: Record<string, unknown> = baseEnv) {
    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    return app
      .request(
        '/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Line-Signature': validShapedSignature },
          body: followEventBody(),
        },
        { ...env, DB: db },
        executionCtx,
      )
      .then(async (res) => {
        const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
        await processing;
        return res;
      });
  }

  test('notifies the owner via pushTextMessage on follow when OWNER_NOTIFY_LINE_USER_ID is set', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    mockFollowFriend();
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
    vi.mocked(getScenarios).mockResolvedValue([]);
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-follow',
      displayName: 'FUSAE',
      pictureUrl: null,
      statusMessage: null,
    });

    const res = await runFollowEvent(stubDb(), { ...baseEnv, OWNER_NOTIFY_LINE_USER_ID: 'U-owner' });

    expect(res.status).toBe(200);
    expect(lineClientMocks.pushTextMessage).toHaveBeenCalledWith(
      'U-owner',
      '【通知】新しい友だちが追加されました：FUSAE（流入元：osaka-yuka-form）',
    );
  });

  test('skips owner notification on follow when OWNER_NOTIFY_LINE_USER_ID is not set', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    mockFollowFriend();
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
    vi.mocked(getScenarios).mockResolvedValue([]);
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-follow',
      displayName: 'FUSAE',
      pictureUrl: null,
      statusMessage: null,
    });

    const res = await runFollowEvent(stubDb()); // baseEnv has no OWNER_NOTIFY_LINE_USER_ID

    expect(res.status).toBe(200);
    expect(lineClientMocks.pushTextMessage).not.toHaveBeenCalled();
  });

  test('owner notification failure does not break friend registration or fireEvent', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    mockFollowFriend();
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
    vi.mocked(getScenarios).mockResolvedValue([]);
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-follow',
      displayName: 'FUSAE',
      pictureUrl: null,
      statusMessage: null,
    });
    lineClientMocks.pushTextMessage.mockRejectedValueOnce(new Error('LINE API 500'));

    const res = await runFollowEvent(stubDb(), { ...baseEnv, OWNER_NOTIFY_LINE_USER_ID: 'U-owner' });
    // runFollowEvent already awaits the waitUntil-tracked processing promise;
    // if notifyOwner didn't catch its own rejection, that await would throw here.

    expect(res.status).toBe(200);
    expect(lineClientMocks.pushTextMessage).toHaveBeenCalledWith(
      'U-owner',
      '【通知】新しい友だちが追加されました：FUSAE（流入元：osaka-yuka-form）',
    );
    expect(fireEvent).toHaveBeenCalledWith(
      expect.anything(),
      'friend_add',
      expect.objectContaining({ friendId: 'friend-2' }),
      'env-default-token',
      null,
    );
  });
});

describe('POST /webhook — follow event referral intro push', () => {
  function followEventBody() {
    return JSON.stringify({
      destination: 'bot',
      events: [
        {
          type: 'follow',
          replyToken: 'reply-token',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'U-follow' },
          webhookEventId: 'event-follow-1',
          deliveryContext: { isRedelivery: false },
          mode: 'active',
        },
      ],
    });
  }

  function mockFollowFriend() {
    const friend = {
      id: 'friend-2',
      line_user_id: 'U-follow',
      display_name: 'FUSAE',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-23T17:17:57.836+09:00',
      updated_at: '2026-07-23T17:17:57.836+09:00',
      // /auth/callback already wrote ref_code before this follow webhook ran
      // (the retry-loop race in webhook.ts is a separate concern from the
      // dedupe logic under test here).
      ref_code: 'osaka-yuka-form',
    } as unknown as Awaited<ReturnType<typeof upsertFriend>>;
    vi.mocked(upsertFriend).mockResolvedValue(friend);
    return friend;
  }

  const referralRoute = {
    id: 'route-1',
    ref_code: 'osaka-yuka-form',
    name: '大阪骨盤ネジ締め-フォーム申込後',
    tag_id: null,
    scenario_id: null,
    redirect_url: null,
    pool_id: null,
    intro_template_id: 'tmpl-1',
    run_account_friend_add_scenarios: 1,
    is_active: 1,
    created_at: '2026-01-01T00:00:00.000+09:00',
    updated_at: '2026-01-01T00:00:00.000+09:00',
  };

  const template = {
    id: 'tmpl-1',
    name: '①大阪-申込済み',
    message_type: 'text' as const,
    message_content: 'ようこそ！',
    created_at: '2026-01-01T00:00:00.000+09:00',
    updated_at: '2026-01-01T00:00:00.000+09:00',
  };

  function runFollowEvent(db: D1Database) {
    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    return app
      .request(
        '/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Line-Signature': validShapedSignature },
          body: followEventBody(),
        },
        { ...baseEnv, DB: db },
        executionCtx,
      )
      .then(async (res) => {
        const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
        await processing;
        return res;
      });
  }

  test('sends the entry_route intro push and logs it to messages_log when never sent before', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
    mockFollowFriend();
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(referralRoute);
    vi.mocked(getScenarios).mockResolvedValue([]);
    vi.mocked(getMessageTemplateById).mockResolvedValue(template);
    vi.mocked(buildMessage).mockReturnValue({ type: 'text', text: 'ようこそ！' });
    vi.mocked(messageToLogPayload).mockReturnValue({ messageType: 'text', content: 'ようこそ！' });
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-follow',
      displayName: 'FUSAE',
      pictureUrl: null,
      statusMessage: null,
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
      // No prior entry_route_intro row for this friend/template — the push
      // must proceed.
      first: vi.fn().mockResolvedValue(null),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const res = await runFollowEvent(db);

    expect(res.status).toBe(200);
    expect(lineClientMocks.pushMessage).toHaveBeenCalledWith('U-follow', [{ type: 'text', text: 'ようこそ！' }]);
    expect(stmt.run).toHaveBeenCalledTimes(1); // the messages_log INSERT
    expect(stmt.bind).toHaveBeenCalledWith(
      expect.any(String),
      'friend-2',
      'text',
      'ようこそ！',
      'tmpl-1',
      '2026-07-23T17:17:59.457+09:00',
    );
  });

  test('skips the intro push when messages_log already has a matching entry_route_intro row (dedupe)', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
    mockFollowFriend();
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(referralRoute);
    vi.mocked(getScenarios).mockResolvedValue([]);
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-follow',
      displayName: 'FUSAE',
      pictureUrl: null,
      statusMessage: null,
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
      // /auth/callback (applyRefAttribution) already sent and logged this
      // intro — the follow webhook must not send it again.
      first: vi.fn().mockResolvedValue({ 1: 1 }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const res = await runFollowEvent(db);

    expect(res.status).toBe(200);
    expect(getMessageTemplateById).not.toHaveBeenCalled();
    expect(lineClientMocks.pushMessage).not.toHaveBeenCalled();
    expect(stmt.run).not.toHaveBeenCalled();
  });

  describe('referral tag attach', () => {
    const referralRouteWithTag = { ...referralRoute, tag_id: 'tag-1' };

    test('referralRoute.tag_id がある場合 addTagToFriend が呼ばれる', async () => {
      vi.mocked(verifySignature).mockResolvedValue(true);
      vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
      mockFollowFriend();
      vi.mocked(getEntryRouteByRefCode).mockResolvedValue(referralRouteWithTag);
      vi.mocked(getScenarios).mockResolvedValue([]);
      lineClientMocks.getProfile.mockResolvedValue({
        userId: 'U-follow',
        displayName: 'FUSAE',
        pictureUrl: null,
        statusMessage: null,
      });

      const stmt = {
        bind: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        // Treat intro as already-sent so this test isolates the tag-attach
        // assertion from the intro-push dedupe logic covered above.
        first: vi.fn().mockResolvedValue({ 1: 1 }),
      };
      stmt.bind.mockReturnValue(stmt);
      const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

      const res = await runFollowEvent(db);

      expect(res.status).toBe(200);
      expect(addTagToFriend).toHaveBeenCalledWith(db, 'friend-2', 'tag-1');
    });

    test('referralRoute.tag_id が null なら addTagToFriend は呼ばれない', async () => {
      vi.mocked(verifySignature).mockResolvedValue(true);
      vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
      mockFollowFriend();
      vi.mocked(getEntryRouteByRefCode).mockResolvedValue(referralRoute); // tag_id: null
      vi.mocked(getScenarios).mockResolvedValue([]);
      lineClientMocks.getProfile.mockResolvedValue({
        userId: 'U-follow',
        displayName: 'FUSAE',
        pictureUrl: null,
        statusMessage: null,
      });

      const stmt = {
        bind: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue({ 1: 1 }),
      };
      stmt.bind.mockReturnValue(stmt);
      const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

      const res = await runFollowEvent(db);

      expect(res.status).toBe(200);
      expect(addTagToFriend).not.toHaveBeenCalled();
    });

    test('addTagToFriend が失敗しても intro push は継続する', async () => {
      vi.mocked(verifySignature).mockResolvedValue(true);
      vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
      mockFollowFriend();
      vi.mocked(getEntryRouteByRefCode).mockResolvedValue(referralRouteWithTag);
      vi.mocked(getScenarios).mockResolvedValue([]);
      vi.mocked(getMessageTemplateById).mockResolvedValue(template);
      vi.mocked(buildMessage).mockReturnValue({ type: 'text', text: 'ようこそ！' });
      vi.mocked(messageToLogPayload).mockReturnValue({ messageType: 'text', content: 'ようこそ！' });
      vi.mocked(addTagToFriend).mockRejectedValue(new Error('tag attach failed'));
      lineClientMocks.getProfile.mockResolvedValue({
        userId: 'U-follow',
        displayName: 'FUSAE',
        pictureUrl: null,
        statusMessage: null,
      });

      const stmt = {
        bind: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        // No prior entry_route_intro row — the push must still proceed even
        // though the tag attach right before it threw.
        first: vi.fn().mockResolvedValue(null),
      };
      stmt.bind.mockReturnValue(stmt);
      const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

      const res = await runFollowEvent(db);

      expect(res.status).toBe(200);
      expect(lineClientMocks.pushMessage).toHaveBeenCalledWith('U-follow', [{ type: 'text', text: 'ようこそ！' }]);
    });
  });

  describe('pending ref attribution recovery', () => {
    function mockFollowFriendNoRef() {
      const friend = {
        id: 'friend-3',
        line_user_id: 'U-follow',
        display_name: 'FUSAE',
        picture_url: null,
        status_message: null,
        is_following: 1,
        user_id: null,
        line_account_id: null,
        metadata: '{}',
        first_tracked_link_id: null,
        created_at: '2026-08-06T22:15:15.859+09:00',
        updated_at: '2026-08-06T22:15:15.859+09:00',
        // Neither /auth/callback nor /api/liff/link's happy path wrote
        // ref_code before this webhook ran — the getFriendById retry below
        // also comes back empty, so pending-ref-attribution is the only
        // remaining source.
        ref_code: null,
      } as unknown as Awaited<ReturnType<typeof upsertFriend>>;
      vi.mocked(upsertFriend).mockResolvedValue(friend);
      return friend;
    }

    test('friend.ref_code が空 + 短いリトライも空 → consumePendingRefAttribution から回収し、タグが付く', async () => {
      vi.mocked(verifySignature).mockResolvedValue(true);
      vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
      const friend = mockFollowFriendNoRef();
      vi.mocked(getFriendById).mockResolvedValue({ ...friend, ref_code: null });
      vi.mocked(consumePendingRefAttribution).mockResolvedValue({ refCode: 'osaka-yuka-form' });
      vi.mocked(getEntryRouteByRefCode).mockResolvedValue({ ...referralRoute, tag_id: 'tag-1' });
      vi.mocked(getScenarios).mockResolvedValue([]);
      lineClientMocks.getProfile.mockResolvedValue({
        userId: 'U-follow',
        displayName: 'FUSAE',
        pictureUrl: null,
        statusMessage: null,
      });

      const stmt = {
        bind: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue({ 1: 1 }),
      };
      stmt.bind.mockReturnValue(stmt);
      const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

      const res = await runFollowEvent(db);

      expect(res.status).toBe(200);
      expect(consumePendingRefAttribution).toHaveBeenCalledWith(db, 'U-follow');
      expect(getEntryRouteByRefCode).toHaveBeenCalledWith(db, 'osaka-yuka-form');
      expect(addTagToFriend).toHaveBeenCalledWith(db, 'friend-3', 'tag-1');
    }, 10000);

    test('friend.ref_code が既に設定済みなら consumePendingRefAttribution は呼ばれない', async () => {
      vi.mocked(verifySignature).mockResolvedValue(true);
      vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
      mockFollowFriend(); // ref_code: 'osaka-yuka-form' already set
      vi.mocked(getEntryRouteByRefCode).mockResolvedValue(referralRoute);
      vi.mocked(getScenarios).mockResolvedValue([]);
      lineClientMocks.getProfile.mockResolvedValue({
        userId: 'U-follow',
        displayName: 'FUSAE',
        pictureUrl: null,
        statusMessage: null,
      });

      const stmt = {
        bind: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue({ 1: 1 }),
      };
      stmt.bind.mockReturnValue(stmt);
      const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

      const res = await runFollowEvent(db);

      expect(res.status).toBe(200);
      expect(consumePendingRefAttribution).not.toHaveBeenCalled();
    });

    test('consumePendingRefAttribution が失敗しても友だち登録処理は継続する', async () => {
      vi.mocked(verifySignature).mockResolvedValue(true);
      vi.mocked(jstNow).mockReturnValue('2026-07-23T17:17:59.457+09:00');
      const friend = mockFollowFriendNoRef();
      vi.mocked(getFriendById).mockResolvedValue({ ...friend, ref_code: null });
      vi.mocked(consumePendingRefAttribution).mockRejectedValue(new Error('D1 down'));
      vi.mocked(getScenarios).mockResolvedValue([]);
      lineClientMocks.getProfile.mockResolvedValue({
        userId: 'U-follow',
        displayName: 'FUSAE',
        pictureUrl: null,
        statusMessage: null,
      });

      const stmt = {
        bind: vi.fn(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
      };
      stmt.bind.mockReturnValue(stmt);
      const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

      const res = await runFollowEvent(db);

      expect(res.status).toBe(200);
    }, 10000);
  });
});
