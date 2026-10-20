# プロジェクト状況（直近の重要な決定事項・修正内容）

このファイルは、Claude Code / Codex CLI等、複数のツールを併用して開発を進める際に
技術的な文脈を共有するための記録。更新時は日付を追記し、古い情報は削除せず
「解決済み」「対応不要になった」等を明記して残す。

## 2026-10-18: 本家v0.24.2への全面追従(方針B) — 2026-10-20本番反映済み(実機確認は未実施)

- **方針変更**: 9/4の3段階方針(A)から、ハッカソン(11/2〜)前にv0.24.2へ全面追従する方針(B)へ
  ユーザー合意のうえ切替。**10/28を判断日**とし、間に合わなければバックアップに戻してAへ切替。
  ユーザー方針: 公式LINEは現在ほぼ未使用(LINEグループで代替運用)。**友だち登録データ(friends)
  だけは絶対に失わないこと**。タグ等その他データは消えても可。
- **バックアップ**: `backup/pre-upstream-sync-20261018`ブランチと注釈付きタグ
  `pre-upstream-sync-20261018`(どちらもmain `da04165`)をoriginへpush済み。
- **9/4の第1段階はmainにマージ済み**(`da04165`)。本番反映の成否はユーザーがGitHub Actions画面で
  確認予定(この環境では`gh`未導入・wrangler未認証のため未検証)。`docs`の9/4エントリにある
  「mainへの反映待ち」は古い記述。
- **作業ブランチ**: `upstream-sync/v0.24`(ローカルのみ、未push)。マージコミット`170bce2`。
  衝突20ファイルを解消。独自カスタマイズの扱い:
  - 維持: オーナーLINE通知(follow/テキスト受信)、`pending_ref_attribution`による流入元回収と
    6時間cronの期限切れ削除(本家の新`scheduled.ts`へ移植)、follow時の`entry_routes.tag_id`付与、
    紹介文プッシュの重複排除、`/r/:ref`のクエリ形式LIFF URL(ループ修正)、
    `MAX_SENDS_PER_CRON = 4`(Free planのsubrequest上限、試行回数上限は8)、友だち一覧のCCボタン位置
    (本家の`positionClassName`で`bottom-28`指定)、CVポイント削除のエラー表示。
  - 本家に置換: `/auth/line`(UTF-8 state対応は本家に含まれる。LIFF未設定時のOAuthフォールバックは
    本家の503案内に置換)、即時ステップ配信・自動応答(本家の共通サービス化)、
    `/api/*`のno-store(本家の`cache-policy.ts`が上位互換のため独自ミドルウェアは削除)。
  - `apps/worker/wrangler.toml`: 本番デプロイはデフォルト環境の設定を使うため、cronは5分間隔を維持し、
    Workers Cacheパイロット(本家はテスト環境専用と明記)は無効化。
- **要判断(未対応)**: 本家は定期ジョブ用Durable Object `TenantScheduler`を追加しており、
  cron設定とは別に**毎分**アラームで`scheduled()`を実行する(ステップ配信・リマインド等。重い処理は
  5分/6時間境界のみ)。毎分実行を許容するか、DOのアーム処理を止めて5分cronのみにするかはユーザー判断待ち。
- **テスト結果**(このMacで実行): worker `tsc` OK・vitest 1653/1653、db 211/211、web `tsc` OK・
  84/84、scripts 73/73、worker `pnpm run build` OK。ビルド後の`dist/line_harness/wrangler.json`で
  cron=`*/5`・cache無効・DOバインディングを確認。
- **マイグレーション静的確認**: 新規27ファイルで`friends`への操作は`ADD COLUMN`7列と、新規列を埋める
  `UPDATE`(065)のみ。friendsの`DELETE`/`DROP`/作り直しは無し。データ削除は048の`chats`重複行の整理のみ。
- **ユーザー確認結果(同日)**: 9/4以降の`Deploy Cloudflare Worker`は成功(ユーザーがActions画面で確認)
  → 第1段階は本番反映済み。毎分実行のDO `TenantScheduler`は本家標準どおり受け入れる(方針a)。
