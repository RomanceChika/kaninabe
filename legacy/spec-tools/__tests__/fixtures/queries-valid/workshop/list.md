---
doc_type: query_spec
scope: backend
id: query-list

name: list
for: [member]
source: workshop
scope_used: all

params:
  - name: organizer_id
    ref: workshop.organizer_id

filters:
  - state != draft
  - workshop.organizer_id == param.organizer_id

includes:
  - entity: entry
    scope_used: own
    via: performer
    projection: [id, title]
    sort:
      - title asc
    limit: 20
  - entity: member
    scope_used: all
    projection: [id]

sort:
  - starts_at desc
returns: many
paging: limit(50)
projection: [id, title, starts_at]

test_cases:
  - id: TC-WORKSHOP-LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-list]
    implementation: app/src/composition/__tests__/workshop/list.test.ts::メンバーは催しを読める
---

# 催し一覧（フィクスチャ）

lib/model/query/loader.ts のテスト用の正常な query_spec。
