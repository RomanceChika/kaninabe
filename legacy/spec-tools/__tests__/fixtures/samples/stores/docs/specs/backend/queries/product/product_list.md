---
doc_type: query_spec
scope: backend
id: query-product-list

name: product_list
for: [staff_member]
source: product
scope_used: all
returns: many

params:
  - name: sku_prefix
    ref: product.sku

filters:
  - sku >= param.sku_prefix

sort:
  - sku asc

paging: limit(100)

projection:
  - id
  - sku
  - name
  - unit_price

test_cases:
  - id: TC-PRODUCT-PRODUCT_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-product-list]
    implementation: app/src/composition/__tests__/product/product_list.test.ts::従業員は商品の一覧を商品コード順に読める
  - id: TC-PRODUCT-PRODUCT_LIST-002
    type: integration
    covers: [other]
    spec_ids: [product-access]
    implementation: app/src/composition/__tests__/product/product_list.test.ts::未ログインでは 1 件も返らない
---

# 商品の一覧(product_list)

- 部分一致の検索は書けない — 式の演算子に前方一致が無く、比較の 6 種だけである(先頭の商品コードで位置を決める形にした)。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
