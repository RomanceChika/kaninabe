---
doc_type: usecase_spec
scope: frontend
id: usecase-order-intake

name: order_intake
goal: 注文を受けて入金を待つ
actor: staff_member
start: screen-order-desk
done: sales_order.state == awaiting_payment

saves:
  - id: place_order
    label: 注文を登録する
    migration: 20260911000002_usecase_order_intake_place_order.sql
    steps:
      - op: sales_order.create

test_cases:
  - id: TC-USECASE-ORDER_INTAKE-001
    type: integration
    covers: [success]
    spec_ids: [usecase-order-intake]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::order_intake.place_order の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-ORDER_INTAKE-002
    type: integration
    covers: [success]
    spec_ids: [usecase-order-intake]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::同じ冪等キーで送り直しても注文の行は増えない
  # 保存点の decide ⇔ 複合 RPC の一致の証明(束 ⑳-5a2)も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  # /AUTO-GENERATED:usecase-eq-tests
---

# 受注(注文を受けて入金を待つ)

- `done` を `paid` にできない — 入金は外から届く事実であり、人の操作の列では到達しない(達成条件は「入金待ちになったこと」まで)。
