---
doc_type: screen_spec
scope: frontend
id: screen-store-list

name: store_list
label: 店舗一覧
route: /stores
for: [staff_member]
entry_point: true
requires_auth: true

reads: [query-store-list]
actions: [store.create]

navigations:
  - on: store.create.success
    to: screen-store-list
  - on: store_selected
    to: screen-store-detail
  - on: order_desk_link
    to: screen-order-desk
  - on: product_catalog_link
    to: screen-product-catalog

layout:
  header:
    - page_title:
        label: 店舗一覧
  body:
    center:
      - store_table
      - variants:
          can_create: store_form
          read_only: store_form_locked

states:
  requires: [loading, empty]

test_cases:
  - id: TC-SCREEN-STORE_LIST-001
    type: unit
    covers: [success]
    spec_ids: [screen-store-list]
    implementation: app/src/app/__screens__/store-list.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-STORE_LIST-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-store-list]
    implementation: app/src/app/__screens__/store-list.test.tsx::未ログインには 404 を返す(公開の入口を 1 枚も持たない)
---

# 店舗一覧(store_list)

- 会社の切り替え口は置かない — 1 セッションが複数の会社に属する形をドメインが持たない。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
