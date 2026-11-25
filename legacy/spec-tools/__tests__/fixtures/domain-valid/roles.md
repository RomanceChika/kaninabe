---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  - id: anonymous
    label: 未ログイン
    kind: anonymous
  - id: member
    label: ログイン済み一般
    kind: authenticated_default
  - id: system
    kind: system
  - id: performer
    label: 発表者
    binding: "entry.performer_id == actor.id"
  - id: organizer
    label: 世話役
    binding: "workshop.organizer_ids contains actor.id"
---

# ロール定義
