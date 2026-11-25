---
doc_type: action_spec
scope: backend
id: hold-cancel-action

handles: hold.cancel

input:
  - hold.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-HOLD-CANCEL-001
    type: unit
    covers: [success]
    by_role: hold_owner
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::予約した本人が予約を取り消せる
  - id: TC-HOLD-CANCEL-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::司書は取置期限を過ぎた予約を取り消せる
  - id: TC-HOLD-CANCEL-003
    type: unit
    covers: [invalid_from]
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::受取済みの予約は取り消せない
  - id: TC-HOLD-CANCEL-004
    type: unit
    covers: [forbidden]
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::他人の予約は取り消せない
  - id: TC-HOLD-CANCEL-005
    type: unit
    covers: [conflict]
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 予約を取り消す（hold.cancel）

- 取消の理由は input で受けない — 記録する場所（欄）をドメインに持っていない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
