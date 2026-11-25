---
doc_type: query_spec
scope: backend
id: query-item-detail

name: item_detail
for: [patron]
source: item
scope_used: all
returns: one

params:
  - name: item_id
    ref: item.id

filters:
  - id == param.item_id

projection:
  - id
  - title
  - author
  - shelf_code
  - media
  - state

test_cases:
  - id: TC-ITEM-ITEM_DETAIL-001
    type: integration
    covers: [success]
    spec_ids: [query-item-detail]
    implementation: app/src/composition/__tests__/item/item_detail.test.ts::利用者は蔵書の 1 件を読める
---

# 蔵書の詳細（item_detail）

- 貸出履歴は併読しない — 誰が借りたかは利用者側の可視性であり、目録の詳細に混ぜない。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
