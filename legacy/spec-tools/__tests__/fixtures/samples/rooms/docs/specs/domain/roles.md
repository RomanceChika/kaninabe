---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  # --- グローバルロール ---
  - id: anonymous           # 未ログイン
    label: 未ログイン
    kind: anonymous
  - id: user                # 社内アカウントを持つ人
    label: 利用者
    kind: authenticated_default
  - id: system              # Cron / 内部実行
    label: システム
    kind: system
  # --- 文脈依存ロール ---
  - id: booking_owner       # 対象予約の申込者本人
    label: 予約者
    binding: booking.user_id == actor.id
    implies: [user]
  - id: department_admin    # 対象の部屋を持つ部門の管理者
    label: 部門管理者
    binding: department.admin_id == actor.id
    implies: [user]
---

# ロール定義

- 「全社管理者」は作らない — 部門をまたぐ承認の実例がまだ 1 件も無く、作ると部門管理者の責任範囲が曖昧になる。
- 予約の代理申込みはこの版では扱わない（申込者 = 実行者に固定する）。

<!-- AUTO-GENERATED:role-table -->
<!-- /AUTO-GENERATED:role-table -->
