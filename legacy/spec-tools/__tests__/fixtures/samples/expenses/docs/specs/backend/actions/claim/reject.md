---
doc_type: action_spec
scope: backend
id: claim-reject-action

handles: claim.reject

input:
  - claim.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CLAIM-REJECT-001
    type: unit
    covers: [success]
    by_role: approver
    spec_ids: [claim.reject]
    implementation: app/src/operation/__tests__/claim/reject.test.ts::承認者は提出済みの申請を差し戻せる
  - id: TC-CLAIM-REJECT-002
    type: unit
    covers: [invalid_from]
    spec_ids: [claim.reject]
    implementation: app/src/operation/__tests__/claim/reject.test.ts::承認済みの申請は差し戻せない
  - id: TC-CLAIM-REJECT-003
    type: unit
    covers: [forbidden]
    spec_ids: [claim-access]
    implementation: app/src/operation/__tests__/claim/reject.test.ts::指名されていない従業員は差し戻せない
  - id: TC-CLAIM-REJECT-004
    type: unit
    covers: [conflict]
    spec_ids: [claim.reject]
    implementation: app/src/operation/__tests__/claim/reject.test.ts::判断のあとに承認されていた差戻しは競合になる
---

# 申請を差し戻す（claim.reject）

- 差戻し理由の欄はこの版では持たない — 口頭・別系の連絡で足りるかを実測してから足す。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
