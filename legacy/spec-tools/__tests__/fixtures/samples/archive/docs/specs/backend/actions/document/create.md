---
doc_type: action_spec
scope: backend
id: document-create-action

handles: document.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: document.author_id

input:
  - document.department_id
  - document.title
  - document.summary
  - document.disposable_after

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DOCUMENT-CREATE-001
    type: unit
    covers: [success]
    by_role: staff
    spec_ids: [document.create]
    implementation: app/src/operation/__tests__/document/create.test.ts::社員は自分の部署の文書を起案できる
  - id: TC-DOCUMENT-CREATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [document.create]
    implementation: app/src/operation/__tests__/document/create.test.ts::他部署を所管に指定した起案は拒否される
  - id: TC-DOCUMENT-CREATE-003
    type: unit
    covers: [forbidden]
    spec_ids: [document.create]
    implementation: app/src/operation/__tests__/document/create.test.ts::未ログインでは文書を起案できない
  - id: TC-DOCUMENT-CREATE-004
    type: integration
    covers: [invariant]
    spec_ids: [INV-DOCUMENT-001]
    implementation: app/src/composition/__tests__/document/create.test.ts::同じ部署に同じ標題の文書は2件作れない
  - id: TC-DOCUMENT-CREATE-005
    type: unit
    covers: [conflict]
    spec_ids: [document.create]
    implementation: app/src/operation/__tests__/document/create.test.ts::判断後に実行者の所属が動いていたら競合として拒否される
---

# 文書を起案する（document.create）

- 保管日時を input で受けない — 起案の時点で保管されている文書は無い(INV-DOCUMENT-002)。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
