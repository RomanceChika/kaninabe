---
doc_type: state_spec
scope: common
id: sales_order-states
state_machine: sales_order
states:
  - id: awaiting_payment
    label: 入金待ち
  - id: paid
    label: 入金済み
  - id: cancelled
    label: 取消
    tone: negative
initial: awaiting_payment
final: [paid, cancelled]

events:
  - id: pay
    label: 入金を反映する
    from: [awaiting_payment]
    to: paid
    by: [system]
    otherwise_forbidden: 入金の反映は入金待ちの注文にのみ効く(再送の 2 通目は冪等に読み捨てる)
  - id: cancel
    label: 取り消す
    from: [awaiting_payment]
    to: cancelled
    by: [store_manager, company_admin]
    guard: sales_order.company_id == actor.company_id   # 他社の注文は取り消せない(テナント境界。company_admin は会社に依らず立つロールなので、行の会社を結ぶ —— V26)
    otherwise_forbidden: 入金済みの注文は取り消せない(返金は仕組みの外で行う)

effects:
  - on: pay
    do: [notify_payment_received]
---

# 注文の状態

- 「発送済み」を足さない — この仕組みが持つのは入金までで、受け渡しは店頭の仕事である。
- `pay` を人が押せる口は開けない(`by` は system だけ) — 入金の事実の供給元は決済サービスの通知だけである。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