- **③ DB予行演習(同日実施)**: 本番`_migrations`は52件・最新`046_pending_ref_attribution.sql`で、
  未適用はブランチ上の新規27件と完全一致(本番にだけ存在する手動適用分は無し)。本番friendsは26件
  (全員フォロー中・LINE userId重複なし)。`wrangler d1 export --remote`で書き出し→ローカルSQLite
  (3.43)に復元→27件をワークフローと同じ順序で適用: **全件成功**。friendsは26→26件、既存15列の
  全値が適用前後で完全一致(新規7列が追加され22列)。`integrity_check` ok、外部キー違反0。
  既存テーブルの件数変化は`auto_replies` 0→1のみ(067が組込みの「マイル」完全一致キーワード
  自動応答を`is_active=1`で投入)。書き出したファイルは個人情報を含むため検証後に削除済み。
- **「マイル」自動応答**: ユーザー判断で、本番反映後に管理画面で無効化する(方針a)。
- **④ローカル確認環境(同日構築)**: Worker=`apps/worker`で`npx wrangler dev --local --port 8787`、
  管理画面=`apps/web`で`NEXT_PUBLIC_API_URL=http://localhost:8787 npx next dev --port 3001`。
  `apps/worker/.dev.vars`(gitignore済み)はダミー値のみ(API_KEY=`local-test-key-20261018`、LINEトークン
  はダミー、各URLはlocalhost、CF_API_TOKEN/OWNER_NOTIFY/LIFF/LINE Loginは未設定)。ローカルD1は
  `bootstrap.sql`+架空データ(友だち30件、`line_user_id`は`Utest…`、line_accounts 0件)。
  チャット送信APIを叩いてLINE APIが401で拒否し配信記録も残らないことを確認済み。
  注意: `vite dev`だとViteのCORSがプリフライトに先に応答し`Allow-Credentials`が欠けてログイン不可
  (ローカル開発サーバー固有、本番とは無関係)。ローカル確認は`wrangler dev`を使う。
- **⑥本番反映(2026-10-20実施)**: 直前状態を記録 — 2026-10-20T07:10:02Z時点のD1 Time Travel
  ブックマーク`0000e668-00000000-0000510a-7f3fc777ec9cc808d0bc6797baf960dc`
  (戻す場合: `npx wrangler d1 time-travel restore line-crm --bookmark=<上記>`)、反映前のWorker
  バージョン`48e32d86-be74-4966-b873-75e24f7143b2`(戻す場合: `npx wrangler rollback <ID> --name line-harness`)、
  本番`_migrations`52件・friends 26件(予行演習時と同一)。friends単独の書き出し(26行)はセッション用の
  一時領域に保存(個人情報のためリポジトリには置かない)。反映直前に worker `tsc` OK・vitest 1653/1653。
  `upstream-sync/v0.24`をmainへマージしpush → GitHub Actionsで本番Deploy。
  **結果**: ユーザーがActions画面で`Deploy Cloudflare Worker`・`Deploy Cloudflare Admin`の両方成功、
  マイグレーション27件が`Applying`だったことを確認。反映後の本番確認(読み取りのみ): `_migrations`79件
  (最新`072_health_logs_composite_index.sql`)、friends 26件で反映前の書き出しと全15列・全行が完全一致、
  `PRAGMA foreign_key_check`違反0、新Workerバージョン`15b86fda-ad49-45f6-b58c-a972a53576e6`
  (2026-10-20T07:15:41Z、100%)。
- **「マイル」自動応答の無効化(2026-10-20完了)**: ユーザーが管理画面で無効化(管理画面ログインに
  API Keyが必要なため、エージェントによるPlaywright操作は未実施)。本番D1で
  `auto_replies.id='builtin-mileage-wallet-keyword'`が`is_active=0`であることを確認済み。
  削除はしていない(本家の組込みデータのため、将来使う場合は管理画面で有効化できる)。
- **未検証**: 反映後の実機確認(LIFF申込み・LINE受信・オーナー通知・ステップ配信・毎分の`TenantScheduler`
  の動作ログ)はまだ行っていない。
- **次のアクション(旧)**: 「マイル」自動応答を有効のままにするかユーザー判断、④確認手順書とローカル確認
  環境、⑤ユーザー確認、⑥本番反映(要OK。直前にfriends単独の書き出し・Time Travel時点・Worker
  バージョンIDを記録)。

## 2026-09-04: 本家との差分取り込みを3段階方針で開始 — 第1段階(セキュリティ関連)完了、mainへの反映待ち

