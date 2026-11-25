---
doc_type: query_spec
scope: backend
id: query-own

name: own
for: [member]
via: performer
source: entry
scope_used: own
returns: many
paging: none
projection: [id, title]

test_cases:
  - id: TC-ENTRY-OWN-001
    type: integration
    covers: [success]
    spec_ids: [query-own]
    implementation: app/src/composition/__tests__/entry/own.test.ts::メンバーは自分のエントリーを読める
---

# 自分のエントリー（フィクスチャ）

`for`（観客）と `via`（可視性の供給元）を分けて書いた query_spec。lib/model/query/loader.ts のテスト用。
