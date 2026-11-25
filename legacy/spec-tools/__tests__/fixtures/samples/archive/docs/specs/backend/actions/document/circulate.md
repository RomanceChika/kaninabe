---
doc_type: action_spec
scope: backend
id: document-circulate-action

handles: document.circulate

input:
  - document.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DOCUMENT-CIRCULATE-001
    type: unit
    covers: [success]
    by_role: document_author
    spec_ids: [document.circulate]
    implementation: app/src/operation/__tests__/document/circulate.test.ts::起案者は文書を供覧に出せる
  - id: TC-DOCUMENT-CIRCULATE-002
    type: unit
    covers: [success]
    by_role: curator
    spec_ids: [document.circulate]
    implementation: app/src/operation/__tests__/document/circulate.test.ts::文書管理者は代わりに供覧に出せる
  - id: TC-DOCUMENT-CIRCULATE-003
    type: unit
    covers: [invalid_from]
    spec_ids: [document.circulate]
    implementation: app/src/operation/__tests__/document/circulate.test.ts::保管中の文書は供覧に出せない
  - id: TC-DOCUMENT-CIRCULATE-004
    type: unit
    covers: [forbidden]
    spec_ids: [document.circulate]
    implementation: app/src/operation/__tests__/document/circulate.test.ts::他人の文書は供覧に出せない
  - id: TC-DOCUMENT-CIRCULATE-005
    type: unit
    covers: [conflict]
    spec_ids: [document.circulate]
    implementation: app/src/operation/__tests__/document/circulate.test.ts::判断後に状態が動いていたら競合として拒否される
  # 部署の境界(state_spec の guard)—— 文書管理者でも他部署の文書は動かせない
  - id: TC-DOCUMENT-CIRCULATE-006
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [document.circulate]
    implementation: app/src/operation/__tests__/document/circulate.test.ts::他部署の文書は供覧に出せない
---

# 文書を供覧に出す（document.circulate）

- 供覧先の名簿を input で受けない — 誰が読むかは部署の可視性が決めており、宛先を列に持たない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
