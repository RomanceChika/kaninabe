---
doc_type: screen_spec
scope: frontend
id: screen-booking-list

name: booking_list
label: 自分の予約
route: /bookings
for: [user]
entry_point: true
requires_auth: true

reads: [query-booking-own-list]
actions: [booking.confirm, booking.cancel, booking.delete, booking.update]

navigations:
  - on: new_booking
    to: screen-booking-new
  - on: my_department
    to: screen-room-admin
  - on: booking.confirm.success
    to: screen-booking-list
  - on: booking.cancel.success
    to: screen-booking-list
  - on: booking.delete.success
    to: screen-booking-list
  - on: booking.update.success
    to: screen-booking-list

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
  - id: delete_dialog
    layout: { body: { center: [delete_bar] } }
    opened_by: booking_row_actions
    actions: [booking.delete]
    closes_on: [booking.delete.success, cancel]

layout:
  header:
    - page_title:
        label: 自分の予約
  body:
    center:
      - booking_table
      - variants:
          has_bookings: booking_row_actions
          no_bookings: empty_notice

states:
  requires: [loading, empty]

test_cases:
  - id: TC-SCREEN-BOOKING_LIST-001
    type: unit
    covers: [other]
    spec_ids: [screen-booking-list, query-booking-own-list]
    implementation: app/src/app/__screens__/booking-list.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-BOOKING_LIST-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-booking-list]
    implementation: app/src/app/__screens__/booking-list.test.tsx::未ログインではログイン画面へ送られる
  - id: TC-SCREEN-BOOKING_LIST-003
    type: unit
    covers: [other]
    spec_ids: [booking.cancel, booking.delete]
    implementation: app/src/app/__screens__/booking-list.test.tsx::確定済みの行には削除ボタンが出ない
---

# 自分の予約（booking_list）

- 取消済みの行を出す切替は置かない — 読み取り経路が返さないものを画面の都合で足せない。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
