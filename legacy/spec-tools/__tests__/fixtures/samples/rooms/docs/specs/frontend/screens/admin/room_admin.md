---
doc_type: screen_spec
scope: frontend
id: screen-room-admin

name: room_admin
label: 部門の会議室
route: /departments/:id/rooms
for: [user]
requires_auth: true

subject: department
precondition: department.admin_id == actor.id
on_fail: redirect(screen-booking-list)

reads: [query-room-list]
actions: [room.create, room.update, room.delete, department.update]

navigations:
  - on: room_selected
    to: screen-room-bookings
  - on: back_to_bookings
    to: screen-booking-list
  - on: room.create.success
    to: screen-room-admin
  - on: room.update.success
    to: screen-room-admin
  - on: room.delete.success
    to: screen-room-admin
  - on: department.update.success
    to: screen-room-admin

overlays:
  - id: delete_dialog
    layout: { body: { center: [delete_bar] } }
    opened_by: room_row_actions
    actions: [room.delete]
    closes_on: [room.delete.success, cancel]

layout:
  header:
    - page_title:
        label: 部門の会議室
    - department_name_form
  body:
    center:
      - room_table
      - variants:
          has_rooms: room_row_actions
          no_rooms: empty_notice
    right:
      - room_create_form

states:
  requires: [loading, empty, error]

test_cases:
  - id: TC-SCREEN-ROOM_ADMIN-001
    type: unit
    covers: [other]
    spec_ids: [screen-room-admin, query-room-list]
    implementation: app/src/app/__screens__/room-admin.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-ROOM_ADMIN-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-room-admin]
    implementation: app/src/app/__screens__/room-admin.test.tsx::管理者でない利用者は自分の予約一覧へ送られる
---

# 部門の会議室（room_admin）

- 部門の切り替えタブは置かない — 1 人が複数部門の管理者になる実例がまだ無い（出たらルートを 1 つ増やす）。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
