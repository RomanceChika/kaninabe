---
doc_type: screen_spec
scope: frontend
id: screen-product-catalog

name: product_catalog
label: 商品台帳
route: /products
for: [staff_member]
requires_auth: true

reads: [query-product-list]
actions: [product.create, product.update]

navigations:
  - on: product.create.success
    to: screen-product-catalog
  - on: product.update.success
    to: screen-product-catalog
  - on: store_list_link
    to: screen-store-list

layout:
  header:
    - page_title:
        label: 商品台帳
  body:
    center:
      - product_table
      - product_form

states:
  requires: [loading, empty, error]

test_cases:
  - id: TC-SCREEN-PRODUCT_CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [screen-product-catalog]
    implementation: app/src/app/__screens__/product-catalog.test.tsx::商品の表と登録フォームが描画される
  - id: TC-SCREEN-PRODUCT_CATALOG-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-product-catalog]
    implementation: app/src/app/__screens__/product-catalog.test.tsx::未ログインはログイン画面へ送られる
---

# 商品台帳(product_catalog)

- 商品ごとの在庫合計は出さない — 会社の全棚を横断して数える読み取り経路が無い(棚ごとの残高しか持たない)。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
