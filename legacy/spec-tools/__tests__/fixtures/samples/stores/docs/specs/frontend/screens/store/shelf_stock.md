---
doc_type: screen_spec
scope: frontend
id: screen-shelf-stock

name: shelf_stock
label: 棚の在庫
route: /stores/:store_id/shelves/:shelf_id
for: [staff_member]
requires_auth: true

subject: shelf
precondition: is_active == true
on_fail: redirect(screen-store-detail)

reads: [query-shelf-stock]
actions: [stock_receipt.create, stock_move.create]
usecases: [stock_receipt.record_moves]

overlays:
  - id: void_confirm
    layout: { body: { center: [confirm_bar] } }
    opened_by: void_button
    actions: [stock_move.void]
    closes_on: [stock_move.void.success, cancel]

navigations:
  - on: stock_move.create.success
    to: screen-shelf-stock
  - on: stock_move.void.success
    to: screen-shelf-stock
  - on: usecase.stock_receipt.record_moves.success
    to: screen-shelf-stock
  - on: store_detail_link
    to: screen-store-detail

layout:
  header:
    - shelf_heading
  body:
    center:
      - balance_table
      - move_form
    right:
      - recent_move_list
      - void_button

states:
  requires: [loading, empty, error, not_found]

test_cases:
  - id: TC-SCREEN-SHELF_STOCK-001
    type: unit
    covers: [success]
    spec_ids: [screen-shelf-stock]
    implementation: app/src/app/__screens__/shelf-stock.test.tsx::残高の表と記帳フォームが描画される
  - id: TC-SCREEN-SHELF_STOCK-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-shelf-stock]
    implementation: app/src/app/__screens__/shelf-stock.test.tsx::未ログインはログイン画面へ送られる
  - id: TC-SCREEN-SHELF_STOCK-003
    type: unit
    covers: [other]
    spec_ids: [screen-shelf-stock]
    implementation: app/src/app/__screens__/shelf-stock.test.tsx::使用停止の棚では店舗の画面へ送り返される
---

# 棚の在庫(shelf_stock)

- 残高を直接書き換える口は置かない — 残高は移動から導かれる値である。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
