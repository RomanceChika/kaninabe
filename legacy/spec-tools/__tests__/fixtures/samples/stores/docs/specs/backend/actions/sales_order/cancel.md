---
doc_type: action_spec
scope: backend
id: sales_order-cancel-action

handles: sales_order.cancel

input:
  - sales_order.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SALES_ORDER-CANCEL-001
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [sales_order.cancel]
    implementation: app/src/operation/__tests__/sales_order/cancel.test.ts::店舗責任者は入金待ちの注文を取り消せる
  - id: TC-SALES_ORDER-CANCEL-002
    type: unit
    covers: [success]
    by_role: company_admin
    spec_ids: [sales_order.cancel]
    implementation: app/src/operation/__tests__/sales_order/cancel.test.ts::会社管理者は入金待ちの注文を取り消せる
  - id: TC-SALES_ORDER-CANCEL-003
    type: unit
    covers: [invalid_from]
    spec_ids: [sales_order.cancel]
    implementation: app/src/operation/__tests__/sales_order/cancel.test.ts::入金済みの注文は取り消せない
  - id: TC-SALES_ORDER-CANCEL-004
    type: integration
    covers: [forbidden]
    spec_ids: [sales_order-access]
    implementation: app/src/composition/__tests__/sales_order/cancel.test.ts::受注した本人でも取り消せない
  - id: TC-SALES_ORDER-CANCEL-005
    type: integration
    covers: [conflict]
    spec_ids: [sales_order.cancel]
    implementation: app/src/composition/__tests__/sales_order/cancel.test.ts::判断後に入金が反映されていた注文の取消は競合として拒否される
  # テナント境界(state_spec の guard)—— 会社管理者でも他社の注文は取り消せない
  - id: TC-SALES_ORDER-CANCEL-006
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [sales_order.cancel]
    implementation: app/src/operation/__tests__/sales_order/cancel.test.ts::他社の注文は取り消せない
---

# 注文の取消(sales_order.cancel)

- 返金はこの操作の範囲外(入金済みからの遷移を持たない) — 返金は決済サービス側の操作である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
