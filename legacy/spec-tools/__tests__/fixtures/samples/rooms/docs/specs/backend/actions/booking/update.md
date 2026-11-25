---
doc_type: action_spec
scope: backend
id: booking-update-action

handles: booking.update

input:
  - booking.id
  - booking.title
  - booking.purpose
  - booking.note
  - booking.starts_at
  - booking.ends_at

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-BOOKING-UPDATE-001
    type: unit
    covers: [success]
    by_role: booking_owner
    spec_ids: [booking.update]
    implementation: app/src/operation/__tests__/booking/update.test.ts::申込者は仮押さえの内容を直せる
  - id: TC-BOOKING-UPDATE-002
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [booking.update]
    implementation: app/src/operation/__tests__/booking/update.test.ts::部門管理者は連絡事項だけを直せる
  - id: TC-BOOKING-UPDATE-003
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [booking.update]
    implementation: app/src/operation/__tests__/booking/update.test.ts::確定済みの予約は申込者でも時間帯を直せない
  - id: TC-BOOKING-UPDATE-004
    type: integration
    covers: [forbidden]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/update.test.ts::無関係の利用者は直せない
  - id: TC-BOOKING-UPDATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-BOOKING-001, INV-BOOKING-002]
    implementation: app/src/composition/__tests__/booking/update.test.ts::時間帯を重なる値へ直すと拒否される
  - id: TC-BOOKING-UPDATE-006
    type: integration
    covers: [conflict]
    spec_ids: [booking.update]
    implementation: app/src/composition/__tests__/booking/update.test.ts::判断後に確定されていた予約の編集は競合として拒否される
---

# 予約の編集（booking.update）

- 部屋の付け替えは受けない（room_id は input に無い） — 部屋が変われば承認者も重複の相手も変わるので、別の予約として取り直す。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
