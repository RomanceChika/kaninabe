---
doc_type: action_spec
scope: backend
id: item-lend-action

handles: item.lend

input:
  - item.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ITEM-LEND-001
    type: unit
    covers: [success]
    by_role: patron
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::利用者は在架の蔵書を自分で貸出中にできる
  - id: TC-ITEM-LEND-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::司書はカウンターで蔵書を貸出中にできる
  - id: TC-ITEM-LEND-003
    type: unit
    covers: [invalid_from]
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::貸出中の蔵書は再び貸し出せない
  - id: TC-ITEM-LEND-004
    type: unit
    covers: [forbidden]
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::未ログインでは蔵書を貸し出せない
  - id: TC-ITEM-LEND-005
    type: unit
    covers: [conflict]
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 蔵書を貸し出す（item.lend）

- 借りる人を input で受けない — 誰が借りたかは貸出の行が持ち、蔵書は在庫の状態だけを持つ。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
