---
doc_type: action_spec
scope: backend
id: item-shelve-action

handles: item.shelve

input:
  - item.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ITEM-SHELVE-001
    type: unit
    covers: [success]
    by_role: patron
    spec_ids: [item.shelve]
    implementation: app/src/operation/__tests__/item/shelve.test.ts::利用者は返却ポストで蔵書を在架に戻せる
  - id: TC-ITEM-SHELVE-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [item.shelve]
    implementation: app/src/operation/__tests__/item/shelve.test.ts::司書は蔵書を在架に戻せる
  - id: TC-ITEM-SHELVE-003
    type: unit
    covers: [invalid_from]
    spec_ids: [item.shelve]
    implementation: app/src/operation/__tests__/item/shelve.test.ts::在架の蔵書は返架できない
  - id: TC-ITEM-SHELVE-004
    type: unit
    covers: [forbidden]
    spec_ids: [item.shelve]
    implementation: app/src/operation/__tests__/item/shelve.test.ts::未ログインでは返架できない
  - id: TC-ITEM-SHELVE-005
    type: unit
    covers: [conflict]
    spec_ids: [item.shelve]
    implementation: app/src/operation/__tests__/item/shelve.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 蔵書を返架する（item.shelve）

- 返却の記録はここで持たない — 貸出の返却は loan.return_item が別に受ける。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
