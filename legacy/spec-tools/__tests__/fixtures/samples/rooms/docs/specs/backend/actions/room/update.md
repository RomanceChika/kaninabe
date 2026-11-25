---
doc_type: action_spec
scope: backend
id: room-update-action

handles: room.update

input:
  - room.id
  - room.name
  - room.capacity
  - room.has_projector

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ROOM-UPDATE-001
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [room.update]
    implementation: app/src/operation/__tests__/room/update.test.ts::部門管理者は部屋の定員と設備を直せる
  - id: TC-ROOM-UPDATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [room-access]
    implementation: app/src/composition/__tests__/room/update.test.ts::他部門の管理者は直せない
  - id: TC-ROOM-UPDATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-ROOM-001]
    implementation: app/src/composition/__tests__/room/update.test.ts::同じ部門の既存の部屋名へは改名できない
  - id: TC-ROOM-UPDATE-004
    type: integration
    covers: [conflict]
    spec_ids: [room.update]
    implementation: app/src/composition/__tests__/room/update.test.ts::判断後に消えていた部屋の編集は競合として拒否される
---

# 会議室の編集（room.update）

- 所属部門の付け替えは受けない（department_id は input に無い） — 過去の予約の承認者が遡って変わる。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
