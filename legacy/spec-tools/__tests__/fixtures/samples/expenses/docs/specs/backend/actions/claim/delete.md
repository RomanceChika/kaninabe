---
doc_type: action_spec
scope: backend
id: claim-delete-action

handles: claim.delete

input:
  - claim.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CLAIM-DELETE-001
    type: unit
    covers: [success]
    by_role: claim_owner
    spec_ids: [claim.delete]
    implementation: app/src/operation/__tests__/claim/delete.test.ts::申請者は下書きを消せる
  - id: TC-CLAIM-DELETE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [claim.delete]
    implementation: app/src/operation/__tests__/claim/delete.test.ts::提出済みの申請は消せない
  - id: TC-CLAIM-DELETE-003
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/delete.test.ts::他人の下書きは消せない
  - id: TC-CLAIM-DELETE-004
    type: unit
    covers: [conflict, not_found]
    spec_ids: [claim.delete]
    implementation: app/src/operation/__tests__/claim/delete.test.ts::対象が消えていても存在を漏らさずに断る
---

# 申請を消す（claim.delete）

- 取下げという状態は作らない — 提出前の下書きを消すだけで、履歴に残す必要が無い。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
