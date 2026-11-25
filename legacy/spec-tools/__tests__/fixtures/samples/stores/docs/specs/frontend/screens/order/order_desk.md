---
doc_type: screen_spec
scope: frontend
id: screen-order-desk

name: order_desk
label: 受注デスク
route: /orders
for: [staff_member]
requires_auth: true

reads: [query-order-list]
actions: [sales_order.create]
usecases: [order_intake.place_order]

overlays:
  - id: cancel_confirm
    layout: { body: { center: [confirm_bar] } }
    opened_by: cancel_button
    actions: [sales_order.cancel]
    closes_on: [sales_order.cancel.success, cancel]

navigations:
  - on: sales_order.create.success
    to: screen-order-desk
  - on: sales_order.cancel.success
    to: screen-order-desk
  - on: usecase.order_intake.place_order.success
    to: screen-order-desk
  - on: store_list_link
    to: screen-store-list

layout:
  header:
    - page_title:
        label: 受注デスク
  body:
    center:
      - awaiting_payment_table
      - cancel_button
      - order_form

states:
  requires: [loading, empty, error]

test_cases:
  - id: TC-SCREEN-ORDER_DESK-001
    type: unit
    covers: [success]
    spec_ids: [screen-order-desk]
    implementation: app/src/app/__screens__/order-desk.test.tsx::入金待ちの一覧と受注フォームが描画される
  - id: TC-SCREEN-ORDER_DESK-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-order-desk]
    implementation: app/src/app/__screens__/order-desk.test.tsx::未ログインはログイン画面へ送られる
---

# 受注デスク(order_desk)

- 入金の反映ボタンは置かない — `sales_order.pay` の `by` は system だけであり、人が押せる口はドメインに無い。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
