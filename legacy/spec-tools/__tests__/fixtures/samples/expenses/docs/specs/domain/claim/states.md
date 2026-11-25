---
doc_type: state_spec
scope: common
id: claim-states
state_machine: claim

states:
  - id: draft
    label: 下書き
  - id: submitted
    label: 提出済み
  - id: approved
    label: 承認済み
  - id: paid
    label: 支払済み
  - id: rejected
    label: 差戻し
    tone: negative
initial: draft
final: [paid, rejected]

events:
  - id: submit
    label: 提出する
    from: [draft]
    to: submitted
    by: [claim_owner]
    otherwise_forbidden: 提出は下書きからのみ。差戻し後は新しい申請として出し直す
  - id: approve
    label: 承認する
    from: [submitted]
    to: approved
    by: [approver]
    guard: claim.total_amount > 0
    otherwise_forbidden: 承認判断は提出済みの申請に対してのみ行う
  - id: reject
    label: 差し戻す
    from: [submitted]
    to: rejected
    by: [approver]
    otherwise_forbidden: 差戻しは提出済みの申請に対してのみ行う
  - id: pay
    label: 支払う
    from: [approved]
    to: paid
    by: [accountant]
    otherwise_forbidden: 支払いは承認済みの申請に対してのみ行う

effects:
  - on: submit
    do: [notify_approver_review_requested]
  - on: pay
    do: [notify_claim_owner_paid]
---

# 経費申請の状態

- 差戻しからの再提出という遷移は作らない — 履歴を残したまま直せると「どの版を承認したか」が
  曖昧になるため、差戻しは終端にして新しい申請として出し直す。
- 支払いの取消し(返金)はこの版では扱わない。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
