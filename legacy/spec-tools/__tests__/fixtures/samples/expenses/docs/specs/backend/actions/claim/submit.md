---
doc_type: action_spec
scope: backend
id: claim-submit-action

handles: claim.submit

input:
  - claim.id

computes:
  - field: claim.total_amount
    ref: claimTotalAmount
    reads: [line.amount]

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CLAIM-SUBMIT-001
    type: unit
    covers: [success]
    by_role: claim_owner
    spec_ids: [claim.submit]
    implementation: app/src/operation/__tests__/claim/submit.test.ts::下書きを提出すると合計額が確定する
  - id: TC-CLAIM-SUBMIT-002
    type: unit
    covers: [invalid_from]
    spec_ids: [claim.submit]
    implementation: app/src/operation/__tests__/claim/submit.test.ts::提出済みの申請は再提出できない
  - id: TC-CLAIM-SUBMIT-003
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/submit.test.ts::承認者は申請者の代わりに提出できない
  - id: TC-CLAIM-SUBMIT-004
    type: unit
    covers: [conflict]
    spec_ids: [claim.submit]
    implementation: app/src/operation/__tests__/claim/submit.test.ts::判断のあとに状態が動いていた提出は競合になる
  - id: TC-CLAIM-SUBMIT-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-CLAIM-001, INV-CLAIM-003]
    implementation: app/src/composition/__tests__/claim/submit.test.ts::明細が1件も無い申請は提出できず、合計額は明細の総和になる
---

# 申請を提出する（claim.submit）

- 合計額を input で受けない — クライアントに合計を送らせると、明細と食い違った値で提出できてしまう。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
