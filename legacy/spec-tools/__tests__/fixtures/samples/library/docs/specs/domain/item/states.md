---
doc_type: state_spec
scope: common
id: item-states
state_machine: item
states:
  - id: available
    label: 在架
  - id: on_loan
    label: 貸出中
  - id: lost
    label: 紛失
    tone: negative
initial: available
final: [lost]
events:
  - id: lend
    label: 貸し出す
    from: [available]
    to: on_loan
    by: [patron, librarian]
    otherwise_forbidden: 貸出中・紛失の蔵書は貸し出せない(再貸出は返却してから)
  - id: shelve
    label: 返架する
    from: [on_loan]
    to: available
    by: [patron, librarian]
    otherwise_forbidden: 返架できるのは貸出中の蔵書だけ
  - id: report_lost
    label: 紛失として記録する
    from: [available, on_loan]
    to: lost
    by: [librarian]
    otherwise_forbidden: すでに紛失として記録した蔵書を二重に記録しない
---

# 蔵書の状態

- 「修理中」「除籍」は状態に足さない — この版では館内の在庫運用を扱わない線引き。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
