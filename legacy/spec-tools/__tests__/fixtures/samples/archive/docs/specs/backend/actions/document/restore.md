---
doc_type: action_spec
scope: backend
id: document-restore-action

handles: document.restore

input:
  - document.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DOCUMENT-RESTORE-001
    type: unit
    covers: [success]
    by_role: curator
    spec_ids: [document.restore]
    implementation: app/src/operation/__tests__/document/restore.test.ts::文書管理者は保管中の文書を書庫から出せる
  - id: TC-DOCUMENT-RESTORE-002
    type: unit
    covers: [invalid_from]
    spec_ids: [document.restore]
    implementation: app/src/operation/__tests__/document/restore.test.ts::供覧中の文書は書庫から出せない
  - id: TC-DOCUMENT-RESTORE-003
    type: unit
    covers: [forbidden]
    spec_ids: [document.restore]
    implementation: app/src/operation/__tests__/document/restore.test.ts::文書管理者でない社員は書庫から出せない
  - id: TC-DOCUMENT-RESTORE-004
    type: unit
    covers: [conflict]
    spec_ids: [document.restore]
    implementation: app/src/operation/__tests__/document/restore.test.ts::判断後に状態が動いていたら競合として拒否される
  - id: TC-DOCUMENT-RESTORE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-DOCUMENT-002]
    implementation: app/src/composition/__tests__/document/restore.test.ts::書庫から出した文書の保管日時と保管した職員は空に戻る
  # 部署の境界(state_spec の guard)—— 文書管理者でも他部署の文書は動かせない
  - id: TC-DOCUMENT-RESTORE-006
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [document.restore]
    implementation: app/src/operation/__tests__/document/restore.test.ts::他部署の文書は書庫から出せない
---

# 文書を書庫から出す（document.restore）

- 出した理由を input で受けない — 記録する場所（欄）をドメインに持っていない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