- **前回(8/7)調査からの更新**: 本家がさらに進み、このフォーク`v0.15.0` vs 本家`v0.24.0`。`git log main..upstream/main`で未取込**106コミット**(うちマージコミット30件を除く実質変更**76件**)、`git diff --stat`で**603ファイル変更、+74,265行/-13,294行**。8/7時点(37コミット・133ファイル)から本家側の開発が大きく進んだため、106件を一度に取り込むのはリスクが高いと判断。
- **決定した3段階の取り込み方針**(ユーザーと合意、2026-09-04):
  1. **セキュリティ関連(約8〜9件)** — 今回はここから着手。admin-auth用Secretの設定後検証(`016375e`)、CORSヘッダー追加(`9af975a`の一部)、Worker更新時にSecret(`secret_text`/`secret_key`)が消える不具合の修正(`28bb395`)、アップデートダウンロードの整合性検証`worker_bundle_hash`(`a8fb9a5`)、OAuth stateのUTF-8エンコード修正(`6be3b7c`)、更新用CLIのnpm公開をOIDC信頼発行化(`0d0e6a9`、公開パッケージ運用のみ関係)、管理者SSO(`b7010ff`)、資格情報マスキング・監査対応(`ada3c9d`)、クォータ監視機能内のfail-open穴修正(`b0cd3ed`の一部)。
  2. **バグ修正(約25件)** — このフォーク側で独自に直した内容との重複確認が必要。判明済みの重複例:
     - `07f7fb0`(本家): 管理画面デプロイCIで`@line-harness/update-engine`のビルド漏れを修正。**このフォークでも2026-09-04に独立に同一の不具合を発見・修正済み**(`eb92e7f ci(admin): build update-engine before the admin Next.js build`)。本家側の実装と差分確認の上、必要なら本家版に寄せる。
     - `863ae75`(本家 #299): チャット画面で`CcPromptButton`が`fixed bottom-6 right-6`のため送信欄等に重なりクリックを奪う不具合を`positionClassName`導入(`bottom-24 right-6`)で修正。**このフォークでも2026-09-04に同種の不具合(友だち一覧「次へ」・チャット送信欄)を独立に発見し`bottom-28`固定オフセットで修正済み**(`f5f3b4f`)。本家はページ別に`positionClassName`を出し分ける設計で、より汎用的。取り込み時は本家方式への差し替えを検討。
  3. **新機能(約19件)** — 優先度の高いものから選んで取り込む。ASP(アフィリエイト)機能、アカウント別LIFF解決、インストーラー/自己更新刷新、独自ドメイン短縮URL、即時ステップ配信統一化、LINE APIプロキシ、オートウェビナー機能、マイレージ経済圏、予約管理画面再編、管理者SSO(SSO自体は1.にも計上)、チャットOAM風フルスクリーン化、利用量クォータ監視 等。
  - **各段階の後は必ず動作確認してから次の段階に進む**。
- **バックアップ**: 着手前に`backup/pre-upstream-sync-20260904`ブランチ(main `eb92e7f`時点)を作成しorigin にpush済み。問題が起きた場合はここに戻せる。作業は`security-sync/stage1`ブランチで実施(mainには未マージ、ユーザー確認待ち)。
- **第1段階(セキュリティ関連)の結果**: 候補9件のうち診断の結果、狭い意味での「単独で安全に取り込める修正」は3件のみだった。残りは大型機能に同梱されていて分離不可能、または本家自身のリリース/自己更新運用にのみ関係し、このフォークの直接デプロイ運用には適用対象外と判明。
  - **適用済み(3件、`security-sync/stage1`ブランチ、tsc/vitest 567件全通過確認済み)**:
    - `016375e`→`5fc971d`: admin-authのSecret設定後検証(`packages/create-line-harness`)。このフォークではインストーラーCLIを使わないため実運用上の効果はほぼ無いが、共有パッケージなので同期。
    - `6be3b7c`→`ea8b44d`: OAuth stateのUTF-8セーフエンコード(`apps/worker/src/routes/liff.ts`)。日本語UTMパラメータ付きの流入で`/auth/line`/`/auth/oauth`が500になる不具合の修正。本家は`ig`/`iga`/`igan`フィールドを含むが未取込のためコンフリクトが発生、このフォークの既存フィールド構成を保ったまま`encodeState`/`decodeState`のみ採用する形で解消。
    - `9af975a`の一部→`80ea384`: CORSの`allowHeaders`に`x-admin-api-key`を追加(`apps/worker/src/index.ts`、1行)。**このフォークの管理画面自己更新UI(`apps/web/src/lib/update-client.ts`)が実際にこのヘッダーを送信しているにも関わらず許可リストに無く、クロスオリジンでCORSブロックされ得る状態だった。実害の可能性がある修正**。元コミットのうち`apps/web/updates/page.tsx`側のUI変更(UX改善、セキュリティとは無関係)は取り込んでいない。
  - **見送り(対象外と判断)**:
    - `28bb395`: Worker再デプロイ時にSecret(`secret_text`/`secret_key`)バインディングが消える不具合の修正。`packages/update-engine`/`packages/create-line-harness`の自己更新経路のみに関係し、このフォークは直接デプロイ運用のため該当なし。cherry-pick時に`pnpm-lock.yaml`含む6箇所でコンフリクト、労力に見合わないため見送り。
    - `a8fb9a5`: 本家自身のGitHub Releaseアーティファクトの整合性検証(`worker_bundle_hash`)。`.github/workflows/release.yml`のみが対象で、このフォークはOSSとしてのリリースを行わないため対象外。
    - `0d0e6a9`: 更新用CLI(`create-line-harness`/`update-engine`)のnpm公開をOIDC信頼発行に変更。このフォークはこれらのパッケージをnpmに公開していないため対象外。
  - **第3段階(新機能)に格下げ**: 当初セキュリティ扱いだったが、実際の中身を見ると大型機能に同梱されていて単独抽出が非現実的だったため、優先度付き機能取り込みの段階でまとめて検討する:
    - `ada3c9d`(資格情報マスキング・監査対応): 実体はクォータ機能・ログ保持機能等を含む43ファイル・3886行の大型sync。資格情報マスキング部分だけを分離するのは非現実的。
    - `b0cd3ed`(fail-open穴の修正): LINEプランクォータ監視機能のレビュー修正の一部で、`ada3c9d`で入るクォータ機能に依存。クォータ機能自体を取り込む際にセットで対応する。
    - `b7010ff`(管理者SSO): 既存の穴を塞ぐ修正ではなく新規追加の認証機能(migration 070・新規route等18ファイル)。バグ修正ではなく新機能として扱う方が実態に合う。マイグレーション047〜069は本家側の未取込機能で埋まっており、取り込み時は採番のやり直しが必要。
- **次のアクション**: `security-sync/stage1`ブランチの内容をユーザーが確認し、問題なければmainにマージ→本番デプロイ→動作確認。完了後に第2段階(バグ修正)に着手する。

## 2026-08-07: 本家(Shudesu/line-harness-oss)との差分調査メモ — マージ等は未実施、今後の別プロジェクトとして検討

- **目的**: 本家(`upstream`リモート、`Shudesu/line-harness-oss`)がこのフォークに対してどれだけ更新されているかを`git fetch upstream`と`git log main..upstream/main`で確認した。**この日はfetchと差分確認のみを行い、マージ・pull・cherry-pickは一切実施していない。**
- **バージョン差**: このフォーク(`apps/worker/package.json`)は`v0.15.0`のまま。本家の最新リリースコミットは`v0.19.0`(`353bc36 chore: release v0.19.0`)。フォーク側が本家より遅れている状態。
- **差分規模**: `git log main..upstream/main --oneline`で**37コミット**未取り込み。`git diff --stat`では**133ファイル変更、+19,441行 / -2,681行**と非常に大きい。ウェビナー機能・アフィリエイト(ASP)機能・LINE APIプロキシなど、本家側で複数の大型機能が追加されている。
- **取り込む価値がありそうなバグ修正**(内容確認のみ、未着手):
  - `6be3b7c`: OAuth stateのエンコードがUTF-8非対応で、日本語UTMパラメータ付きだと`/auth/line`が500になる不具合の修正。
  - `b4d62af`: `/r/:ref`とQR用URLで広告クリックID(gclid/fbclid等)とUTMパラメータが黙って欠落する不具合の修正。
  - `07f7fb0`: 管理画面デプロイCIで`update-engine`のビルド漏れを直す修正。
  - `d70bf5b` / `016375e`: インストーラー・CLIの管理者認証Secret検証まわりの修正。
- **このフォークの独自カスタマイズと衝突リスクが高い箇所**:
  - **マイグレーション番号046の衝突(確定)**: 本家側にも`046_affiliate_links.sql`と`046_link_tracking_controls.sql`の2ファイルが既に存在する。このフォークが今回追加した`046_pending_ref_attribution.sql`と番号がぶつかる。マージする場合は採番のやり直しと、本番`_migrations`テーブルの実データ再確認が必須(過去の`037`番衝突と同種の問題、本ファイル該当箇所参照)。
  - `e989555`(instant first-step push統合): `applyRefAttribution`関数・followハンドラのfriend_add処理・referral-route enrollment・`on_reach_tag_id`のタグ付与を大きく書き換えている。今回このフォークで実施した`webhook.ts`/`liff.ts`のfollow処理・タグ付与修正(`pending_ref_attribution`方式)と同じ箇所を触っており、最も衝突リスクが高い。
  - `webhook.ts`(+402行相当の差分)・`liff.ts`(+628行相当の差分)全体が本家側で大きく書き換わっている。
  - `892c669`(LINE APIプロキシ+tracked-links重複排除+タグページ): entry_routes/tagまわりのカスタマイズと重なる。
  - `friend-tag-attach.ts`: 上記`e989555`・アフィリエイト機能・LINEプロキシ同期の複数コミットで変更されている。
  - `line-accounts.ts`(DB/route両方): マルチアカウント関連。このプロジェクトの現行運用では未使用だが、コード自体は共通のため影響しうる。
- **今後の扱い**: 今回は状況把握のみ。マージ・cherry-pick等の判断は、今回の`pending_ref_attribution`修正の実機効果確認が済んだ後、**別プロジェクトとして**あらためて検討する。着手前には本ファイルのこのエントリを再確認すること。

## 2026-08-07: 流入元タグ不具合(osaka-yuka-form) — 原因確定・修正実装・本番デプロイ完了、実機の最終確認は次の自然な申込み時に実施予定

- **対象**: 本ファイル下部の`2026-08-05: 第三者端末での実機確認と流入元タグ問題`エントリの続報。当時は原因未確定だった`osaka-yuka-form`の流入元タグ不自動付与の原因を特定し、修正を本番デプロイした。
- **調査手順の概要**:
  - `liff.ts`/`webhook.ts`のコードを読み、タグ付与・ref解決に関わる箇所を洗い出した。
  - 個人情報を含まない診断用ログ（`[diag][liff-link] stage=friend-not-found`、`[diag][follow] stage=entry` / `stage=referral-resolved`。内容は内部UUID・ref値・処理段階名のみで、LINE userId等は含めない）を`liff.ts`1箇所・`webhook.ts`2箇所に追加してデプロイ（コミット`bc66190`）。
  - 実機テスト1件（2026-08-06実施、第三者アカウント）の際に`wrangler tail`をファイル保存しながら実行し、その出力とD1の実データ（`friends`/`friend_tags`/`ref_tracking`テーブル）を突き合わせて原因を特定した。
  - `wrangler tail`の生ログにはLINE userIdや位置情報などの個人情報が含まれるため、保存先ファイル（`apps/worker/diag-log.txt`）は`.gitignore`に追加し、リポジトリには一切コミットしていない。ローカルのみに保持し、実機での最終効果確認が取れ次第削除する方針。
- **確定した原因**（推測ではなく、実機テストのログとD1実データで確認済み）:
  1. LIFFフロントエンド（`apps/worker/src/client/main.ts`）は、LIFFページを開いた瞬間（＝ユーザーが「友だち追加」ボタンをタップする前）に`/api/liff/link`をref付きで呼んでいた。この時点では友だちレコードがまだ存在しないため`404 Friend not found`となり、フロントエンド側はこれをリトライしない（ベストエフォート仕様、失敗を握りつぶして先に進む）。
  2. 実際のfollow webhookが友だちレコードを作成するまでの時間差は、実機テストで約10秒だった。`webhook.ts`の既存の`ref_code`再試行（最大5回×200ms≒最大1秒）ではこのギャップに対応できない。
  3. さらに`webhook.ts`のfollowハンドラは、`referralRoute`が解決できた場合でも`entry_routes.tag_id`をタグとして付与する処理自体を持っていなかった（タグ付与は`liff.ts`の`applyRefAttribution`関数のみが行っており、`/auth/callback`と`/api/liff/link`からしか呼ばれない構造だった）。
  - 実機テストでは、`/api/liff/link`が`/webhook`より約10秒先行して404で終了し、`friends.ref_code`がNULLのまま、`friend_tags`も0件のままになることをD1の実データで確認した。
- **修正内容**（コミット`7f9475e`、2026-08-07に`main`へマージ・本番デプロイ済み）:
  - 新テーブル`pending_ref_attribution`（マイグレーション`046_pending_ref_attribution.sql`）を追加。`/api/liff/link`が404の際、`{line_user_id, ref_code}`を一時保存する（first-touch wins、24時間で期限切れ、`line_user_id`以外の個人情報は含めない設計）。
  - `packages/db/src/pending-ref-attribution.ts`に`savePendingRefAttribution` / `consumePendingRefAttribution` / `deleteExpiredPendingRefAttributions`を追加。
  - `webhook.ts`のfollowハンドラに、既存の1秒リトライの後段として`consumePendingRefAttribution`による回収処理を追加（friend_code解決の優先順位: ①follow時点で既にref_code設定済み → ②既存の1秒リトライ → ③新規の保留テーブル回収。矛盾・二重処理が起きないことを実装前に確認済み）。
  - 同ハンドラに`entry_routes.tag_id`を`addTagToFriend`で付与する処理を追加（webhook経由で`referralRoute`が解決された場合に今まで欠けていた処理）。
  - 6時間ごとのcron（`apps/worker/src/index.ts`）に、誰にも回収されなかった保留行の期限切れ削除を接続。
  - 検討したが不採用にした案: `/api/liff/link`側での短い（最大1秒）リトライのみでの対応。実測10秒差を救えないため見送った。
- **テスト**: `packages/db/test/pending-ref-attribution.test.ts`（新規6件）、`apps/worker/src/routes/liff.test.ts`（新規4件、このファイル自体が今回新規作成）、`apps/worker/src/routes/webhook.test.ts`（追記6件）。`tsc --noEmit`・`vitest run`（`packages/db`・`apps/worker`両方）・`pnpm run build`、いずれも成功を確認済み。
- **本番反映状況**（実データで確認済み）:
  - コミット`7f9475e`を`main`へpush済み。GitHub Actions `Deploy Cloudflare Worker`が成功し、workflow内の`Run pending D1 migrations` → `Build Worker and LIFF assets` → `Deploy to Cloudflare Workers`の順で完走したことをジョブのステップ一覧で確認した。
  - 本番D1の`_migrations`テーブルに`046_pending_ref_attribution.sql`が記録済み（`applied_at: 2026-08-07 05:46:59`）、`pending_ref_attribution`テーブルの実在も`sqlite_master`で確認した。
  - 本番Worker `/`はHTTP 200、大阪LINEグループ用・大阪一般用・東京一般用の3導線ともLIFF URL生成（クエリ形式、`46060f6`のリダイレクトループ修正）に影響がないことを機械確認した。
- **未解決・残作業**:
  - 実機での最終効果確認（実際に`osaka-yuka-form`経由で申込みがあった際にタグが付くかどうか）はまだ実施していない。日程調整はせず、**次に`osaka-yuka-form`経由で自然に申込みが発生したタイミング**で確認する方針（2026-08-07時点の決定）。
  - 調査用に追加した診断ログ（`[diag][liff-link] stage=friend-not-found`、`[diag][follow] stage=entry` / `stage=referral-resolved`）は、上記の効果確認が取れるまで**意図的に残している**。効果確認後、削除専用の別コミットで対応する。
  - `apps/worker/diag-log.txt`（`.gitignore`済み、個人情報を含むためコミット・共有しない）も、効果確認後に削除予定。
  - Googleフォームの「不具合対応中」案内文の削除はリポジトリ外の作業としてユーザー側で対応予定（このリポジトリのコード変更は不要）。
  - 利用者名、LINE userId、アクセストークン、Secretsなどの個人情報・機密情報はこのエントリにも記録していない。

## 2026-08-05: LIFF紹介導線のリダイレクトループを修正・本番Deploy済み

- **対象**:
  - 大阪LINEグループ用: `/r/osaka-yuka-form`
  - 大阪一般用: `/r/osaka-general-form`
  - 東京一般用: `/r/tokyo-form`
- **症状**: 第三者端末でWorkers側の固定URL（例:
  `https://line-harness.9kumiko3oka5.workers.dev/r/osaka-yuka-form`）を開くと、
  画面上段の表示が「LINEで開く」と「LINE CRM」で数秒ごとに切り替わり、申込みへ進めない。
- **原因**: コミット`14ba315`で`/r/:ref`のLIFF遷移先を
  `https://liff.line.me/2010944622-92mAoJXV/r/{ref}` のpath形式へ変更したため、
  LIFF起動後もWorkerの同じ`/r/{ref}`ルートを再表示し、Workers中継画面とLIFF本体の間で
  循環する構造になっていた。
- **修正**: コミット`46060f6`
  (`fix(worker): stop LIFF referral redirect loop`)で、Googleフォームに設定済みの
  Workers固定URL `/r/{ref}` は変更せず、`LINEで開く`ボタン・Android intent・PC QRが指す
  LIFF URLだけをquery形式へ戻した。生成例:
  `https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&ref=osaka-yuka-form`。
  `ref`で申込み導線を保持し、`form`/`gate`/`xh`/`ig`も既存どおりLIFF側へ引き継ぐ。
  HTML属性へのURL埋め込みは`&`等をエスケープするようにした。
- **テスト結果（このMac環境で再実行）**:
  - `cd apps/worker && npx vitest run src/ref-route.test.ts` → 4 tests success。
  - `cd apps/worker && npx tsc --noEmit -p .` → success。
  - `cd apps/worker && npx vitest run` → 50 files / 557 tests success。
  - `cd apps/worker && pnpm run build` → success。Wranglerのローカルログ書き込みだけ
    sandbox権限でEPERMが出たが、ビルド自体は終了コード0で生成物作成完了。
- **Deploy結果**: GitHub Actions `Deploy Cloudflare Worker #4`
  （run `30927382864`、commit `46060f6`）がSuccess。workflow内の
  `Run pending D1 migrations`、`Build Worker and LIFF assets`、
  `Deploy to Cloudflare Workers` の各stepもSuccess。
- **本番機械確認**:
  - 本番Worker `/` はHTTP 200で応答。
  - iPhone UAで3導線を取得し、`LINEで開く`のhrefが
    `https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&ref={ref}`
    形式であることを確認。
  - Android UAで3導線を取得し、intent URLとfallback URLが同じquery形式で、
    `2010944622-92mAoJXV/r/{ref}` を含まないことを確認。
  - `?form=lesson-form-id&gate=autumn-2026&ig=ig-session`付きでも、
    3導線すべてで`ref`/`form`/`gate`/`ig`が維持されることを確認。
- **運用メモ**: Googleフォーム側の3つの固定URLは変更不要。第三者実機での最終成功確認は
  機械確認後の残タスクであり、実機成功までは「完全復旧」と断定しない。

## 2026-08-05: 第三者端末での実機確認と流入元タグ問題

- リダイレクトループの修正は完了している。
- 修正コミット`46060f6`は`main`へ反映済みで、本番Deployも成功している。
- 本番WorkerはHTTP 200で応答し、大阪LINEグループ用・大阪一般用・東京一般用の3導線は
  機械的確認済みである。
- 第三者端末から`/r/osaka-yuka-form`を使った実機確認を実施した。
  公式LINEの友だち追加、L-harnessの友だち一覧への登録、「友だち追加あいさつ（全員向け）」
  シナリオの正常配信を確認した。リダイレクトループは再発していない。
- ただし、`osaka-yuka-form`の流入元タグが自動付与されない。異なる第三者2名で同じ現象を
  確認している。
- 未解決箇所は「固定URLの流入情報を取得・保持し、友だち登録後にタグへ反映する処理」に
  限定されている。
- 原因は未確定である。以下は調査候補であり、確定原因ではない。
  - `ref=osaka-yuka-form`がLIFF認証または`liff.state`処理の途中で失われている。
  - 友だち情報作成前にタグ付与APIが実行され、`Friend not found`等で失敗している。
  - 友だち追加Webhook後にタグ付与処理が再実行されていない。
  - タグ付与API自体が呼ばれていない、または別の条件で失敗している。
  - LIFF処理と友だち追加Webhookの実行順序による競合。
- Googleフォームからの公式LINE誘導は、安全確認が完了するまで停止中である。
- 利用者名、LINE userId、アクセストークン、Secretsなどの個人情報・機密情報は記録しない。
- **2026-08-07追記**: 原因確定・修正実装・本番デプロイ完了。詳細は本ファイル最上部の
  `2026-08-07: 流入元タグ不具合(osaka-yuka-form) — 原因確定・修正実装・本番デプロイ完了`
  エントリを参照。実機での最終効果確認は未実施で、次にosaka-yuka-form経由で自然に
  申込みが発生したタイミングで行う方針。

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
