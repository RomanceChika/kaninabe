---
doc_type: action_spec
scope: backend
id: item-create-action

handles: item.create

input:
  - item.title
  - item.author
  - item.shelf_code
  - item.media

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ITEM-CREATE-001
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [item.create]
    implementation: app/src/operation/__tests__/item/create.test.ts::司書は蔵書を受け入れられる
  - id: TC-ITEM-CREATE-002
    type: unit
    covers: [forbidden]
    spec_ids: [item.create]
    implementation: app/src/operation/__tests__/item/create.test.ts::司書でない利用者は蔵書を受け入れられない
  - id: TC-ITEM-CREATE-003
    type: integration
    covers: [success]
    spec_ids: [item.create]
    implementation: app/src/composition/__tests__/item/create.test.ts::受け入れた蔵書は仕様の初期状態で始まる
---

# 蔵書を受け入れる（item.create）

- 蔵書IDは input で受けない — 冪等キーは呼び側が作り、業務の入力ではない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
