---
doc_type: action_spec
scope: backend
id: booking-cancel-action

handles: booking.cancel

input:
  - booking.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-BOOKING-CANCEL-001
    type: unit
    covers: [success]
    by_role: booking_owner
    spec_ids: [booking.cancel]
    implementation: app/src/operation/__tests__/booking/cancel.test.ts::申込者は確定済みの予約を取り消せる
  - id: TC-BOOKING-CANCEL-002
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [booking.cancel]
    implementation: app/src/operation/__tests__/booking/cancel.test.ts::部門管理者は自部門の部屋の予約を取り消せる
  - id: TC-BOOKING-CANCEL-003
    type: unit
    covers: [invalid_from]
    spec_ids: [booking.cancel]
    implementation: app/src/operation/__tests__/booking/cancel.test.ts::取消済みの予約はもう取り消せない
  - id: TC-BOOKING-CANCEL-004
    type: integration
    covers: [forbidden]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/cancel.test.ts::無関係の利用者は取り消せない
  - id: TC-BOOKING-CANCEL-005
    type: integration
    covers: [conflict]
    spec_ids: [booking.cancel]
    implementation: app/src/composition/__tests__/booking/cancel.test.ts::判断後に取り消されていた予約の取消は競合として拒否される
---

# 予約の取消（booking.cancel）

- 取消の理由は input で受けない — 残したいなら entity_spec に欄を足す判断が先である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
