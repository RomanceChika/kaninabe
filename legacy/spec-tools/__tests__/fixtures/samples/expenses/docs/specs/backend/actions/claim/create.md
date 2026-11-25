---
doc_type: action_spec
scope: backend
id: claim-create-action

handles: claim.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: claim.employee_id

input:
  - claim.approver_id
  - claim.title
  - claim.purpose

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CLAIM-CREATE-001
    type: unit
    covers: [success]
    by_role: employee
    spec_ids: [claim.create]
    implementation: app/src/operation/__tests__/claim/create.test.ts::従業員は下書きの申請を作れる
  - id: TC-CLAIM-CREATE-002
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/create.test.ts::未ログインは申請を作れない
  - id: TC-CLAIM-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-CLAIM-002]
    implementation: app/src/composition/__tests__/claim/create.test.ts::自分自身を承認者に指名した申請は拒否される
---

# 申請を作る（claim.create）

- employee_id は input で受けない — 申請者は常に実行者であり、クライアントに選ばせる余地を作らない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
