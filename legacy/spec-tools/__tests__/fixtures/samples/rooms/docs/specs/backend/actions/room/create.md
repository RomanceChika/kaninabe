---
doc_type: action_spec
scope: backend
id: room-create-action

handles: room.create

input:
  - room.department_id
  - room.name
  - room.capacity
  - room.has_projector

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ROOM-CREATE-001
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [room.create]
    implementation: app/src/operation/__tests__/room/create.test.ts::部門管理者は自部門に部屋を足せる
  - id: TC-ROOM-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [room-access]
    implementation: app/src/composition/__tests__/room/create.test.ts::管理者でない利用者は部屋を足せない
  - id: TC-ROOM-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-ROOM-001]
    implementation: app/src/composition/__tests__/room/create.test.ts::同じ部門に同名の部屋は作れない
---

# 会議室の追加（room.create）

- 他部門の部屋を代理で作る口は開けない — 管理者の binding が部屋の所属部門で立つので、作った瞬間に自分では触れない行ができる。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
