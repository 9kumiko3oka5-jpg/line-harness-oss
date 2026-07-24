# オーナーLINE通知（フェーズ①）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** follow イベント（友だち追加）と message イベント（テキスト受信）の発生時に、kumi♪ 個人のLINEへ Messaging API 経由でプッシュ通知を送る。

**Architecture:** `apps/worker/src/routes/webhook.ts` の `handleEvent()` に閉じたローカルヘルパー `notifyOwner()` を追加し、follow / message(text) の各分岐の末尾（既存の `fireEvent` 呼び出しの前後）から呼び出す。通知先ユーザーIDは `OWNER_NOTIFY_LINE_USER_ID` という新規オプショナル環境変数（`wrangler secret` 経由）で渡す。event-bus.ts の汎用イベント処理には一切手を入れない。

**Tech Stack:** Hono, Cloudflare Workers, D1, `@line-crm/line-sdk`（`LineClient.pushTextMessage`）, Vitest

## Global Constraints

- 通知は全 LINE アカウント共通で発火する（`line_account_id` によるスコープ絞り込みはしない）。
- メッセージ受信通知はテキストメッセージのみを対象とする。スタンプ・画像等の非テキスト分岐（`event.type === 'message' && event.message.type !== 'text'`）には追加しない。
- 通知の送信成否は `messages_log` に記録しない。失敗時は `console.error` のみで、既存の主処理（友だち登録・シナリオ進行・自動返信等）をブロックしない。
- `OWNER_NOTIFY_LINE_USER_ID` は `wrangler secret put` で設定するオプショナルな環境変数。未設定時は通知処理そのものをスキップし、既存動作に一切影響しない。
- 実装は `apps/worker/src/routes/webhook.ts` 内に閉じたローカル関数として追加する。`apps/worker/src/services/event-bus.ts` の汎用イベント処理（送信Webhook・スコアリング・automation）には混ぜない。

参照設計書: `docs/superpowers/specs/2026-07-24-owner-line-notification-design.md`

---

## File Map

- Modify: `apps/worker/src/index.ts` — `Env.Bindings` に `OWNER_NOTIFY_LINE_USER_ID?: string` を追加。
- Modify: `apps/worker/src/routes/webhook.ts` — `notifyOwner()` ヘルパー追加、`handleEvent()` に `ownerNotifyUserId?: string` パラメータ追加、follow / message(text) 分岐から呼び出し、`webhook.post` のハンドラ呼び出し箇所を更新。
- Modify: `apps/worker/src/routes/webhook.test.ts` — `lineClientMocks` に `pushTextMessage` を追加、follow / message(text) / 非テキスト / 環境変数未設定 / push失敗時の各テストを追加。

---

### Task 1: Env バインディング + notifyOwner ヘルパー + follow イベント通知

**Files:**
- Modify: `apps/worker/src/index.ts` (Env.Bindings 型, `LIFF_URL: string;` の直後あたり)
- Modify: `apps/worker/src/routes/webhook.ts` (`ensureFriendFromWebhookUser` の直後にヘルパー追加、`handleEvent` シグネチャ、follow 分岐、`webhook.post` 内の呼び出し箇所)
- Test: `apps/worker/src/routes/webhook.test.ts`

**Interfaces:**
- Produces: `notifyOwner(lineClient: LineClient, ownerUserId: string | undefined, text: string): Promise<void>` — Task 2 がそのまま呼び出す。
- Produces: `handleEvent(db, lineClient, event, lineAccessToken, lineAccountId?, workerUrl?, liffUrl?, r2?, ownerNotifyUserId?: string): Promise<void>` — 新規末尾パラメータ。Task 2 は同じシグネチャの中で使う。

- [ ] **Step 1: `lineClientMocks` に `pushTextMessage` を追加**

`apps/worker/src/routes/webhook.test.ts` の冒頭、`vi.hoisted` 部分を以下に置き換える:

```ts
const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  pushMessage: vi.fn(),
  pushTextMessage: vi.fn(),
}));
```

- [ ] **Step 2: follow イベントの通知テストを書く（失敗する状態で）**

