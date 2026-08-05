# Claude Code引き継ぎ資料: 固定URLの流入元タグ問題

## まず読むもの

- リポジトリ: `9kumiko3oka5-jpg/line-harness-oss`
- 進捗の正本: `docs/PROJECT_STATUS.md`
- 既知の最新復旧記録コミット: `1d92998`
- リダイレクト修正コミット: `46060f6`
- 作業開始時は`AGENTS.md`、`CLAUDE.md`、この資料、`git status`を確認する。
- CodexとClaude Codeを同時に編集させない。どちらか一方の作業が終わり、差分を確認して
  から次のツールへ引き継ぐ。

## 現在の状態

リダイレクトループの修正は完了している。`46060f6`は`main`へ反映済みで、本番Deployも
成功している。本番WorkerはHTTP 200で応答し、次の3導線は機械的に確認済みである。

- 大阪LINEグループ用: `/r/osaka-yuka-form`
- 大阪一般用: `/r/osaka-general-form`
- 東京一般用: `/r/tokyo-form`

第三者端末から`/r/osaka-yuka-form`を使った実機確認も実施済みで、次を確認できた。

- リダイレクトループは再発していない。
- 公式LINEの友だち追加に成功した。
- L-harnessの友だち一覧への登録に成功した。
- 「友だち追加あいさつ（全員向け）」シナリオが正常配信された。

一方、`osaka-yuka-form`に対応する流入元タグは自動付与されなかった。この現象は異なる
第三者2名で確認済みである。未解決箇所は、固定URLの流入情報を取得・保持し、友だち登録後に
タグへ反映する処理に限定される。原因は未確定であり、以下は調査候補であって確定原因ではない。

- `ref=osaka-yuka-form`がLIFF認証または`liff.state`処理の途中で失われている。
- 友だち情報作成前にタグ付与APIが実行され、`Friend not found`等で失敗している。
- 友だち追加Webhook後にタグ付与処理が再実行されていない。
- タグ付与API自体が呼ばれていない、または別の条件で失敗している。
- LIFF処理と友だち追加Webhookの実行順序による競合。

Googleフォームからの公式LINE誘導は、安全確認が完了するまで停止中である。利用者名、LINE
userId、アクセストークン、Secretsなどの個人情報・機密情報は、この資料・ログ・GitHubへ
記録しない。

## 最初に確認する処理経路

1. `apps/worker/src/index.ts`
   - `/r/:ref`の固定URLが、LIFF URLへどの形式で`ref`を引き継ぐか確認する。
   - `46060f6`の変更を基準に、LIFF path形式へ戻す変更をしない。
2. `apps/worker/src/routes/liff.ts`
   - `auth/callback`の`ref`取得、`friends.ref_code`保存、`recordRefTracking`、
     `applyRefAttribution`呼び出しを確認する。
   - `/api/liff/link`の既存友だち・新規リンク双方で`body.ref`が保持されるか確認する。
   - `applyRefAttribution`内の`getEntryRouteByRefCode`、`effectiveTagId`、
     `addTagToFriend`の順序と例外処理を確認する。
3. `apps/worker/src/routes/webhook.ts`
   - followイベントで友だちを作成・更新する処理を確認する。
   - `friends.ref_code`を待つリトライ、entry route解決、友だち追加シナリオ、
     挨拶配信の順序を確認する。
4. `packages/db/src/entry-routes.ts`
   - `getEntryRouteByRefCode`がactiveな`ref_code`を解決すること、`tag_id`が設定されている
     こと、`recordRefTracking`のfriend紐付けを確認する。
5. `packages/db/src/tags.ts`と`apps/worker/src/services/friend-tag-attach.ts`
   - `friend_tags`の一意制約と`INSERT OR IGNORE`による重複防止を確認する。
   - 自動付与では新規付与時だけtag-change side effectが発火することを維持する。
6. 関連テスト
   - `apps/worker/src/routes/ref-route.test.ts`
   - `apps/worker/src/routes/liff.test.ts`
   - `apps/worker/src/routes/webhook.test.ts`
   - `apps/worker/src/services/friend-tag-attach.test.ts`（存在する場合）

## ログとD1で確認する項目

実機テストは新しい第三者アカウントを1件ずつ使い、個人情報をログや資料へ転記しない。
Worker/D1の管理画面または権限のあるログ確認で、次の相関だけを確認する。

