---
doc_type: action_spec
scope: backend
id: stock_move-create-action

handles: stock_move.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: stock_move.recorded_by

input:
  - stock_move.receipt_id
  - stock_move.product_id
  - stock_move.kind
  - stock_move.quantity
  - stock_move.source_ref

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-STOCK_MOVE-CREATE-001
    type: unit
    covers: [success]
    by_role: staff_member
    spec_ids: [stock_move.create]
    implementation: app/src/operation/__tests__/stock_move/create.test.ts::従業員は使用中の棚に入庫を記帳できる
  - id: TC-STOCK_MOVE-CREATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [stock_move.create]
    implementation: app/src/operation/__tests__/stock_move/create.test.ts::使用停止の棚には記帳できない
  - id: TC-STOCK_MOVE-CREATE-003
    type: integration
    covers: [forbidden]
    spec_ids: [stock_move-access]
    implementation: app/src/composition/__tests__/stock_move/create.test.ts::未ログインからの記帳は拒否される
  - id: TC-STOCK_MOVE-CREATE-004
    type: integration
    covers: [invariant]
    spec_ids: [INV-STOCK-MOVE-001, INV-STOCK-MOVE-002]
    implementation: app/src/composition/__tests__/stock_move/create.test.ts::同じ伝票番号の再送は二重計上されず、向きと符号の食い違いは拒否される
  - id: TC-STOCK_MOVE-CREATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-STOCK-BALANCE-001]
    implementation: app/src/composition/__tests__/stock_move/create.test.ts::記帳のあとも残高は取消でない移動の合計と一致する
  - id: TC-STOCK_MOVE-CREATE-006
    type: integration
    covers: [conflict]
    spec_ids: [stock_move.create]
    implementation: app/src/composition/__tests__/stock_move/create.test.ts::判断後に使用停止になっていた棚への記帳は競合として拒否される
  # テナント境界(access_spec の creates[].when)—— 他社の product_id を渡した作成が拒否される(会社・棚は伝票から写すので、商品は入力で結ぶ)
  - id: TC-STOCK_MOVE-CREATE-007
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [stock_move-access]
    implementation: app/src/composition/__tests__/stock_move/create.test.ts::他社の商品を指す入庫の明細は拒否される
---

# 在庫の移動の記帳(stock_move.create)

- `recorded_by` は input に無い — クライアントに選ばせると他人名義の記帳ができる。
- 棚・店舗・会社は input に無い(伝票から引き当てる写し — INV-STOCK-MOVE-003 / 004)。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
