---
doc_type: query_spec
scope: backend
id: query-order-list

name: order_list
for: [staff_member]
source: sales_order
scope_used: all
returns: many

params:
  - name: store_id
    ref: sales_order.store_id

filters:
  - store_id == param.store_id
  - state == awaiting_payment

sort:
  - created_at desc

paging: limit(50)

projection:
  - id
  - order_no
  - total_amount
  - state
  - store_id

test_cases:
  - id: TC-SALES_ORDER-ORDER_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-order-list]
    implementation: app/src/composition/__tests__/sales_order/order_list.test.ts::入金待ちの注文が新しい順に読める
  - id: TC-SALES_ORDER-ORDER_LIST-002
    type: integration
    covers: [other]
    spec_ids: [sales_order-access]
    implementation: app/src/composition/__tests__/sales_order/order_list.test.ts::注文者名は射影に現れない
---

# 入金待ちの注文(order_list)

- 注文者名は返せない(`fields_hidden` が staff_member から隠している) — 受け渡しの照合は注文番号で行う。
- 入金済み・取消の履歴はこの経路では返さない(`filters` が集合そのものを絞る)。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