**重要:** `webhook.test.ts` の現在の committed 状態には `follow` イベント用の describe ブロックが存在しない（`first-contact existing friends` と `DoS defenses` の2ブロックのみ）。他セッションで進行中の別機能（紹介リンクintro pushの重複排除）が `follow event referral intro push` という describe ブロックを追加しているが、これは**別リポジトリチェックアウトの未コミット変更であり、この worktree には存在しない**。今回のタスクではそれに依存せず、自己完結した新しい describe ブロックを追加する。

`apps/worker/src/routes/webhook.test.ts` の末尾（ファイル最後の行、既存の最後の `describe(...)` ブロックの後）に、以下をまるごと追加する:

```ts

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
});
```

Note: `getEntryRouteByRefCode` を `null` に設定しているのは、この通知テストの本題（owner通知）と紹介リンクの intro push ロジックを切り離すため。`friendRefCode` は `mockFollowFriend()` が返す friend の `ref_code: 'osaka-yuka-form'` から解決される。この `describe('POST /webhook — owner notification', ...)` ブロックと、その中の `followEventBody` / `mockFollowFriend` / `stubDb` / `runFollowEvent` ヘルパーは、Task 3 がそのまま再利用する。

- [ ] **Step 3: テストを実行し、失敗を確認する**

Run: `cd apps/worker && npx vitest run src/routes/webhook.test.ts`
Expected: 追加した2つのテストが FAIL する（`notifyOwner` が存在しない/呼ばれないため。1つ目は `pushTextMessage` が呼ばれず、2つ目は元々呼ばれないので通ってしまう可能性があるが、1つ目のFAILで十分)。

- [ ] **Step 4: `Env.Bindings` に環境変数を追加**

`apps/worker/src/index.ts` の `LIFF_URL: string;` の行の直後に追加:

```ts
    LIFF_URL: string;
    // オーナー個人のLINE User ID。設定時、follow/message(text)イベント発生ごとに
    // Messaging API 経由でプッシュ通知を送る（フェーズ①: 気づける状態を作る）。
    // wrangler secret put で設定。未設定時は通知処理をスキップする。
    OWNER_NOTIFY_LINE_USER_ID?: string;
```

- [ ] **Step 5: `notifyOwner` ヘルパーを追加し、`handleEvent` に配線する**

`apps/worker/src/routes/webhook.ts` の `ensureFriendFromWebhookUser` 関数の直後（`async function handleEvent(` の直前）に追加:

```ts
async function notifyOwner(
  lineClient: LineClient,
  ownerUserId: string | undefined,
  text: string,
): Promise<void> {
  if (!ownerUserId) return;
  try {
    await lineClient.pushTextMessage(ownerUserId, text);
  } catch (err) {
    console.error('[notifyOwner] push failed', err);
  }
}
```

`webhook.post('/webhook', ...)` 内の `handleEvent(...)` 呼び出し（`c.executionCtx.waitUntil(processingPromise)` の直前のブロック）を更新:

```ts
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.LIFF_URL, c.env.IMAGES, c.env.OWNER_NOTIFY_LINE_USER_ID);
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();
```

`handleEvent` のシグネチャを更新:

```ts
async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
  r2?: R2Bucket,
  ownerNotifyUserId?: string,
): Promise<void> {
```

follow 分岐内の `await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);` の直後、`return;` の直前に追加:

```ts
    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);

    await notifyOwner(
      lineClient,
      ownerNotifyUserId,
      `【通知】新しい友だちが追加されました：${friend.display_name || '(表示名なし)'}（流入元：${friendRefCode ?? 'なし'}）`,
    );
    return;
```

- [ ] **Step 6: テストを実行し、成功を確認する**

Run: `cd apps/worker && npx vitest run src/routes/webhook.test.ts`
Expected: 全テスト PASS（新規2件を含む）。

