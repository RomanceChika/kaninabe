---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  # --- グローバルロール ---
  - id: anonymous         # 未ログイン(蔵書目録は公開)
    label: 未ログイン
    kind: anonymous
  - id: patron            # 利用者カードを持つ人
    label: 利用者
    kind: authenticated_default
  - id: librarian         # 司書。根拠は実行者自身の行の欄(セッションに載る)
    label: 司書
    claim: patron.is_librarian
    implies: [patron]
  - id: system            # Webhook / Cron からの内部実行
    label: システム
    kind: system
  # --- 文脈依存ロール ---
  - id: loan_owner        # 対象の貸出を借りた本人
    label: 借受本人
    binding: loan.patron_id == actor.id
    implies: [patron]
  - id: hold_owner        # 対象の予約をかけた本人
    label: 予約本人
    binding: hold.patron_id == actor.id
    implies: [patron]
---

# ロール定義

- 館長・管理者のような上位ロールは作らない — 司書の任免は利用者の欄(is_librarian)が正で、「上位の 1 人」を仕様に刻まない。
- 書架の棚番ごとの担当ロールは作らない — 担当は運用の割り当てであって、権限の軸ではない。

<!-- AUTO-GENERATED:role-table -->
| ロールID | 名前 | 種別 | binding | 含意するロール |
| --- | --- | --- | --- | --- |
| anonymous | 未ログイン | グローバル | — | — |
| patron | 利用者 | グローバル | — | — |
| librarian | 司書 | グローバル | — | patron |
| system | システム | グローバル | — | — |
| loan_owner | 借受本人 | 文脈依存 | `loan.patron_id == actor.id` | patron |
| hold_owner | 予約本人 | 文脈依存 | `hold.patron_id == actor.id` | patron |
<!-- /AUTO-GENERATED:role-table -->
