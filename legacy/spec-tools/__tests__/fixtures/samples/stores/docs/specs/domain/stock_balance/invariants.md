---
doc_type: invariant_spec
scope: common
id: stock_balance-invariants
invariants:
  - id: INV-STOCK-BALANCE-001
    statement: 棚 × 商品の現在数は、その棚・その商品の取消でない移動の数量の合計と一致する
    entities: [stock_balance, stock_move]
    involves: [stock_move]
    formal_outside: 別の集約の行の数量の合計との一致(集計)で、形式定義の型は集計を言えない
    enforced_by:
      - kind: trigger
        ref: apply_stock_move_to_balance
  - id: INV-STOCK-BALANCE-002
    statement: 棚 × 商品の残高の行は 1 つしか存在しない
    entities: [stock_balance]
    formal:
      type: uniqueness
      keys: [shelf_id, product_id]
    enforced_by:
      - kind: db_constraint
        ref: stock_balances_shelf_product_unique
---

# 在庫残高の不変条件

- INV-STOCK-BALANCE-001 に `formal` を書けない — 跨行の集計(合計)は形式定義の語彙に無い(`cardinality` は件数だけ)。執行はトリガに寄せ、宣言は `statement` が全部である。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
