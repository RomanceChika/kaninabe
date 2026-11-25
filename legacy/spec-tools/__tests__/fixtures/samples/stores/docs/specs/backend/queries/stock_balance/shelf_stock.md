---
doc_type: query_spec
scope: backend
id: query-shelf-stock

name: shelf_stock
for: [staff_member]
via: store_manager
source: stock_balance
scope_used: context(store)
returns: many

params:
  - name: shelf_id
    ref: stock_balance.shelf_id

filters:
  - shelf_id == param.shelf_id

includes:
  - entity: product
    scope_used: all
    projection: [id, sku, name]

sort:
  - quantity desc

paging: none
bounded_by:
  parent: shelf
  reason: 1 棚に並ぶ商品の種類は物理的に有界である

projection:
  - id
  - shelf_id
  - product_id
  - quantity
  - updated_at

test_cases:
  - id: TC-STOCK_BALANCE-SHELF_STOCK-001
    type: integration
    covers: [success]
    spec_ids: [query-shelf-stock]
    implementation: app/src/composition/__tests__/stock_balance/shelf_stock.test.ts::店舗責任者は自店舗の棚の残高を読める
  - id: TC-STOCK_BALANCE-SHELF_STOCK-002
    type: integration
    covers: [other]
    spec_ids: [stock_balance-access]
    implementation: app/src/composition/__tests__/stock_balance/shelf_stock.test.ts::他店舗の責任者には 1 件も返らない
---

# 棚の在庫(shelf_stock)

- `via: store_manager` はスコープ条件であって上界ではない — 一般の従業員は `scope: all` で同じ行を読めるので、この経路が絞るのは「責任者として見るとき」の集合だけである。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
