---
doc_type: action_spec
scope: backend
id: document-archive-action

handles: document.archive

input:
  - document.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DOCUMENT-ARCHIVE-001
    type: unit
    covers: [success]
    by_role: curator
    spec_ids: [document.archive]
    implementation: app/src/operation/__tests__/document/archive.test.ts::文書管理者は供覧中の文書を書庫へ入れられる
  - id: TC-DOCUMENT-ARCHIVE-002
    type: unit
    covers: [invalid_from]
    spec_ids: [document.archive]
    implementation: app/src/operation/__tests__/document/archive.test.ts::起案中の文書は書庫へ入れられない
  - id: TC-DOCUMENT-ARCHIVE-003
    type: unit
    covers: [forbidden]
    spec_ids: [document.archive]
    implementation: app/src/operation/__tests__/document/archive.test.ts::文書管理者でない社員は書庫へ入れられない
  - id: TC-DOCUMENT-ARCHIVE-004
    type: unit
    covers: [conflict]
    spec_ids: [document.archive]
    implementation: app/src/operation/__tests__/document/archive.test.ts::判断後に状態が動いていたら競合として拒否される
  - id: TC-DOCUMENT-ARCHIVE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-DOCUMENT-002]
    implementation: app/src/composition/__tests__/document/archive.test.ts::書庫へ入れた文書には保管日時と保管した職員が入る
  # 部署の境界(state_spec の guard)—— 文書管理者でも他部署の文書は動かせない
  - id: TC-DOCUMENT-ARCHIVE-006
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [document.archive]
    implementation: app/src/operation/__tests__/document/archive.test.ts::他部署の文書は書庫へ入れられない
---

# 文書を書庫へ入れる（document.archive）

- 保管日時を input で受けない — 打つのは遷移そのもの(states.md の records_actor と access.md の writes が受け皿)。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
