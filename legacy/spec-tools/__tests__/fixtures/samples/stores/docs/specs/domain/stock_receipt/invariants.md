---
doc_type: invariant_spec
scope: common
id: stock_receipt-invariants
invariants:
  - id: INV-STOCK-RECEIPT-001
    statement: 伝票が持つ会社と店舗は、その棚の会社と店舗に一致する
    entities: [stock_receipt, shelf]
    formal:
      type: check
      # 店舗も写しである(棚 → 売場 → 店舗)。statement が「会社と店舗は」と言っている以上、
      # 形式定義も両方を言い切る —— 言い切らないと store_id の値の出どころがどこにも無い
      expr: stock_receipt.company_id == shelf.company_id and stock_receipt.store_id == section.store_id
    enforced_by:
      - kind: trigger
        ref: sync_stock_receipt_placement
---

# 入荷伝票の不変条件

- 店舗の一致は `formal` に書けない(棚から店舗は 1 段で届くが、`check` の式に 2 本の等式を並べると 1 レコード内の条件として読めなくなる) — トリガが両方を埋める。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
