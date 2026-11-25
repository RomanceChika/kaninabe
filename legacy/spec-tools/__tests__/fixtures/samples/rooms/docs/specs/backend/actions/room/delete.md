---
doc_type: action_spec
scope: backend
id: room-delete-action

handles: room.delete

input:
  - room.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ROOM-DELETE-001
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [room.delete]
    implementation: app/src/operation/__tests__/room/delete.test.ts::予約の無い部屋は消せる
  - id: TC-ROOM-DELETE-002
    type: integration
    covers: [forbidden]
    spec_ids: [room-access]
    implementation: app/src/composition/__tests__/room/delete.test.ts::他部門の管理者は消せない
  - id: TC-ROOM-DELETE-003
    type: integration
    covers: [not_found, conflict]
    spec_ids: [room.delete]
    implementation: app/src/composition/__tests__/room/delete.test.ts::既に消えている部屋の削除は存在を漏らさず拒否される
  - id: TC-ROOM-DELETE-004
    type: integration
    covers: [invariant]
    spec_ids: [INV-ROOM-002]
    implementation: app/src/composition/__tests__/room/delete.test.ts::予約の入っている部屋は消せない
---

# 会議室の削除（room.delete）

- 「使用停止」の状態は持たないので、間違えて登録した部屋の消し込みだけがこの操作の用途である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
