---
doc_type: usecase_spec
scope: frontend
id: usecase-stock-receipt

name: stock_receipt
goal: 届いた荷物を棚に入庫として記帳する
actor: staff_member
start: screen-shelf-stock
done: stock_move.state == posted

saves:
  - id: record_moves
    label: 入庫をまとめて記帳する
    migration: 20260911000001_usecase_stock_receipt_record_moves.sql
    steps:
      - op: stock_receipt.create
        label: 入荷伝票
      - op: stock_move.create
        label: 入庫の明細
        repeat: true

test_cases:
  - id: TC-USECASE-STOCK_RECEIPT-001
    type: integration
    covers: [success]
    spec_ids: [usecase-stock-receipt]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::stock_receipt.record_moves の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-STOCK_RECEIPT-002
    type: integration
    covers: [success]
    spec_ids: [usecase-stock-receipt]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::同じ冪等キーで送り直しても移動の行は増えない
  # 保存点の decide ⇔ 複合 RPC の一致の証明(束 ⑳-5a2)も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  # /AUTO-GENERATED:usecase-eq-tests
---

# 入庫の記帳(届いた荷物を棚に入庫として記帳する)

- 移動だけを繰り返す保存点にはできない — 複合 RPC の再送は「最初に作る行からの参照の鎖」で各手順を読み直すので、親の無い兄弟行を N 件作る形は生成できない(伝票を親に置いて解いた)。伝票を外すと Y12 が「親集約を置く」を対処として示して止める(束 ⑲-1)。
- 棚卸(count)はこのタスクに入れない — 数え直しは入庫と別の仕事であり、同じ保存で混ぜると全部か無しかの単位が business として読めない。
