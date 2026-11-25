---
doc_type: action_spec
scope: backend
id: claim-update-action

handles: claim.update

input:
  - claim.id
  - claim.title
  - claim.purpose
  - claim.approver_id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CLAIM-UPDATE-001
    type: unit
    covers: [success]
    by_role: claim_owner
    spec_ids: [claim.update]
    implementation: app/src/operation/__tests__/claim/update.test.ts::申請者は下書きの件名と目的を直せる
  - id: TC-CLAIM-UPDATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [claim.update]
    implementation: app/src/operation/__tests__/claim/update.test.ts::提出済みの申請は直せない
  - id: TC-CLAIM-UPDATE-003
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/update.test.ts::承認者は申請の中身を直せない
  - id: TC-CLAIM-UPDATE-004
    type: unit
    covers: [conflict]
    spec_ids: [claim.update]
    implementation: app/src/operation/__tests__/claim/update.test.ts::判断のあとに状態が動いていた編集は競合になる
  - id: TC-CLAIM-UPDATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-CLAIM-002]
    implementation: app/src/composition/__tests__/claim/update.test.ts::承認者を自分自身に付け替える編集は拒否される
---

# 申請を直す（claim.update）

- total_amount は input に無い — 合計は提出の遷移が確定させる列であり、人が入れる値ではない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
