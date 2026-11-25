---
doc_type: state_spec
scope: common
id: loan-states
state_machine: loan
states:
  - id: requested
    label: 受取待ち
  - id: checked_out
    label: 貸出中
  - id: overdue
    label: 延滞
    tone: negative
  - id: returned
    label: 返却済み
initial: requested
final: [returned]
events:
  - id: check_out
    label: 受け取る
    from: [requested]
    to: checked_out
    by: [librarian, loan_owner]
    otherwise_forbidden: 受け取れるのは受取待ちの貸出だけ(返却済みの再受取は新しい貸出として扱う)
  - id: report_overdue
    label: 延滞として記録する
    from: [checked_out]
    to: overdue
    by: [librarian]
    guard: now > loan.due_at
    otherwise_forbidden: 延滞に至るのは貸出中の貸出だけ
  - id: return_item
    label: 返却する
    from: [checked_out, overdue]
    to: returned
    by: [librarian, loan_owner]
    otherwise_forbidden: 返却できるのは受け取り済みの貸出だけ

effects:
  - on: report_overdue
    do: [notify_overdue_patron]
---

# 貸出の状態

- 「紛失」の状態は貸出に持たせない — 失われるのは蔵書であって貸出の記録ではない(蔵書側の状態)。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
