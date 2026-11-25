---
doc_type: query_spec
scope: backend
id: query-desk-hold-list

name: desk_hold_list
for: [librarian]
source: hold
scope_used: all
returns: many

filters:
  - state in [placed, ready]

sort:
  - id asc

paging: limit(50)

projection:
  - id
  - item_id
  - patron_id
  - note
  - state

test_cases:
  - id: TC-HOLD-DESK_HOLD_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-desk-hold-list]
    implementation: app/src/composition/__tests__/hold/desk_hold_list.test.ts::司書は取置待ちの予約を読める
---

# カウンターの予約一覧（desk_hold_list）

- 取消・受取済みは返さない — カウンターの作業対象は受付と取置中の予約だけである。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
