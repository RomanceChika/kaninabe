---
doc_type: screen_spec
scope: frontend
id: screen-booking-new

name: booking_new
label: 予約する
route: /bookings/new
for: [user]
requires_auth: true

reads: [query-room-list]
actions: [booking.create, booking.confirm]

usecases: [book_room.reserve]

navigations:
  - on: usecase.book_room.reserve.success
    to: screen-booking-list
  - on: cancel
    to: screen-booking-list

overlays:
  - id: reserve_confirm
    layout: { body: { center: [confirm_bar] } }
    opened_by: submit_bar
    actions: [booking.confirm]
    closes_on: [usecase.book_room.reserve.success, cancel]

layout:
  header:
    - page_title:
        label: 予約する
  body:
    center:
      - room_picker
      - reserve_form
  footer:
    - submit_bar

states:
  requires: [loading, error]

test_cases:
  - id: TC-SCREEN-BOOKING_NEW-001
    type: unit
    covers: [other]
    spec_ids: [screen-booking-new, query-room-list]
    implementation: app/src/app/__screens__/booking-new.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-BOOKING_NEW-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-booking-new]
    implementation: app/src/app/__screens__/booking-new.test.tsx::未ログインではログイン画面へ送られる
  - id: TC-SCREEN-BOOKING_NEW-003
    type: unit
    covers: [success]
    spec_ids: [booking.create, booking.confirm]
    implementation: app/src/app/__screens__/booking-new.test.tsx::1 枚のフォームで仮押さえと確定をまとめて送れる
---

# 予約する（booking_new）

- 空き状況の表示はこの画面に置かない — 重なりの判定は保存の瞬間に DB が行うもので、先読みすると画面が不変条件を写し取ることになる。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
