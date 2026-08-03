# プロジェクト状況（直近の重要な決定事項・修正内容）

このファイルは、Claude Code / Codex CLI等、複数のツールを併用して開発を進める際に
技術的な文脈を共有するための記録。更新時は日付を追記し、古い情報は削除せず
「解決済み」「対応不要になった」等を明記して残す。

## 2026-08-03: LIFF「読み込み中」停止問題 → GitHub Actions設定補完と新LIFFで復旧確認済み

- **対象**: `https://line-harness.9kumiko3oka5.workers.dev/r/osaka-general-form`。
- **復旧内容**: 同じProvider「Kumi Labo」内に新LINE Loginチャネル
  `2010944622`（チャネル名: `骨盤ネジ締め® 申込・ご案内`）と新LIFFアプリ
  `2010944622-92mAoJXV` を作成し、Worker Secret の `LIFF_URL` と
  `LINE_LOGIN_CHANNEL_ID` を新値へ切替。`LINE_LOGIN_CHANNEL_SECRET` は
  Cloudflare Dashboard の Rotate から登録（値は記録しない）。
- **最終原因**: GitHub ActionsでWorker/LIFF assetsをビルドする際、Repository Variable
  `VITE_LIFF_ID` が未登録だったため、Deploy自体は成功しても公開JavaScript内のLIFF IDが
  空になり、LIFF初期化が「読み込み中…」で停止していた。2026-08-02時点の
  「LINEプラットフォーム/旧チャネル側の問題」という判断は、その時点の観測に基づく
  暫定判断として履歴に残すが、2026-08-03の最終復旧確認ではActionsビルド時の
  `VITE_LIFF_ID` 未設定が主原因と整理する。
- **新LIFF設定**: LIFF URL `https://liff.line.me/2010944622-92mAoJXV`、
  Endpoint URL
  `https://line-harness.9kumiko3oka5.workers.dev/?liffId=2010944622-92mAoJXV`、
  Scope `openid, profile`、サイズ `Full`、友だち追加オプション `Off`、
  Scan QR `Off`、モジュールモード `Off`。リンクした公式アカウントは
  `@542icvvj` / `骨盤ネジ締め®kumi Lab`。
- **GitHub Actions設定**:
  - Repository Secretsに `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
    `D1_DATABASE_ID`, `D1_DATABASE_NAME` を登録済み（値は記録しない）。
  - Repository Variableに `LINE_HARNESS_CLOUDFLARE_DEPLOY=true` と
    `VITE_LIFF_ID` を登録済み（値はこの記録ではSecret扱いではないが、必要最小限の
    ID以外は記録しない）。
  - Cloudflare API tokenはWorker更新に加えて、ワークフロー内のD1マイグレーション
    実行に必要なD1編集権限を持つものとして作成。
  - `Deploy Cloudflare Worker #3` が `Success` になったことを確認済み。
- **確認結果**:
  - `/r/osaka-general-form` が新LIFF ID
    `2010944622-92mAoJXV` のURLを生成することを確認。
  - `/r/:ref` 導線は新LIFFのpath形式
    `https://liff.line.me/2010944622-92mAoJXV/r/{ref}` を使用する実装に変更済み。
    大阪の確認済みURLは
    `https://liff.line.me/2010944622-92mAoJXV/r/osaka-general-form`。
  - `/api/liff/config?liffId=2010944622-92mAoJXV` が `success=true` かつ
    `botBasicId=@542icvvj` を返すことを確認。
  - スマートフォンで
    `https://liff.line.me/2010944622-92mAoJXV/r/osaka-general-form` を開くと、
    「LINEで開く」後に「おかえりなさい！kumi♪さん」と表示され、公式アカウントの
    トーク画面へ自動遷移し、「2026年秋 骨盤ネジ締め®大阪レッスンにお申込みいただき
    ありがとうございました」という申込み完了メッセージが届くことを実機確認。
- **結論**: 新LIFFでは認証・申込み経路・完了メッセージ送信まで正常動作。
  `VITE_LIFF_ID` のActions Variable登録と再Deployにより復旧済み。旧
  `2009699948-*` 系LIFF/LINE Loginチャネルは履歴として残すが、運用導線は新LIFF
  `2010944622-92mAoJXV` に統一する。
- **将来対応**: GitHub Actions上でNode.js 20関連の警告が表示されたが、今回のDeploy失敗
  原因ではない。Node.js/Actionsランタイム更新は別タスクで対応する。
- **注意**: 旧チャネルSecretや新チャネルSecretの値はドキュメント・ログ・チャットに
  記録しない。戻しが必要な場合は、LINE Developers Console と Cloudflare Dashboard
  からSecretを安全に再登録する。

## 2026-08-02: 管理画面API全般に `Cache-Control` 未設定 → ブラウザが古いレスポンスをキャッシュする不具合（未対応・次回対応予定）

- **症状**: 管理画面（line-harness-admin-cek.pages.dev）でテンプレートを新規作成した直後、
  画面上は成功表示になるが、その後の一覧表示が実際のD1の状態と食い違う（存在しない
  はずの項目が表示され続ける、既存の項目が消えて見える等）。
