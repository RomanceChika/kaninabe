---
doc_type: action_spec
scope: backend
id: loan-report_overdue-action

handles: loan.report_overdue

input:
  - loan.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LOAN-REPORT_OVERDUE-001
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [loan.report_overdue]
    implementation: app/src/operation/__tests__/loan/report_overdue.test.ts::期限を過ぎた貸出を延滞として記録できる
  - id: TC-LOAN-REPORT_OVERDUE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [loan.report_overdue]
    implementation: app/src/operation/__tests__/loan/report_overdue.test.ts::期限前の貸出は延滞として記録できない
  - id: TC-LOAN-REPORT_OVERDUE-003
    type: unit
    covers: [invalid_from]
    spec_ids: [loan.report_overdue]
    implementation: app/src/operation/__tests__/loan/report_overdue.test.ts::返却済みの貸出は延滞として記録できない
  - id: TC-LOAN-REPORT_OVERDUE-004
    type: unit
    covers: [forbidden]
    spec_ids: [loan.report_overdue]
    implementation: app/src/operation/__tests__/loan/report_overdue.test.ts::司書でない利用者は延滞として記録できない
  - id: TC-LOAN-REPORT_OVERDUE-005
    type: unit
    covers: [conflict]
    spec_ids: [loan.report_overdue]
    implementation: app/src/operation/__tests__/loan/report_overdue.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 貸出を延滞として記録する（loan.report_overdue）

- 延滞金は扱わない — 督促の運用はこの版の線の外。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
