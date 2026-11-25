---
doc_type: action_spec
scope: backend
id: sales_order-pay-action

handles: sales_order.pay

input:
  - sales_order.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SALES_ORDER-PAY-001
    type: unit
    covers: [success]
    spec_ids: [sales_order.pay]
    implementation: app/src/operation/__tests__/sales_order/pay.test.ts::受信口から system 起点で実行すると入金待ちの注文が入金済みになる
  - id: TC-SALES_ORDER-PAY-002
    type: unit
    covers: [invalid_from]
    spec_ids: [sales_order.pay]
    implementation: app/src/operation/__tests__/sales_order/pay.test.ts::取消済みの注文には入金を反映しない
  - id: TC-SALES_ORDER-PAY-003
    type: integration
    covers: [forbidden]
    spec_ids: [sales_order-access]
    implementation: app/src/composition/__tests__/sales_order/pay.test.ts::人のセッションから実行すると会社管理者でも拒否される
  - id: TC-SALES_ORDER-PAY-004
    type: integration
    covers: [conflict]
    spec_ids: [sales_order.pay]
    implementation: app/src/composition/__tests__/sales_order/pay.test.ts::判断後に取り消されていた注文への入金反映は競合として拒否される
---

# 入金の反映(sales_order.pay)

- **人が押せる口は無い。** `by` は system だけなので、この操作を実行できるのは受信口
  (`external.md` の `payment_notice_webhook` が `emits` する経路)だけである。したがって
  **Server Action は生成されない**(誰でも POST できる口を作っても常に forbidden で終わる)。
- **この action_spec は実行計画の出どころではない。** 受信口は生成された受信の RPC
  (`api.inbound_payment_notice_webhook`。記録と遷移を 1 トランザクションで起こす)を呼ぶので、
  ここが宣言するのは入力と失敗の契約だけである。
- 入力は注文の id だけである — 入金額の照合は受信口が記録する入金通知の側の仕事であり、
  遷移そのものは「この注文が入金済みになった」以上のことを言わない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
