---
doc_type: access_spec
scope: common
id: line-access
entity: line
reads:
  - by: anonymous
    scope: none
  - by: employee
    scope: none
  - by: claim_owner
    scope: context(claim)
  - by: approver
    scope: context(claim)
  - by: accountant
    scope: all
  - by: system
    scope: all
creates:
  - by: claim_owner
    when: claim.state == draft
writes:
  - by: claim_owner
    fields: [spent_on, category, amount, memo]
    when: claim.state == draft
deletes:
  - by: claim_owner
    when: claim.state == draft
---

# 明細のアクセス権限

- 承認者に明細の編集権は与えない — 金額を触れるのは申請者だけ、が業務のルールである。
- 明細に状態機械は持たせない — 明細の生死は親の申請の状態が決める。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
