# プロジェクト状況（直近の重要な決定事項・修正内容）

このファイルは、Claude Code / Codex CLI等、複数のツールを併用して開発を進める際に
技術的な文脈を共有するための記録。更新時は日付を追記し、古い情報は削除せず
「解決済み」「対応不要になった」等を明記して残す。

## 2026-07-25: 紹介リンク（entry_route）intro pushの重複送信を修正

- **問題**: `entry_route.intro_template_id` の即時プッシュが、OAuthコールバック
  （`apps/worker/src/routes/liff.ts` の `applyRefAttribution`）とLINE follow Webhook
  （`apps/worker/src/routes/webhook.ts`）の両方から送信されうる構造になっており、
  どちらが先に `friends.ref_code` を解決するかのレース次第で二重送信が発生していた。
- **修正**: 両経路とも、送信前に `messages_log` を
  `WHERE friend_id = ? AND source = 'entry_route_intro' AND template_id_at_send = ?`
  で確認し、既に送信済みならスキップ。送信後は同条件で `messages_log` に記録する。
  スキーマ変更は不要（`source`はmigration 028、`template_id_at_send`はmigration 038で
  既に追加済みの列を再利用）。
- **コミット**: `aa1df5d` (`fix(referral): dedupe entry_route intro push between OAuth
  callback and follow webhook`)。mainにマージ・push済み、本番へも反映済み。
- **他経路の重複調査結果**（同一セッションで実施）: シナリオ登録
  （`enrollFriendInScenario`）は `friend_scenarios` の
  `UNIQUE(friend_id, scenario_id) WHERE status != 'completed'` + `INSERT OR IGNORE`
  で既にレース安全。タグ付与（`addTagToFriend`）も`INSERT OR IGNORE`で冪等。
  シナリオの即時プッシュ（クリックキャンペーン用）は`liff.ts`側からのみ呼ばれており
  重複経路自体が存在しない。→ 追加対応は不要と判断。

## 2026-07-25: オーナーLINE通知フェーズ①— 実装・デプロイ完了、実機確認済み

- **内容**: follow（友だち追加）イベントとmessage（テキスト受信）イベントの発生時に、
  kumi♪さん個人のLINEへMessaging API経由でプッシュ通知を送る機能。
  `OWNER_NOTIFY_LINE_USER_ID`（オプショナル環境変数、`wrangler secret put`で設定）が
  未設定の場合は通知処理自体をスキップし、既存動作に影響しない。
- **設計書・プラン**: `docs/superpowers/specs/2026-07-24-owner-line-notification-design.md`,
  `docs/superpowers/plans/2026-07-24-owner-line-notification.md`
- **実装**: `.claude/worktrees/owner-line-notification` worktreeで実施（コミット
  `04ae187`, `c3320c1`, `e0f191b`）。`git merge --no-ff` でmainへ統合（マージコミット
  `d33a765`）、mainにpush済み。
- **状態**: 本番デプロイ済み、**follow・message両方の通知が実機で届くことを確認済み**
  （2026-07-25）。フェーズ①完了。
- **スコープ外（将来フェーズ）**: 返信機能（PWA/Web Push、フェーズ③）、通知頻度制御、
  `notification_rules`/`notifications`テーブルとの統合。

## 2026-07-25: `OWNER_NOTIFY_LINE_USER_ID` シークレットが空文字列で登録されていた不具合

- **症状**: デプロイ後に実機テストしても、フォロー・メッセージ受信どちらのオーナー通知も
  届かなかった。
- **調査**: `wrangler tail`のライブログと一時診断ログ（`notifyOwner`内に
  `typeof`/`JSON.stringify`でownerUserIdを出力）を追加して切り分けたところ、
  `typeof=string raw=""` と判明。Cloudflare API（`/workers/scripts/line-harness/settings`
  および該当バージョンの`/versions/:id`）で当該シークレットのバインディング自体は
  正しく存在することも確認した上で、値が空文字列であることを特定した。
- **原因（推定）**: `wrangler secret put` の値入力プロンプトが、対話的でないシェル
  リレー環境ではエラーを出さずに空文字列へフォールバックしていた（同じセッションで
  `Worker新規作成の確認プロンプト`にも同様の「非対話フォールバック」動作が見られており、
  同種の挙動と推測される）。
- **修正**: `printf '%s' '<正しい値>' | npx wrangler secret put OWNER_NOTIFY_LINE_USER_ID`
  でstdin経由の値を明示的に設定し直し、正しい値が入っていることをログで確認。
  一時診断ログは削除してクリーンな状態に戻し、テスト・typecheck通過を確認の上、
  本番へ再デプロイ。
- **教訓**: `wrangler secret list`はバインディングの「存在」のみを示し、値が空でない
  ことは保証しない。非対話環境でシークレットを設定する際は値をパイプで渡す方式を使い、
  設定後は実際にその値を使う経路を1回動かして確認すること（詳細は`CLAUDE.md`/
  `AGENTS.md`の「開発・デプロイ時の注意点」を参照）。

## 2026-07-25: GitHub Actionsが無効化されていることが判明、本番デプロイは手動運用

- このリポジトリ（`9kumiko3oka5-jpg/line-harness-oss`）は `Shudesu/line-harness-oss` の
  フォークであり、GitHubの仕様によりフォークではActionsがデフォルトで無効化されている。
  `gh api repos/9kumiko3oka5-jpg/line-harness-oss/actions/runs` で確認したところ
  `total_count: 0`（全ワークフロー含め一度も実行履歴なし）。
- `.github/workflows/deploy-cloudflare-worker.yml` 等はmainへのpushで自動実行される
  想定で書かれているが、実際には動いていない。
- **現状の運用**: 本番デプロイは手動で `cd apps/worker && pnpm run build && npx wrangler
  deploy` を実行する。D1マイグレーションも同様に手動適用（`npx wrangler d1 execute
  line-crm --remote --file=...`）が必要な場合がある。
- Actionsを有効化して自動デプロイに戻す場合は、GitHub側でActionsを有効化した上で、
  リポジトリ変数（`LINE_HARNESS_CLOUDFLARE_DEPLOY=true`, `WORKER_NAME`等）と
  シークレット（`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_NAME`,
  `D1_DATABASE_ID`等）の設定が別途必要（未対応）。

## 2026-07-25: 誤って作成した空Worker `line-harness-production` を削除

- オーナーLINE通知機能のシークレット設定作業中、`wrangler secret put
  OWNER_NOTIFY_LINE_USER_ID --env production` を実行した際、`wrangler.toml`に
  `[env.production]`セクションが存在するにもかかわらず対応するWorker
  `line-harness-production` が存在しなかったため、非対話コンテキストでの
  フォールバック動作により確認なしで新規Workerが自動作成されてしまった。
- 実際の本番Workerは `line-harness`（トップレベル設定、`--env`なし）であり、
  `line-harness-production` は実コード・実トラフィックのない孤立したWorkerだった。
- `npx wrangler delete --name line-harness-production` で削除済み。
- **教訓**: `wrangler.toml`に複数environmentが定義されている場合でも、実際の
  デプロイ経路（CIワークフローの`wrangler deploy`コマンド）がどの環境/Worker名を
  使っているかを先に確認してから`--env`オプションの要否を判断すること。
