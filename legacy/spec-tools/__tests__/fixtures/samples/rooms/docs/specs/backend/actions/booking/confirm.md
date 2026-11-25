---
doc_type: action_spec
scope: backend
id: booking-confirm-action

handles: booking.confirm

input:
  - booking.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-BOOKING-CONFIRM-001
    type: unit
    covers: [success]
    by_role: booking_owner
    spec_ids: [booking.confirm]
    implementation: app/src/operation/__tests__/booking/confirm.test.ts::申込者は自分の仮押さえを確定できる
  - id: TC-BOOKING-CONFIRM-002
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [booking.confirm]
    implementation: app/src/operation/__tests__/booking/confirm.test.ts::部門管理者は自部門の部屋の仮押さえを確定できる
  - id: TC-BOOKING-CONFIRM-003
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [booking.confirm]
    implementation: app/src/operation/__tests__/booking/confirm.test.ts::開始時刻を過ぎた仮押さえは確定できない
  - id: TC-BOOKING-CONFIRM-004
    type: unit
    covers: [invalid_from]
    spec_ids: [booking.confirm]
    implementation: app/src/operation/__tests__/booking/confirm.test.ts::取消済みの予約は確定できない
  - id: TC-BOOKING-CONFIRM-005
    type: integration
    covers: [forbidden]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/confirm.test.ts::他部門の利用者は確定できない
  - id: TC-BOOKING-CONFIRM-006
    type: integration
    covers: [invariant]
    spec_ids: [INV-BOOKING-001]
    implementation: app/src/composition/__tests__/booking/confirm.test.ts::同じ時間帯に確定済みの予約があれば確定は拒否される
  - id: TC-BOOKING-CONFIRM-007
    type: integration
    covers: [conflict]
    spec_ids: [booking.confirm]
    implementation: app/src/composition/__tests__/booking/confirm.test.ts::判断後に取り消されていた予約の確定は競合として拒否される
---

# 予約の確定（booking.confirm）

- 確定の理由や連絡事項は input で受けない — 書き足したいなら booking.update で連絡事項を編集する。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
