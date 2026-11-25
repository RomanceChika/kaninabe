---
doc_type: action_spec
scope: backend
id: sales_order-create-action

handles: sales_order.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: sales_order.placed_by

input:
  - sales_order.store_id
  - sales_order.total_amount
  - sales_order.customer_name

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SALES_ORDER-CREATE-001
    type: unit
    covers: [success]
    by_role: staff_member
    spec_ids: [sales_order.create]
    implementation: app/src/operation/__tests__/sales_order/create.test.ts::従業員は入金待ちの注文を作れる
  - id: TC-SALES_ORDER-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [sales_order-access]
    implementation: app/src/composition/__tests__/sales_order/create.test.ts::未ログインからの受注は拒否される
  - id: TC-SALES_ORDER-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-SALES-ORDER-001]
    implementation: app/src/composition/__tests__/sales_order/create.test.ts::注文番号は会社の中で重複しない
  # テナント境界(access_spec の creates[].when)—— 他社の store_id を渡した作成が拒否される
  - id: TC-SALES_ORDER-CREATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [sales_order-access]
    implementation: app/src/composition/__tests__/sales_order/create.test.ts::他社の店舗への受注は拒否される
  # 判断したときの前提を条件に書き込む(OCC)—— 会社が作成中に変わっていた実行は競合になる
  - id: TC-SALES_ORDER-CREATE-005
    type: integration
    covers: [conflict]
    spec_ids: [sales_order.create]
    implementation: app/src/composition/__tests__/sales_order/create.test.ts::判断のあとに実行者の会社が変わっていた受注は競合になる
---

# 注文の作成(sales_order.create)

- `order_no` は input に無い(DB が採番する — supplied_by: db)。人に入力させると決済サービスとの照合キーが人の手で壊れる。
- 入金の反映まで 1 つの操作にしない — 入金は外から届く事実であり、この操作の中では起きない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
