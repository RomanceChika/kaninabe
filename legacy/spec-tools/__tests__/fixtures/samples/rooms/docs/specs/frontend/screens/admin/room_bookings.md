---
doc_type: screen_spec
scope: frontend
id: screen-room-bookings

name: room_bookings
label: 会議室の予約状況
route: /rooms/:id/bookings
for: [user]
requires_auth: true

subject: room

reads: [query-booking-room-list]
actions: [booking.confirm, booking.cancel, booking.update]

navigations:
  - on: back_to_rooms
    to: screen-room-admin
  - on: booking.confirm.success
    to: screen-room-bookings
  - on: booking.cancel.success
    to: screen-room-bookings
  - on: booking.update.success
    to: screen-room-bookings

overlays:
  - id: confirm_dialog
    layout: { body: { center: [confirm_bar] } }
    opened_by: booking_row_actions
    actions: [booking.confirm]
    closes_on: [booking.confirm.success, cancel]
  - id: cancel_dialog
    layout: { body: { center: [cancel_bar] } }
    opened_by: booking_row_actions
    actions: [booking.cancel]
    closes_on: [booking.cancel.success, cancel]

layout:
  header:
    - page_title:
        label: 会議室の予約状況
  body:
    center:
      - booking_table
      - variants:
          has_bookings: booking_row_actions
          no_bookings: empty_notice

states:
  requires: [loading, empty, error]

test_cases:
  - id: TC-SCREEN-ROOM_BOOKINGS-001
    type: unit
    covers: [other]
    spec_ids: [screen-room-bookings, query-booking-room-list]
    implementation: app/src/app/__screens__/room-bookings.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-ROOM_BOOKINGS-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-room-bookings]
    implementation: app/src/app/__screens__/room-bookings.test.tsx::未ログインではログイン画面へ送られる
  - id: TC-SCREEN-ROOM_BOOKINGS-003
    type: unit
    covers: [other]
    spec_ids: [booking.confirm, booking.cancel]
    implementation: app/src/app/__screens__/room-bookings.test.tsx::取消済みの行には確定ボタンが出ない
---

# 会議室の予約状況（room_bookings）

- 入場条件を置かない — 部屋の予約が見えるかどうかは読み取り経路（可視性）が決めることであり、画面の関門で表すと二重になる。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
