---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  - id: anonymous
    label: 未ログイン
    kind: anonymous
  - id: member
    label: メンバー
    kind: authenticated_default
  - id: system
    label: システム
    kind: system
---

# ロール定義(初期化直後の最小構成 — 集約はまだ 1 つも無い)
