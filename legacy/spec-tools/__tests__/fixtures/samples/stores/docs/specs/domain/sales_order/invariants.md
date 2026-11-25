---
doc_type: invariant_spec
scope: common
id: sales_order-invariants
invariants:
  - id: INV-SALES-ORDER-001
    statement: 注文番号は会社の中で重複しない(決済サービスへ渡す照合キー)
    entities: [sales_order]
    formal:
      type: uniqueness
      keys: [company_id, order_no]
    enforced_by:
      - kind: db_constraint
        ref: sales_orders_company_order_no_unique
  - id: INV-SALES-ORDER-003
    statement: 注文が持つ会社は、受けた店舗の会社に一致する(束縛の畳み込みが古い値のまま残らない)
    entities: [sales_order, store]
    formal:
      type: check
      expr: sales_order.company_id == store.company_id
    enforced_by:
      - kind: trigger
        ref: sync_sales_order_company
  - id: INV-SALES-ORDER-002
    statement: 入金済みの注文には、署名が検証できた入金通知が 1 件以上存在する
    entities: [sales_order, payment_notice]
    involves: [payment_notice]
    formal_outside: 状態に応じた別の集約の行の件数の下限(1 件以上)で、state_dependency は状態どうしの対応しか言えず、cardinality は上限だけを言う
    enforced_by:
      - kind: trigger
        ref: check_paid_order_has_notice
---

# 注文の不変条件

- INV-SALES-ORDER-003 の `check` は「祖先の列の写し」であり、`sync_sales_order_company` の本文はこの宣言から生成される(`copied-columns.ts`)。
- INV-SALES-ORDER-002 に `formal` を書けない — 「状態 X ならば別集約の行が 1 件以上ある」は `state_dependency`(状態と状態の対応)では表せず、件数の下限も形式定義に無い。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
