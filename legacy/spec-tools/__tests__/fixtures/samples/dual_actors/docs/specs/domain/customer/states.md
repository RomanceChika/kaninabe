---
doc_type: state_spec
scope: common
id: customer-states
state_machine: customer
states:
  - id: provisional
    label: 仮登録
  - id: active
    label: 本登録
  - id: suspended
    label: 停止
    tone: negative
initial: provisional
final: [suspended]
events:
  - id: activate
    label: 本登録する
    from: [provisional]
    to: active
    by: [employee_self]
    otherwise_forbidden: 本登録できるのは仮登録の顧客だけ
  - id: suspend
    label: 停止する
    from: [active]
    to: suspended
    by: [employee_self]
    otherwise_forbidden: 停止できるのは本登録の顧客だけ
---

# 顧客の状態

- 停止からの復帰はこの版では扱わない(終端に置く)。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->
