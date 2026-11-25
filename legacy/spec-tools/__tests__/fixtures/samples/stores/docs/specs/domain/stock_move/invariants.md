---
doc_type: invariant_spec
scope: common
id: stock_move-invariants
invariants:
  - id: INV-STOCK-MOVE-001
    statement: 同じ会社の中で、送り元の伝票番号を持つ移動は 1 件しか存在しない(外部からの再送で二重計上しない)
    entities: [stock_move]
    formal:
      type: uniqueness
      keys: [company_id, source_ref]
    enforced_by:
      - kind: db_constraint
        ref: stock_moves_company_source_ref_unique
  - id: INV-STOCK-MOVE-002
    statement: 入庫の数量は正・出庫の数量は負でなければならない(向きと符号が食い違わない)
    entities: [stock_move]
    enforced_by:
      - kind: db_constraint
        ref: stock_moves_kind_sign_check
  - id: INV-STOCK-MOVE-003
    statement: 移動が持つ棚は、その伝票の棚と一致する
    entities: [stock_move, stock_receipt]
    formal:
      type: check
      expr: stock_move.shelf_id == stock_receipt.shelf_id
    enforced_by:
      - kind: trigger
        ref: sync_stock_move_shelf
  - id: INV-STOCK-MOVE-004
    statement: 移動が持つ会社と店舗は、その伝票の会社と店舗に一致する(束縛の畳み込みが古い値のまま残らない)
    entities: [stock_move, stock_receipt]
    formal:
      type: check
      expr: stock_move.company_id == stock_receipt.company_id and stock_move.store_id == stock_receipt.store_id
    enforced_by:
      - kind: trigger
        ref: sync_stock_move_tenant
  - id: INV-STOCK-MOVE-005
    statement: 移動が指す商品は、その移動と同じ会社の商品でなければならない(会社を跨いだ商品の移動を台帳に書けない)
    entities: [stock_move, product]
    formal:
      type: check
      expr: stock_move.company_id == product.company_id
    enforced_by:
      - kind: trigger
        ref: check_stock_move_product_company                  # 移動の側(商品の付け替え・移動の会社の変更)
      - kind: trigger
        ref: check_stock_move_product_company_on_product       # 商品の側(商品が別の会社へ移る)
---

# 在庫の移動の不変条件

- INV-STOCK-MOVE-002 に `formal` を書けない — 「kind が receipt なら quantity > 0」は 2 つの列にまたがる含意で、`check` の 1 式にも `state_dependency`(状態と状態の対応)にも収まらない。
- INV-STOCK-MOVE-005 の `check` は**別集約の列との一致**である(INV-STORE-002 と同じ形)—— 商品は入力で受けるので、作成の `when` が `product.company_id == actor.company_id` で結び、この不変条件が両端の執行点を宣言する(別集約の列との等式は行の CHECK に写せないので、移動の表と商品の表に 1 本ずつのコミット時評価の制約トリガを置き、本文は `check` の式から生成される)。
- INV-STOCK-MOVE-004 の `check` は等式 2 本を `and` で並べた形である — 文法は `clause ("and"|"or") clause` を許し、相手(`stock_receipt`)には `context` で届く。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
