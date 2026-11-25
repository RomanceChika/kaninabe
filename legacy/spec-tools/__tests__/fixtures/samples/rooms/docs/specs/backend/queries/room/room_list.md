---
doc_type: query_spec
scope: backend
id: query-room-list

name: room_list
for: [user]
source: room
scope_used: all
returns: many

params:
  - name: department_id
    ref: room.department_id

filters:
  - department_id == param.department_id

sort:
  - name asc
  - id asc

paging: limit(100)

projection:
  - id
  - department_id
  - name
  - capacity
  - has_projector

test_cases:
  - id: TC-ROOM-ROOM_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-room-list]
    implementation: app/src/composition/__tests__/room/room_list.test.ts::部門を指定すると、その部門の部屋が名前順に返る
  - id: TC-ROOM-ROOM_LIST-002
    type: integration
    covers: [other]
    spec_ids: [room-access]
    implementation: app/src/composition/__tests__/room/room_list.test.ts::未ログインでは 1 件も返らない
---

# 部門の会議室一覧（room_list）

- 空き状況はこの経路では返さない — 空きは予約の側の事実であり、部屋の一覧に混ぜると「いつの空きか」が宣言から消える。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
