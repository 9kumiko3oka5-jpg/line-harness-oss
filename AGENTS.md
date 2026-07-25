# Project Instructions

- ゴールから外れる提案をしないでください。
- ゴールに進む提案を必ずしてください。
- 回答には必ず「次のタスクはこれ」「今の進捗を全体像から整理するとこれ」を含めてください。
- 私が大学生だと思って、言語化してください。

<!--
以下「技術スタック・アーキテクチャ」〜「開発・デプロイ時の注意点」セクションは
CLAUDE.md（Claude Codeが読む規約ファイル）にも同一内容を複製している。
このブロックを更新したら、必ず CLAUDE.md の対応ブロックも同じ内容に更新すること。
-->

## 技術スタック・アーキテクチャ

pnpm workspaces によるモノレポ構成（`pnpm-workspace.yaml`: `apps/*`, `packages/*`）。TypeScript統一。

**apps/**
- `apps/worker` — バックエンド本体。Hono + Cloudflare Workers（`vite build && wrangler deploy`）。LINE Webhook受信、LIFF OAuthコールバック、管理画面向けAPI、cron（`*/5 * * * *` 等）を1つのWorkerに集約。Worker名: `line-harness`。
- `apps/web` — 管理画面。Next.js、Cloudflare Pagesにデプロイ（プロジェクト名: `line-harness-admin`、本番URL: `line-harness-admin-cek.pages.dev`）。
- `apps/liff` — LIFFフロントエンド。Vite、Cloudflare Pagesにデプロイ（プロジェクト名: `line-harness-liff`、`wrangler pages deploy dist`）。

**packages/**
- `packages/db`（`@line-crm/db`） — D1（SQLite）のスキーマ（`schema.sql`）・マイグレーション（`migrations/*.sql`）・クエリ関数群。D1データベース名: `line-crm`。
- `packages/line-sdk`（`@line-crm/line-sdk`） — LINE Messaging API クライアント（`LineClient`: pushMessage/replyMessage/pushTextMessage等）。
- `packages/shared`（`@line-crm/shared`） — 共有ユーティリティ。
- `packages/update-engine`（`@line-harness/update-engine`） — アップデート機構。

**主要ドメイン概念**（`apps/worker/src/routes/webhook.ts`, `liff.ts` が中心）
- `friends` — LINE友だち。`line_account_id`でマルチアカウント対応、`ref_code`で流入元を保持。
- `scenarios` / `scenario_steps` / `friend_scenarios` — ステップ配信。`friend_scenarios`は`UNIQUE(friend_id, scenario_id) WHERE status != 'completed'`があり、`enrollFriendInScenario`は`INSERT OR IGNORE`でレース安全。
- `entry_routes` / `tracked_links` — 流入経路（紹介リンク）。`intro_template_id`（即時プッシュ）・`scenario_id`（シナリオ登録）・`tag_id`を持つ。OAuthコールバック（`liff.ts`の`applyRefAttribution`）とfollow Webhook（`webhook.ts`）の両方から解決されうるため、`intro_template_id`のプッシュは`messages_log`（`source='entry_route_intro'` + `template_id_at_send`）で重複排除している（2026-07-25対応、詳細は`docs/PROJECT_STATUS.md`）。
- `messages_log` — 全送受信ログ。`source`カラム（`entry_route_intro`/`scenario`/`auto_reply`/`broadcast`/`manual`/`user`等）と`delivery_type`（`push`/`reply`等）で送信経路を区別。
- `line_accounts` — 複数LINE公式アカウント運用時のアカウント別トークン管理（本プロジェクトの現行運用では未使用、全友だちの`line_account_id`は`null`）。

## 開発・デプロイ時の注意点

- **このリポジトリは `Shudesu/line-harness-oss` のフォーク。GitHub ActionsはGitHubの仕様でフォークではデフォルト無効化されており、本リポジトリでは一度も実行されたことがない**（`gh api repos/{owner}/{repo}/actions/runs` で確認可能、`total_count: 0`）。`main`にpushしても自動デプロイは走らない。本番デプロイは手動で行う:
  ```
  cd apps/worker && pnpm run build && npx wrangler deploy
  ```
  これはトップレベルの `wrangler.toml`（`name = "line-harness"`）を使う。**`--env production` は使わないこと** — `wrangler.toml`の`[env.production]`セクションは実際のCIデプロイ経路（`.github/workflows/deploy-cloudflare-worker.yml`、無効化中）専用の設定であり、ローカルから`--env production`を付けると別名のWorker（`line-harness-production`）を新規作成しようとする（2026-07-25に実際に誤作成し削除する事態が発生した）。
- **D1マイグレーションの本番適用状況は必ず実データで確認する**。ローカルのファイル一覧と本番`_migrations`テーブルは乖離しうる:
  ```
  npx wrangler d1 execute line-crm --remote --command "SELECT name, applied_at FROM _migrations ORDER BY name DESC LIMIT 10"
  ```
  過去に`037`番号のマイグレーションが2ファイル存在し（`037_event_booking.sql`と`037_scenario_delivery_mode.sql`）、後者はPRマージ前に本番へ手動適用済みだったため、CIのマイグレーションランナーが「未適用」と誤認してALTER TABLEを再実行し `duplicate column name` で失敗した事例がある。対処はファイルをno-opマーカー（元のDDLをコメントで残し`SELECT 1;`のみ実行）に書き換えること。新しいマイグレーションを追加する前に、本番へ手動適用済みのものがないか確認する。
- **Secret（`wrangler secret put`）は必ず対話的なターミナルで値を入力する**。非対話コンテキスト（エージェント経由のシェルリレー等）では値入力プロンプトがエラーなく空文字列にフォールバックすることがある（2026-07-25に`OWNER_NOTIFY_LINE_USER_ID`が空文字列で登録され、通知が届かない不具合が発生）。`wrangler secret list`はバインディングの存在のみを示し、値が空でないことは保証しない。非対話環境で設定する場合は値をパイプで渡す:
  ```
  printf '%s' '<値>' | npx wrangler secret put <NAME>
  ```
  設定後は実際にその値を使う経路を1回動かして確認する。
- コード変更後は必ずデプロイ前に `cd apps/worker && npx tsc --noEmit -p . && npx vitest run` を実行する。
