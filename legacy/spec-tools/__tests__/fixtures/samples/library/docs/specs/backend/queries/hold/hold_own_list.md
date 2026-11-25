---
doc_type: query_spec
scope: backend
id: query-hold-own-list

name: hold_own_list
for: [patron]
via: hold_owner
source: hold
scope_used: own
returns: many

filters:
  - state in [placed, ready]

includes:
  - entity: item
    scope_used: all
    projection: [id, title, author]

sort:
  - id asc

paging: none
bounded_by: window

projection:
  - id
  - item_id
  - state

test_cases:
  - id: TC-HOLD-HOLD_OWN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-hold-own-list]
    implementation: app/src/composition/__tests__/hold/hold_own_list.test.ts::利用者は自分の有効な予約だけを読める
  - id: TC-HOLD-HOLD_OWN_LIST-002
    type: integration
    covers: [other]
    spec_ids: [hold-access]
    implementation: app/src/composition/__tests__/hold/hold_own_list.test.ts::司書として他人の予約が見えている状況でも自分の予約しか返らない
---

# 自分の予約（hold_own_list）

- 連絡事項は返さない — カウンターへの連絡であり、予約者本人の一覧には出さない（fields_hidden）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
