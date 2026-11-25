---
doc_type: query_spec
scope: backend
id: query-item-list

name: item_list
for: [anonymous, patron]
source: item
scope_used: all
returns: many

filters:
  - state != lost                 # 紛失した蔵書は目録に並べない（UX の取捨選択）

sort:
  - title asc
  - id asc

paging: limit(50)

projection:
  - id
  - title
  - author
  - shelf_code
  - media
  - state

test_cases:
  - id: TC-ITEM-ITEM_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-item-list]
    implementation: app/src/composition/__tests__/item/item_list.test.ts::未ログインでも蔵書目録を書名順に読める
---

# 蔵書目録（item_list）

- 紛失を上限で切らない — filters で返す集合そのものを絞る（切ってよい行と悪い行を上限は区別できない）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