- 固定URLアクセスからLIFF起動まで、`ref`がどの時点で存在するか。
- `/auth/callback`または`/api/liff/link`に届いたrefの有無と値が、想定導線と一致するか。
- `getEntryRouteByRefCode`が`osaka-yuka-form`のrouteを解決したか。
- `friends.ref_code`が友だち作成前後のどの時点で保存されたか。
- `recordRefTracking`に`ref_code`、`entry_route_id`、`friend_id`が保存されたか。
- `applyRefAttribution`が実行され、`effectiveTagId`を得たか。
- `addTagToFriend`または同等のタグ付与処理が成功したか、例外が出ていないか。
- follow Webhookが先行・後行した場合の両方で、処理が再試行されるか。
- `friend_tags`に対象タグが1件だけ存在するか。`messages_log`で全員向け挨拶が1回だけ
  配信されたか。

ログへ出す場合も、利用者名、LINE userId、アクセストークン、Secrets、認証トークンを出さず、
導線名・処理段階・成功/失敗・匿名化した内部相関IDだけにする。

## 修正時に守る既存動作

- `/r/osaka-yuka-form`、`/r/osaka-general-form`、`/r/tokyo-form`の固定URLを変更しない。
- `46060f6`で解消したリダイレクトループを再発させない。LIFF URLはquery形式の`ref`を
  維持し、`/r/{ref}`のpath形式へ戻さない。
- 公式LINEの友だち追加、L-harnessの友だち一覧登録、全員向け友だち追加あいさつを維持する。
- `friend_tags`の一意性と冪等性を維持し、タグを重複付与しない。
- 大阪一般用・東京一般用など他の固定URLへ影響を出さない。
- エラー時に無限リダイレクト、無限リトライ、重複配信を発生させない。
- Googleフォーム誘導は安全確認完了まで再開しない。
- Cloudflare設定、LINE Developers設定、Secrets、本番環境を調査以外の理由で変更しない。

## 受入条件

1. 新規の第三者LINEアカウントが`/r/osaka-yuka-form`からアクセスできる。
2. リダイレクトループが起きない。
3. 公式LINEの友だち追加ができる。
4. L-harnessへ友だち登録される。
5. `osaka-yuka-form`に対応する流入元タグが自動付与される。
6. タグが重複付与されない。
7. 全員向けの友だち追加あいさつが従来どおり配信される。
8. 大阪一般用・東京一般用など他の固定URLに悪影響がない。
9. エラー時にも無限ループや重複配信が起きない。

## テストと本番反映

コードを変更する場合は、まず対象ユニットテストを追加・更新し、次を実行する。

```sh
cd apps/worker
npx tsc --noEmit -p .
npx vitest run
pnpm run build
```

最低限、3つの固定URLのref保持、LIFF callback/linkのタグ付与、follow Webhookとの順序競合、
同一タグの二重実行、挨拶配信の重複防止、エラー時の有限終了をテストする。コード変更を本番へ
反映する前後には、main上のコミット、GitHub Actionsの対象run、D1 migrationの適用状態、
本番Worker HTTP 200、3導線の機械確認、第三者端末での受入条件を確認する。今回の作業では
アプリコード・Cloudflare・LINE Developers・Secrets・本番環境を変更しない。

## ロールバック確認

反映前に、対象DeployのworkflowとCloudflare Workerの現行versionを確認する。問題が出た場合は
force pushや履歴書き換えをせず、原因を記録したうえで、GitHub上の既知の正常コミットへ戻す
revertコミットを作成して通常のreview/Deploy経路で反映する。緊急時にCloudflare Dashboard
から直前versionへ戻せる権限・手順があるかも、Secrets値を記録せずに事前確認する。ロールバック
後はHTTP 200、リダイレクトループなし、友だち追加、挨拶配信、他導線への影響を再確認する。

## 協業ルール

- 進捗の正本は常に`docs/PROJECT_STATUS.md`とする。
- 作業開始時と終了時に`git status`と差分を確認する。
- 変更対象を明示し、`git add .`や`git add -A`を使わない。
- `.playwright-mcp/`など無関係な既存未追跡ファイルを削除・編集・移動・stash・コミット
  しない。
- CodexとClaude Codeを同時に編集させない。片方が作業中なら、もう片方は編集を開始しない。
