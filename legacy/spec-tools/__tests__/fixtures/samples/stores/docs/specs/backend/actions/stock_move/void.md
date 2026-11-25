---
doc_type: action_spec
scope: backend
id: stock_move-void-action

handles: stock_move.void

input:
  - stock_move.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-STOCK_MOVE-VOID-001
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [stock_move.void]
    implementation: app/src/operation/__tests__/stock_move/void.test.ts::店舗責任者は自店舗の移動を取り消せる
  - id: TC-STOCK_MOVE-VOID-002
    type: unit
    covers: [success]
    by_role: company_admin
    spec_ids: [stock_move.void]
    implementation: app/src/operation/__tests__/stock_move/void.test.ts::会社管理者は移動を取り消せる
  - id: TC-STOCK_MOVE-VOID-003
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [stock_move.void]
    implementation: app/src/operation/__tests__/stock_move/void.test.ts::使用停止の棚の移動は取り消せない
  - id: TC-STOCK_MOVE-VOID-004
    type: unit
    covers: [invalid_from]
    spec_ids: [stock_move.void]
    implementation: app/src/operation/__tests__/stock_move/void.test.ts::取消済みの移動はもう取り消せない
  - id: TC-STOCK_MOVE-VOID-005
    type: integration
    covers: [forbidden]
    spec_ids: [stock_move-access]
    implementation: app/src/composition/__tests__/stock_move/void.test.ts::記録した本人でも取り消せない
  - id: TC-STOCK_MOVE-VOID-006
    type: integration
    covers: [invariant]
    spec_ids: [INV-STOCK-BALANCE-001]
    implementation: app/src/composition/__tests__/stock_move/void.test.ts::取消のあとも残高は取消でない移動の合計と一致する
  - id: TC-STOCK_MOVE-VOID-007
    type: integration
    covers: [conflict]
    spec_ids: [stock_move.void]
    implementation: app/src/composition/__tests__/stock_move/void.test.ts::判断後に取り消されていた移動の取消は競合として拒否される
---

# 在庫の移動の取消(stock_move.void)

- 取消の理由は input で受けない — 残したいなら entity_spec に欄を足す判断が先である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
