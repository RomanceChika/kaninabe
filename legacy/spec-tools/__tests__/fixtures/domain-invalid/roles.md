---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  - id: member
  - binding: "entry.performer_id == actor.id"
  - id: organizer
---

# 壊れたロール定義（id の無いロールがある）
