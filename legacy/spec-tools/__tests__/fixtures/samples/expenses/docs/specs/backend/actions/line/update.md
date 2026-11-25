---
doc_type: action_spec
scope: backend
id: line-update-action

handles: line.update

input:
  - line.id
  - line.spent_on
  - line.category
  - line.amount
  - line.memo

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LINE-UPDATE-001
    type: unit
    covers: [success]
    by_role: claim_owner
    spec_ids: [line.update]
    implementation: app/src/operation/__tests__/line/update.test.ts::申請者は下書きの明細を直せる
  - id: TC-LINE-UPDATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [line.update]
    implementation: app/src/operation/__tests__/line/update.test.ts::提出済みの申請の明細は直せない
  - id: TC-LINE-UPDATE-003
    type: unit
    covers: [forbidden]
    spec_ids: [line-access]
    implementation: app/src/operation/__tests__/line/update.test.ts::承認者は明細を直せない
  - id: TC-LINE-UPDATE-004
    type: unit
    covers: [conflict]
    spec_ids: [line.update]
    implementation: app/src/operation/__tests__/line/update.test.ts::判断のあとに親の状態が動いていた編集は競合になる
  - id: TC-LINE-UPDATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-CLAIM-003]
    implementation: app/src/composition/__tests__/line/update.test.ts::金額を直すと合計額も明細の総和に追随する
---

# 明細を直す（line.update）

- claim_id は input に無い — 明細を別の申請へ付け替える操作はこの系に存在しない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
