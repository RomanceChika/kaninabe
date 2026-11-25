---
doc_type: query_spec
scope: backend
id: query-store-layout

name: store_layout
for: [staff_member]
source: section
scope_used: all
returns: many

params:
  - name: store_id
    ref: section.store_id

filters:
  - store_id == param.store_id

includes:
  - entity: shelf
    scope_used: all
    projection: [id, code, is_active, section_id]
    sort: [code asc]

sort:
  - name asc

paging: none
bounded_by:
  parent: store
  reason: 1 店舗の売場は棚札の数で決まり、数十件を超えない

projection:
  - id
  - name
  - store_id

test_cases:
  - id: TC-SECTION-STORE_LAYOUT-001
    type: integration
    covers: [success]
    spec_ids: [query-store-layout]
    implementation: app/src/composition/__tests__/section/store_layout.test.ts::指定した店舗の売場と棚が読める
  - id: TC-SECTION-STORE_LAYOUT-002
    type: integration
    covers: [other]
    spec_ids: [section-access]
    implementation: app/src/composition/__tests__/section/store_layout.test.ts::未ログインでは 1 件も返らない
---

# 店舗の売場と棚(store_layout)

- 棚の併読を店舗で絞らない — 併読の絞り込みは併読先を起点に書くもので、売場を経由した 2 段の条件は書けない(返る棚は売場の鍵で結ぶ)。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
