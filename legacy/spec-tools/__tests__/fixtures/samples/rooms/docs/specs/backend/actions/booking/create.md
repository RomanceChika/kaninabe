---
doc_type: action_spec
scope: backend
id: booking-create-action

handles: booking.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: booking.user_id

input:
  - booking.room_id
  - booking.purpose
  - booking.title
  - booking.starts_at
  - booking.ends_at
  - booking.note

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-BOOKING-CREATE-001
    type: unit
    covers: [success]
    by_role: user
    spec_ids: [booking.create]
    implementation: app/src/operation/__tests__/booking/create.test.ts::社内アカウントで仮押さえを作れる
  - id: TC-BOOKING-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/create.test.ts::未ログインからの仮押さえは拒否される
  - id: TC-BOOKING-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-BOOKING-001, INV-BOOKING-002]
    implementation: app/src/composition/__tests__/booking/create.test.ts::同じ部屋の重なる時間帯と、終了が開始より前の入力は拒否される
---

# 仮押さえの作成（booking.create）

- 申込者（user_id）は input で受けない — クライアントに選ばせると他人名義の予約を作れてしまう。
- 予約番号は input に無い — DB が採番する（entity_spec の `supplied_by: db`）。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
