---
doc_type: invariant_spec
scope: common
id: loan-invariants
invariants:
  - id: INV-LOAN-001
    statement: 同じ蔵書について、返却されていない貸出は同時に1件しか存在しない
    entities: [loan]
    formal:
      type: uniqueness
      keys: [item_id]
      where: state not in [returned]
    enforced_by:
      - kind: db_constraint
        ref: loans_active_item_unique
      - kind: guard
        ref: loan.check_out
  - id: INV-LOAN-002
    statement: 1人の利用者が同時に持てる返却前の貸出は3件までである
    entities: [loan]
    formal:
      type: cardinality
      keys: [patron_id]
      max: 3
      where: state not in [returned]
    enforced_by:
      - kind: trigger
        ref: check_patron_loan_limit
---

# 貸出の不変条件

- 上限の 3 という数を利用者の欄にしない — 利用者の種別で変えるようになった日に、はじめてドメインへ引き上げる。

<!-- AUTO-GENERATED:invariant-table -->
| ID | 内容 | 形式定義 | 執行点 |
| --- | --- | --- | --- |
| INV-LOAN-001 | 同じ蔵書について、返却されていない貸出は同時に1件しか存在しない | unique(item_id) where state not in [returned] | db_constraint: loans_active_item_unique, guard: loan.check_out |
| INV-LOAN-002 | 1人の利用者が同時に持てる返却前の貸出は3件までである | count(patron_id) <​= 3 where state not in [returned] | trigger: check_patron_loan_limit |
<!-- /AUTO-GENERATED:invariant-table -->