- [ ] **Step 7: 型チェック**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/routes/webhook.ts apps/worker/src/routes/webhook.test.ts
git commit -m "feat: notify owner LINE on friend follow event"
```

---

### Task 2: message イベント（テキスト）の通知 + 非テキスト除外テスト

**Files:**
- Modify: `apps/worker/src/routes/webhook.ts` (message(text) 分岐)
- Test: `apps/worker/src/routes/webhook.test.ts`

**Interfaces:**
- Consumes: Task 1 の `notifyOwner(lineClient, ownerUserId, text)` と `handleEvent(..., ownerNotifyUserId?: string)`。

- [ ] **Step 1: テキストメッセージ通知テストを書く（失敗する状態で）**

`apps/worker/src/routes/webhook.test.ts` の `describe('POST /webhook — first-contact existing friends', ...)` ブロック内、既存の `test('auto-registers an unknown text-message sender ...', ...)` の後に追加:

```ts
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
```

- [ ] **Step 2: テストを実行し、1つ目が失敗することを確認する**

Run: `cd apps/worker && npx vitest run src/routes/webhook.test.ts`
Expected: `notifies the owner via pushTextMessage on incoming text message ...` が FAIL（`pushTextMessage` が呼ばれない）。`does not notify ... stickers` は実装前でも元々 pushTextMessage が呼ばれないため PASS してしまって構わない（回帰防止用）。

- [ ] **Step 3: message(text) 分岐に notifyOwner を追加**

`apps/worker/src/routes/webhook.ts` の `if (event.type === 'message' && event.message.type === 'text')` 分岐内、`await fireEvent(db, 'message_received', {` の直前に追加:

```ts
    // auto_replies にマッチしなかった = 自発メッセージ → unread にする
    if (!matched) {
      await upsertChatOnMessage(db, friend.id);
    }

    await notifyOwner(
      lineClient,
      ownerNotifyUserId,
      `【通知】${friend.display_name || '(表示名なし)'}さんからメッセージ：${incomingText}`,
    );

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
```

- [ ] **Step 4: テストを実行し、成功を確認する**

Run: `cd apps/worker && npx vitest run src/routes/webhook.test.ts`
Expected: 全テスト PASS。

- [ ] **Step 5: 型チェック**

Run: `cd apps/worker && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/webhook.ts apps/worker/src/routes/webhook.test.ts
git commit -m "feat: notify owner LINE on incoming text message"
```

---

### Task 3: 通知失敗時のレジリエンステスト

**Files:**
- Test: `apps/worker/src/routes/webhook.test.ts`（追加のみ、実装コードの変更なし — Task 1 の try/catch が既に対応済みであることを検証する）

**Interfaces:**
- Consumes: Task 1 が `apps/worker/src/routes/webhook.test.ts` に追加した `describe('POST /webhook — owner notification', ...)` ブロックと、その中のローカルヘルパー `followEventBody()` / `mockFollowFriend()` / `stubDb()` / `runFollowEvent(db, env?)`。これらは Task 1 のコミット後に既に存在する前提。新しく作り直さないこと。

- [ ] **Step 1: pushTextMessage が例外を投げても follow 処理が完走するテストを書く**

`apps/worker/src/routes/webhook.test.ts` の `describe('POST /webhook — owner notification', ...)` ブロック内、既存の2つの `test(...)` の後、閉じ `});` の直前に追加する（`followEventBody` / `mockFollowFriend` / `stubDb` / `runFollowEvent` は同じ describe ブロック内で既に定義済みのものをそのまま使う。再定義しないこと）:

```ts
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
```

- [ ] **Step 2: テストを実行し、成功することを確認する**

Run: `cd apps/worker && npx vitest run src/routes/webhook.test.ts`
Expected: PASS（Task 1 の `notifyOwner` 内 try/catch が既に例外を握りつぶしているため、実装コードの変更は不要。もし FAIL する場合は `notifyOwner` の try/catch 実装漏れなので Task 1 に戻って修正する）。

- [ ] **Step 3: フルテストスイートを実行**

Run: `cd apps/worker && npx vitest run`
Expected: 全テスト PASS（既存テストに回帰がないこと）。

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/routes/webhook.test.ts
git commit -m "test: verify owner notification failure doesn't break follow processing"
```

---

## Manual Verification (デプロイ前の確認事項 — 本番環境操作は別途承認を得てから実施)

1. `wrangler secret put OWNER_NOTIFY_LINE_USER_ID` で本番Workerに設定する（値はkumi♪さんのLINE User ID）。
2. デプロイ後、テスト用アカウントで実際に友だち追加・メッセージ送信を行い、kumi♪さんのLINEに通知が届くことを目視確認する。
3. `OWNER_NOTIFY_LINE_USER_ID` が未設定の環境（開発/テスト用ワーカー等）で、既存のfollow/message処理に影響がないことを確認する。
