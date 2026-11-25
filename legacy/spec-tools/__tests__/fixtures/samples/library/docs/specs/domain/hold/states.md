---
doc_type: state_spec
scope: common
id: hold-states
state_machine: hold
states:
  - id: placed
    label: 受付
  - id: ready
    label: 取置中
  - id: collected
    label: 受取済み
  - id: cancelled
    label: 取消
    tone: negative
initial: placed
final: [collected, cancelled]
events:
  - id: prepare
    label: 取り置く
    from: [placed]
    to: ready
    by: [librarian]
    guard: item.state == available
    otherwise_forbidden: 取り置けるのは受付済みの予約だけ
  - id: collect
    label: 受け取る
    from: [ready]
    to: collected
    by: [librarian, hold_owner]
    otherwise_forbidden: 受け取れるのは取置中の予約だけ
  - id: cancel
    label: 取り消す
    from: [placed, ready]
    to: cancelled
    by: [hold_owner, librarian]
    otherwise_forbidden: 受取済みの予約は取り消せない(取消は取り置きまでの間だけ)
---

# 予約の状態

- 「期限切れ」の状態は置かない — 取置の期限が過ぎたら司書が取り消す(自動の走査はこの版で持たない)。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