- **調査の経緯**: 最初は常時表示されている「改造を検知しました (v0.0.0-dev, unknown
  version — not in manifest)」バナーと関連があるのではと疑ったが、切り分けの結果
  **無関係と判明**。
  - バナーの原因: 実際にデプロイされているビルド（`8bfb8d9b6c1f` = コミット
    `Align deployed Worker URL and capability version`, 2026-06-24）は本物のコミット
    であり、改造ではなく単に約6週間古いビルドが動いているだけ。L-Harness開発者の
    野田さんに確認済みで「文言が不適切なだけで環境は壊れていない」とのこと。この
    コミット以降`apps/web`に入った変更は2件のみで、いずれもテンプレート作成/
    `api.ts`/CSRF回りには無関係（`git log 8bfb8d9b6c1f..HEAD -- apps/web/`で確認）。
  - 実際の原因: `apps/worker`が返すAPIレスポンス（例: `GET /api/message-templates`）に
    `Cache-Control`ヘッダーが一切付与されていない（実際のワイヤーレベルのレスポンス
    ヘッダーで確認済み。`apps/worker/src/index.ts:215`の`/api/qr`画像プロキシ用の
    1箇所を除き、worker全体で`Cache-Control`を設定している箇所がゼロ）。ヘッダーが
    無いAPIレスポンスはブラウザがヒューリスティックにキャッシュしてしまうことがあり
    （RFC 7234）、これが古いデータ表示の原因。`cache: 'no-store'`を指定して取得し直す
    と正しいデータが返ることを確認済み。
  - **これは現在の最新コミットのソースコードにも存在する不具合**であり、管理画面を
    最新ビルドに再デプロイしても直らない。テンプレート一覧に限らず`GET`系API全般で
    同様の事象が起こり得る。
- **対応方針（未実施）**: `apps/worker`のAPIルート（`/api/*`）のレスポンスに
  `Cache-Control: no-store`を返すミドルウェアを追加する。修正自体は小さいが、
  コード変更・本番デプロイを伴うため、ユーザーの指示により次回セッションに持ち越し。
  着手前にこのファイルを参照して経緯を再確認すること。

## 2026-08-02: osaka-general-form / tokyo-form の「友だち追加画面に到達しない」不具合 → LINEチャネル側の問題と判明（アプリ側の対応不可・LINEサポートへの問い合わせが必要）

- **症状**: `https://line-harness.9kumiko3oka5.workers.dev/r/osaka-general-form`を開き
  「LINEで開く」をタップすると、LINEアプリは起動するが「読み込み中」のまま進まない。
  こちらのワーカーのLIFFエンドポイント（ルート`/`）には**リクエストが一度も届いていない**
  ことを`wrangler tail`で複数回確認済み。
- **これまでに調査し、原因ではないと確定したもの**:
  - LIFFの「友だち追加オプション」設定（`On (Aggressive)` → `Off`に変更したが症状変わらず）
  - ブロック済み/フォロー中の状態の違い（フォロー中に戻しても再現）
  - LIFFエンドポイントURL・Scope（`openid, profile`）・OA連携（`@542icvvj`と正しく連携）
    ―― LINE Developers Console上の設定はすべて確認済みで問題なし
  - kumi♪さんの端末/LINEアプリ固有の問題（同じ端末の無関係な別LIFFは正常動作）
  - kumi♪さん個人のアカウント固有の問題 ―― 実際にフォーム経由で申し込んだ第三者
    （田井(木村)美絵さん、一度もこのアカウントに触れたことのない新規ユーザー）でも
    全く同じ症状（「読み込み中でぐるぐるしてます」）が発生し、友だちも増えていない
    ことを本人のLINEトーク上のメッセージと`friends`テーブルの両方で確認
  - 既存LIFFアプリ（`kumi Labo Harness`）固有の設定不備 ―― 同じ`kumi Labo`チャネル内に
    設定変更履歴のない真っさらなテスト用LIFFアプリ（`テスト用`, LIFF ID
    `2009699948-uH05jAc7`）を新規作成して直接開いても、全く同じ「読み込み中」症状が
    再現し、こちらのサーバーにもリクエストが一切届かないことを確認
- **結論**: 上記により、原因はこちらのワーカーのコード・DB・管理画面・個々のLIFF設定の
  いずれでもなく、**`kumi Labo`チャネル自体のLIFF機能がLINEプラットフォーム側で機能
  していない**ことが強く示唆される。アプリ側からは修正不可能な領域。
- **対応**: LINE Developers Consoleの「不具合報告フォーム」またはLINE for Businessの
  サポート窓口への問い合わせが必要（2026-08-02時点で未実施）。問い合わせ時に含める
  べき情報: チャネル名`kumi Labo`（LINEログインチャネル）、症状（複数LIFFアプリで
  「読み込み中」のまま進まない）、試した対応（友だち追加オプション変更・新規LIFF
  アプリでの再現確認等）。
- **暫定対応**: Googleフォームに「不具合対応中、リンクが開けない場合がある」旨の
  注意書きを追加済み（ユーザー側で実施）。
- **参考**: この調査の過程で`tokyo-form`という新しい流入ルート（タグ「東京-申込済み」・
  即時pushテンプレート込み）を作成済み（詳細は本ファイル下部の別エントリ、または
  管理画面のリファラルリンク一覧を参照）。

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
- **2026-08-03追記**: 上記は2026-07-25時点の履歴として残す。2026-08-03現在は
  GitHub Actionsを有効化し、Repository Secrets/Variablesを登録済み。
  `LINE_HARNESS_CLOUDFLARE_DEPLOY=true` により `Deploy Cloudflare Worker` workflowは
  main pushまたは手動実行（`workflow_dispatch`）で本番WorkerへDeployできる状態。
  `Deploy Cloudflare Worker #3` の成功を確認済み。今後は手動 `wrangler deploy` だけに
  依存せず、Actions経由の自動/手動Deployも利用可能。

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
