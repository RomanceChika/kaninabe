---
doc_type: invariant_spec
scope: common
id: product-invariants
invariants:
  - id: INV-PRODUCT-001
    statement: 同じ会社の中で商品コードは重複しない
    entities: [product]
    formal:
      type: uniqueness
      keys: [company_id, sku]
    enforced_by:
      - kind: db_constraint
        ref: products_company_sku_unique
---

# 商品の不変条件

- 商品コードの書式(英数字のみ等)は不変条件にしない — 会社ごとに違い、交渉できる値である。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
