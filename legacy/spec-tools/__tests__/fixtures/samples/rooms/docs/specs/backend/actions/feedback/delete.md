---
doc_type: action_spec
scope: backend
id: feedback-delete-action

handles: feedback.delete

input:
  - feedback.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-FEEDBACK-DELETE-001
    type: unit
    covers: [success]
    by_role: anonymous
    spec_ids: [feedback.delete]
    implementation: app/src/operation/__tests__/feedback/delete.test.ts::未ログインの足場の削除は理由つきで開いている
  - id: TC-FEEDBACK-DELETE-002
    type: integration
    covers: [forbidden]
    spec_ids: [feedback-access]
    implementation: app/src/composition/__tests__/feedback/delete.test.ts::未ログインでない役割の足場の削除は拒否される
  - id: TC-FEEDBACK-DELETE-003
    type: integration
    covers: [not_found, conflict]
    spec_ids: [feedback.delete]
    implementation: app/src/composition/__tests__/feedback/delete.test.ts::既に消えている意見の削除は存在を漏らさず拒否される
---

# 匿名の意見を取り下げる（feedback.delete）

- 検査の足場である。未ログインに削除を開けている理由は access_spec の `public` が正。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
