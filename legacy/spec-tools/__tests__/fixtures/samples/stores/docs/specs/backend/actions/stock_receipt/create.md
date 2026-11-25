---
doc_type: action_spec
scope: backend
id: stock_receipt-create-action

handles: stock_receipt.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: stock_receipt.recorded_by

input:
  - stock_receipt.shelf_id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-STOCK_RECEIPT-CREATE-001
    type: unit
    covers: [success]
    by_role: staff_member
    spec_ids: [stock_receipt.create]
    implementation: app/src/operation/__tests__/stock_receipt/create.test.ts::従業員は使用中の棚に入荷伝票を起こせる
  - id: TC-STOCK_RECEIPT-CREATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [stock_receipt.create]
    implementation: app/src/operation/__tests__/stock_receipt/create.test.ts::使用停止の棚には伝票を起こせない
  - id: TC-STOCK_RECEIPT-CREATE-003
    type: integration
    covers: [forbidden]
    spec_ids: [stock_receipt-access]
    implementation: app/src/composition/__tests__/stock_receipt/create.test.ts::未ログインからの起票は拒否される
  - id: TC-STOCK_RECEIPT-CREATE-004
    type: integration
    covers: [invariant]
    spec_ids: [INV-STOCK-RECEIPT-001]
    implementation: app/src/composition/__tests__/stock_receipt/create.test.ts::会社と店舗は棚から引き当てられる
  - id: TC-STOCK_RECEIPT-CREATE-005
    type: integration
    covers: [conflict]
    spec_ids: [stock_receipt.create]
    implementation: app/src/composition/__tests__/stock_receipt/create.test.ts::判断後に使用停止になっていた棚への起票は競合として拒否される
---

# 入荷伝票の起票(stock_receipt.create)

- `recorded_by` は input に無い — クライアントに選ばせると他人名義の伝票ができる。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
