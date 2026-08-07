-- 046_pending_ref_attribution.sql
-- /api/liff/link が friend レコード作成前 (follow webhook 到達前) に ref 付きで
-- 呼ばれた場合、ref を一時的に保存しておくテーブル。follow webhook が friend を
-- 作成した直後にこのテーブルを引いて回収し、friends.ref_code とタグ付与に反映する。
--
-- 個人情報の範囲: line_user_id のみを含む (氏名・トークン・IGSID等は含めない)。
-- 有効期限: 24時間。consumePendingRefAttribution が読み取り時に期限切れなら
-- 無効として扱い、6時間ごとのcronで期限切れ行を削除する。

CREATE TABLE pending_ref_attribution (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- first-touch wins: 同じ line_user_id で2回目以降の保存は INSERT OR IGNORE で無視する
CREATE UNIQUE INDEX idx_pending_ref_attribution_line_user_id
  ON pending_ref_attribution(line_user_id);
