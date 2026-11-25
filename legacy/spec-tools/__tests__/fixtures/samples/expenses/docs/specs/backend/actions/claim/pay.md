---
doc_type: action_spec
scope: backend
id: claim-pay-action

handles: claim.pay

input:
  - claim.id

runner:
  kind: manual
  reason: 銀行の送金 API への外部連携を挟むため、定型の遷移 RPC だけでは実行計画が閉じない

errors:
  inherits: common
  additional:
    - kind: external_unavailable
      when: 銀行の送金 API が応答しない、または資格情報が未設定

test_cases:
  - id: TC-CLAIM-PAY-001
    type: unit
    covers: [success]
    by_role: accountant
    spec_ids: [claim.pay]
    implementation: app/src/operation/__tests__/claim/pay.test.ts::経理は承認済みの申請を支払える
  - id: TC-CLAIM-PAY-002
    type: unit
    covers: [invalid_from]
    spec_ids: [claim.pay]
    implementation: app/src/operation/__tests__/claim/pay.test.ts::提出済みの申請は支払えない
  - id: TC-CLAIM-PAY-003
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/pay.test.ts::経理でない従業員は支払えない
  - id: TC-CLAIM-PAY-004
    type: unit
    covers: [conflict]
    spec_ids: [claim.pay]
    implementation: app/src/operation/__tests__/claim/pay.test.ts::判断のあとに状態が動いていた支払いは競合になる
  - id: TC-CLAIM-PAY-005
    type: unit
    covers: [other]
    spec_ids: [claim.pay]
    implementation: app/src/operation/__tests__/claim/pay.test.ts::送金の資格情報が無いときは状態を動かさずに断る
---

# 申請を支払う（claim.pay）

- 振込先口座は input で受けない — 口座は従業員の台帳が持つ情報であり、操作のたびに送らせない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
