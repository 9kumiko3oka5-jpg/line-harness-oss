# オーナーLINE通知（フェーズ①）設計書

## 背景・目的

現状、L-harnessの管理画面を開かないと友だち追加・メッセージ受信に気づけない。フェーズ①として、以下2つのイベント発生時に kumi♪ 個人のLINEへ Messaging API 経由でプッシュ通知を送り、「気づける」状態を作る。

- 友だち追加イベント（follow event）
- メッセージ受信イベント（message event, テキストのみ）

返信機能・PWA/Web Push対応はフェーズ③でスコープ外。頻度制御（連投時の抑制）も今回は対象外。

## 対象イベントの発生箇所

`apps/worker/src/routes/webhook.ts` の `handleEvent()` 関数:

- follow イベント: `event.type === 'follow'` 分岐（友だち登録・シナリオ登録・紹介リンク処理の後、`fireEvent(db, 'friend_add', ...)` を呼ぶ箇所の直後）
- message イベント（テキスト）: `event.type === 'message' && event.message.type === 'text'` 分岐（`fireEvent(db, 'message_received', ...)` を呼ぶ直前）
- message イベント（非テキスト: スタンプ/画像/音声/動画/ファイル/位置情報）は対象外（既存のログ記録のみの分岐で、`fireEvent` 自体呼ばれていない）

既存の `notification_rules` / `notifications` テーブルと `/api/notifications/rules` CRUD API は調査済みだが、`createNotification()` を実際に呼び出す箇所が存在しない（未配線の骨組み）。これを配線するのは本フェーズの範囲を超えるため、今回は使用しない。

## 環境変数

`OWNER_NOTIFY_LINE_USER_ID`（オプショナル）を `wrangler secret put OWNER_NOTIFY_LINE_USER_ID` で設定する。

- `apps/worker/src/index.ts` の `Env.Bindings` 型に `OWNER_NOTIFY_LINE_USER_ID?: string;` を追加。
- `[vars]`（平文）ではなく secret 経由。理由: LINE User ID が個人を特定しうる情報であり、OSSリポジトリの `wrangler.toml` に平文で残すべきではないため。
- 未設定時は通知処理そのものをスキップし、既存の webhook 処理に一切影響しない。

## 通知先の決定方法（マルチアカウント対応）

`line_accounts` テーブルにより複数のLINE公式アカウントを運用できる構成になっているが、通知は「全アカウント共通」で同じ `OWNER_NOTIFY_LINE_USER_ID` へ送る。

- 送信には、そのイベントを受信したアカウントの `channelAccessToken` で構築済みの `lineClient`（`handleEvent` に既存の引数として渡されている）をそのまま再利用する。
- 前提条件: kumi♪さんの個人LINEが、通知を受け取りたい各LINE公式アカウントの「友だち」になっている必要がある（LINE Push Message APIの制約）。友だちになっていないアカウントからのイベントでは push が失敗するが、エラーはログに記録されるのみで他の処理には影響しない。

## 実装

### notifyOwner ヘルパー（`webhook.ts` 内に閉じたローカル関数）

```ts
async function notifyOwner(
  lineClient: LineClient,
  ownerUserId: string | undefined,
  text: string,
): Promise<void> {
  if (!ownerUserId) return;
  try {
    await lineClient.pushMessage(ownerUserId, [{ type: 'text', text }]);
  } catch (err) {
    console.error('[notifyOwner] push failed', err);
  }
}
```

- `event-bus.ts` の汎用イベント処理（送信Webhook・スコアリング・automation）には混ぜない。将来イベント種別が増えた場合は改めて設計する。

### 呼び出し箇所とパラメータ渡し

- `handleEvent()` のシグネチャに `ownerNotifyUserId?: string` を追加（`workerUrl` / `liffUrl` / `r2` と同じ渡し方）。
- `webhook.post('/webhook', ...)` から `handleEvent(..., c.env.OWNER_NOTIFY_LINE_USER_ID)` として渡す。

### 通知文言

- follow イベント（`fireEvent(db, 'friend_add', ...)` 直後）:
  ```
  【通知】新しい友だちが追加されました：${friend.display_name || '(表示名なし)'}（流入元：${friendRefCode ?? 'なし'}）
  ```
  `friendRefCode` は同分岐内で既に解決済みの変数（ref_code 再試行ロジックの結果）をそのまま使う。

- message イベント（テキスト、`fireEvent(db, 'message_received', ...)` 直前）:
  ```
  【通知】${friend.display_name || '(表示名なし)'}さんからメッセージ：${incomingText}
  ```

## エラーハンドリング・ログ

- `notifyOwner` 内で例外を捕捉し `console.error('[notifyOwner] push failed', err)` のみ。既存の副次処理（紹介リンクプッシュ等）と同じパターンで、通知失敗が友だち登録・自動返信・シナリオ進行など主処理をブロックしない。
- `messages_log` への記録は行わない。同テーブルは `friend_id` に紐づく会話履歴を表すためのものであり、システムからオーナー個人への通知はその用途と異なる。

## テスト計画

`apps/worker/src/routes/webhook.test.ts` に以下を追加する:

1. `OWNER_NOTIFY_LINE_USER_ID` 設定時、follow イベントで `pushMessage` がそのuserIdと期待文言（表示名・流入元込み）で呼ばれることを確認。
2. `OWNER_NOTIFY_LINE_USER_ID` 設定時、message（テキスト）イベントで `pushMessage` が期待文言で呼ばれることを確認。
3. 非テキストメッセージイベント（スタンプ等）では、オーナー向け `pushMessage` が呼ばれないことを確認。
4. `OWNER_NOTIFY_LINE_USER_ID` 未設定時は通知処理がスキップされ、既存のfollow/messageフローの結果（friend登録・ログ等）に変化がないことを確認。
5. オーナー通知の `pushMessage` が例外を投げても、friend登録やシナリオ進行・自動返信等の既存処理が正常完了することを確認。

## スコープ外（将来フェーズ）

- 返信機能（PWA化・Web Push対応、フェーズ③）
- 通知頻度制御（連投抑制）
- `notification_rules` / `notifications` テーブルとの統合
- 通知先の管理画面からの設定（テーブル管理）— 今回はsecret環境変数のみ
