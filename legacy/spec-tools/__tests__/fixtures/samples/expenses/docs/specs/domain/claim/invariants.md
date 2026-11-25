---
doc_type: invariant_spec
scope: common
id: claim-invariants

invariants:
  - id: INV-CLAIM-001
    statement: 提出済み以降の申請には明細が1件以上ある
    entities: [claim, line]
    involves: [line]
    enforced_by:
      - kind: application
        ref: assertClaimHasLines
      - kind: guard
        ref: claim.submit
  - id: INV-CLAIM-002
    statement: 申請者は自分自身を承認者に指名できない
    entities: [claim]
    formal:
      type: check
      expr: claim.employee_id != claim.approver_id
    enforced_by:
      - kind: db_constraint
        ref: claims_approver_not_self_check
  - id: INV-CLAIM-003
    statement: 合計額は明細の金額の総和と一致する
    entities: [claim, line]
    involves: [line]
    enforced_by:
      - kind: application
        ref: claimTotalAmount
---

# 経費申請の不変条件

- 上限額のルール(1件◯円まで)は不変条件にしない — 交渉できる天井は業務のルールであり、
  この題材では規程そのものを持たない線引きにした。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
