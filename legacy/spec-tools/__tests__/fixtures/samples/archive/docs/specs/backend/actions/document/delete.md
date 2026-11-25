---
doc_type: action_spec
scope: backend
id: document-delete-action

handles: document.delete

input:
  - document.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DOCUMENT-DELETE-001
    type: unit
    covers: [success]
    by_role: curator
    spec_ids: [document.delete]
    implementation: app/src/operation/__tests__/document/delete.test.ts::保存年限の切れた保管文書は廃棄できる
  - id: TC-DOCUMENT-DELETE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [document.delete]
    implementation: app/src/operation/__tests__/document/delete.test.ts::保存年限の残っている文書は廃棄できない
  - id: TC-DOCUMENT-DELETE-003
    type: unit
    covers: [forbidden]
    spec_ids: [document.delete]
    implementation: app/src/operation/__tests__/document/delete.test.ts::文書管理者でない社員は廃棄できない
  - id: TC-DOCUMENT-DELETE-004
    type: integration
    covers: [not_found, conflict]
    spec_ids: [document.delete]
    implementation: app/src/composition/__tests__/document/delete.test.ts::既に消えている文書の廃棄は存在を漏らさず拒否される
---

# 文書を廃棄する（document.delete）

- 「廃棄済み」の状態に倒さない — 目録から消えることが廃棄であり、残すと消したはずの標題が残る。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
