---
doc_type: action_spec
scope: backend
id: booking-delete-action

handles: booking.delete

input:
  - booking.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-BOOKING-DELETE-001
    type: unit
    covers: [success]
    by_role: booking_owner
    spec_ids: [booking.delete]
    implementation: app/src/operation/__tests__/booking/delete.test.ts::申込者は仮押さえを消せる
  - id: TC-BOOKING-DELETE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [booking.delete]
    implementation: app/src/operation/__tests__/booking/delete.test.ts::確定済みの予約は消せない（取消で残す）
  - id: TC-BOOKING-DELETE-003
    type: integration
    covers: [forbidden]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/delete.test.ts::他人の仮押さえは消せない
  - id: TC-BOOKING-DELETE-004
    type: integration
    covers: [not_found, conflict]
    spec_ids: [booking.delete]
    implementation: app/src/composition/__tests__/booking/delete.test.ts::既に消えている予約の削除は存在を漏らさず拒否される
---

# 仮押さえの削除（booking.delete）

- 確定済みの予約の消去はここでは扱わない — 履歴を残す取消（booking.cancel）が担当する。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
