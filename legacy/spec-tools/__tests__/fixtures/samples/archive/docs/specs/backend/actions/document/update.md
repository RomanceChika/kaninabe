---
doc_type: action_spec
scope: backend
id: document-update-action

handles: document.update

input:
  - document.id
  - document.title
  - document.summary

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DOCUMENT-UPDATE-001
    type: unit
    covers: [success]
    by_role: document_author
    spec_ids: [document.update]
    implementation: app/src/operation/__tests__/document/update.test.ts::起案者は起案中の文書を直せる
  - id: TC-DOCUMENT-UPDATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [document.update]
    implementation: app/src/operation/__tests__/document/update.test.ts::供覧に出した文書は起案者も直せない
  - id: TC-DOCUMENT-UPDATE-003
    type: unit
    covers: [forbidden]
    spec_ids: [document.update]
    implementation: app/src/operation/__tests__/document/update.test.ts::他人の文書は直せない
  - id: TC-DOCUMENT-UPDATE-004
    type: unit
    covers: [conflict]
    spec_ids: [document.update]
    implementation: app/src/operation/__tests__/document/update.test.ts::判断後に状態が動いていたら競合として拒否される
  - id: TC-DOCUMENT-UPDATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-DOCUMENT-001]
    implementation: app/src/composition/__tests__/document/update.test.ts::同じ部署の別の文書と同じ標題には直せない
---

# 文書を直す（document.update）

- 所管部署を直す口は持たない — 所管が動くのは文書の付け替えであり、起案し直すほうが台帳として正しい。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
