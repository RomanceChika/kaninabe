---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  # --- グローバルロール ---
  - id: anonymous             # 未ログイン
    label: 未ログイン
    kind: anonymous
  - id: staff_member          # 会社に所属する従業員
    label: 従業員
    kind: authenticated_default
  - id: system                # 受信 Webhook / 定期実行
    label: システム
    kind: system
  - id: company_admin         # 根拠は実行者自身の行の欄(セッションに載る)
    label: 会社管理者
    claim: staff_member.is_admin
    implies: [staff_member]
  # --- 文脈依存ロール ---
  - id: store_manager         # 対象の店舗の責任者
    label: 店舗責任者
    binding: store.manager_id == actor.id
    implies: [staff_member]
---

# ロール定義

- 「売場主任」は作らない — 売場ごとに責任者を置く実例がまだ無く、置くと棚の束縛が 3 段になる。
- 会社をまたいで見る監査役のロールはこの版では扱わない(会社の境界を跨ぐ読み取りの実例が無い)。

<!-- AUTO-GENERATED:role-table -->
<!-- /AUTO-GENERATED:role-table -->
