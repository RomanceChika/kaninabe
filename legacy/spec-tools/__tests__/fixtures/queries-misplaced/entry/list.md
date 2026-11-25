---
doc_type: query_spec
scope: backend
id: query-list

name: list
for: [member]
source: workshop
scope_used: all
returns: many
paging: none
projection: [id, title]

test_cases:
  - id: TC-WORKSHOP-LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-list]
    implementation: app/src/composition/__tests__/workshop/list.test.ts::メンバーは催しを読める
---

# 置き場を間違えた催し一覧（フィクスチャ）

source は workshop なのに entry/ の下にある。ディレクトリ検査（Q0）が落とす対象。
