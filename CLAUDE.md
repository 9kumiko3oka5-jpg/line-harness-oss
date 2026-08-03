# Project Instructions

## 進捗報告の信頼性

- 進捗を報告する前に、各主張を実際のツール実行結果と突き合わせること。
- 証拠を示せる作業だけを「完了」と報告する。未検証のものは「未検証」と明記する。
- テストが失敗したら、失敗した事実と出力をそのまま報告する。スキップした工程は「スキップした」と言う。

## 承認ゲート

- 複数ステップの作業は、実行前にプランを提示して承認を待つ。
- 削除・上書き・外部送信・公開・課金など取り消せない操作の前は、必ず確認を取る。
- 既存の成果物を大幅に書き換える前は、何をどう変えるか予告してから着手する。
- Playwrightで管理画面(line-harness-admin-cek.pages.dev)を操作する際は、まずスクリーンショットや表示確認など見るだけの操作から行い、データを作成・変更・削除する操作(友だち追加、配信実行、削除など)は必ず一つずつ内容を説明してから実行の許可を得ること。

## 作業開始時の確認

- 作業開始時は必ず `docs/PROJECT_STATUS.md` を読み、直近の復旧状況・未解決事項・運用変更を確認する。このファイルを引き継ぎ情報の正本として扱う。

<!--
以下「技術スタック・アーキテクチャ」〜「開発・デプロイ時の注意点」セクションは
AGENTS.md（Codex CLI等が読む規約ファイル）にも同一内容を複製している。
このブロックを更新したら、必ず AGENTS.md の対応ブロックも同じ内容に更新すること。
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

- **GitHub Actions運用状況**: 2026-07-25時点では、このリポジトリ
  (`9kumiko3oka5-jpg/line-harness-oss`) は `Shudesu/line-harness-oss` のフォークであり、
  GitHubの仕様でActionsがデフォルト無効化されていたため、`main`にpushしても自動デプロイ
  は走らず、本番デプロイは手動運用だった:
  ```
  cd apps/worker && pnpm run build && npx wrangler deploy
  ```
  **2026-08-03現在はGitHub Actionsを有効化済み**。Repository Secrets/Variablesを登録し、
  `LINE_HARNESS_CLOUDFLARE_DEPLOY=true` により
  `.github/workflows/deploy-cloudflare-worker.yml` は `main` pushまたは
  `workflow_dispatch` から本番WorkerへDeployできる状態。`Deploy Cloudflare Worker #3`
  の成功を確認済み。ローカルから手動デプロイする場合はトップレベルの `wrangler.toml`
  （`name = "line-harness"`）を使う。**`--env production` は使わないこと** —
  ローカルから`--env production`を付けると別名のWorker（`line-harness-production`）を
  新規作成しようとする（2026-07-25に実際に誤作成し削除する事態が発生した）。
- **LIFF復旧状況（2026-08-03）**: 新しいLINE Loginチャネル
  `骨盤ネジ締め® 申込・ご案内` と新LIFF ID `2010944622-92mAoJXV` で復旧済み。
  旧LIFF ID `2009699948-0ehzl675` / `2009699948-uH05jAc7` は履歴・テスト資料に残る場合が
  あるが、現在の本番運用には使用しない。原因はGitHub Actions Variablesに
  `VITE_LIFF_ID` が未登録で、Deploy成功後も公開JavaScript内のLIFF IDが空になり
  「読み込み中…」で停止していたこと。`VITE_LIFF_ID` 登録後、`Deploy Cloudflare Worker #3`
  がSuccessとなり、新LIFFで「おかえりなさい！kumi♪さん」の表示、申込み処理、
  LINE公式アカウントへの復帰、受付メッセージ受信まで実機確認済み。SecretやAPIトークンの
  実値は記録しない。
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
