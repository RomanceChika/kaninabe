---
doc_type: query_spec
scope: backend
id: query-booking-own-list

name: booking_own_list
for: [user]
via: booking_owner
source: booking
scope_used: own
returns: many

filters:
  - state in [draft, confirmed]

sort:
  - starts_at asc

paging: none
bounded_by: window

includes:
  - entity: room
    scope_used: all
    projection: [id, name]

projection:
  - id
  - reference_no
  - room_id
  - title
  - purpose
  - starts_at
  - ends_at
  - state

test_cases:
  - id: TC-BOOKING-BOOKING_OWN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-booking-own-list]
    implementation: app/src/composition/__tests__/booking/booking_own_list.test.ts::自分の仮押さえと確定が開始日時順に返る
  - id: TC-BOOKING-BOOKING_OWN_LIST-002
    type: integration
    covers: [other]
    spec_ids: [booking-access]
    implementation: app/src/composition/__tests__/booking/booking_own_list.test.ts::部門管理者として他人の予約が見える人が呼んでも、自分の予約しか返らない
---

# 自分の予約一覧（booking_own_list）

- 取消済みを上限で切らない — 返す集合そのものを状態で絞る（履歴の閲覧は将来の別クエリで受ける）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
