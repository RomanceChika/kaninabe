---
doc_type: query_spec
scope: backend
id: query-booking-room-list

name: booking_room_list
for: [user]
via: department_admin
source: booking
scope_used: context(department)
returns: many

params:
  - name: room_id
    ref: booking.room_id

filters:
  - room_id == param.room_id
  - state in [draft, confirmed]

sort:
  - starts_at asc

paging: limit(100)

includes:
  - entity: user
    scope_used: all
    projection: [id, display_name]

projection:
  - id
  - reference_no
  - room_id
  - user_id
  - title
  - purpose
  - starts_at
  - ends_at
  - note
  - state

test_cases:
  - id: TC-BOOKING-BOOKING_ROOM_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-booking-room-list]
    implementation: app/src/composition/__tests__/booking/booking_room_list.test.ts::自部門の部屋の予約が申込者つきで開始日時順に返る
  - id: TC-BOOKING-BOOKING_ROOM_LIST-002
    type: integration
    covers: [other]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/booking_room_list.test.ts::他部門の部屋の ID を渡しても 0 件になる
---

# 部屋の予約一覧（booking_room_list）

- 連絡事項を返すのは部門管理者の可視性の上に立っているからであり、利用者一般の経路では返せない。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
