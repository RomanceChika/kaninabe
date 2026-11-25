---
doc_type: action_spec
scope: backend
id: claim-approve-action

handles: claim.approve

input:
  - claim.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CLAIM-APPROVE-001
    type: unit
    covers: [success]
    by_role: approver
    spec_ids: [claim.approve]
    implementation: app/src/operation/__tests__/claim/approve.test.ts::承認者は提出済みの申請を承認できる
  - id: TC-CLAIM-APPROVE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [claim.approve]
    implementation: app/src/operation/__tests__/claim/approve.test.ts::合計額が0の申請は承認できない
  - id: TC-CLAIM-APPROVE-003
    type: unit
    covers: [invalid_from]
    spec_ids: [claim.approve]
    implementation: app/src/operation/__tests__/claim/approve.test.ts::下書きの申請は承認できない
  - id: TC-CLAIM-APPROVE-004
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/approve.test.ts::指名されていない従業員は承認できない
  - id: TC-CLAIM-APPROVE-005
    type: unit
    covers: [conflict]
    spec_ids: [claim.approve]
    implementation: app/src/operation/__tests__/claim/approve.test.ts::判断のあとに差し戻されていた承認は競合になる
---

# 申請を承認する（claim.approve）

- 承認コメントは input で受けない — 残したいなら entity_spec に欄を足す判断が先である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
