---
doc_type: invariant_spec
scope: common
id: shelf-invariants
invariants:
  - id: INV-SHELF-001
    statement: 同じ売場の中で棚番は重複しない
    entities: [shelf]
    formal:
      type: uniqueness
      keys: [section_id, code]
    enforced_by:
      - kind: db_constraint
        ref: shelves_section_code_unique
  - id: INV-SHELF-002
    statement: 棚が持つ会社は、その売場の会社と一致する(テナントの境界が木の葉でずれない)
    entities: [shelf, section]
    formal:
      type: check
      expr: shelf.company_id == section.company_id
    enforced_by:
      - kind: trigger
        ref: sync_shelf_company
---

# 棚の不変条件

- 「1 売場あたりの棚の数」の上限は置かない — 数える理由(性能・費用)がまだ無い。
- **店舗の列は持たない。** `store_manager` の binding は `shelf → section → store` を `context` の連鎖で 2 段辿って解決される(束 ⑲-2a)。畳んだ列 1 本・それを埋めるトリガ 1 本・一致を守る不変条件 1 本が、木の 1 段ぶんまるごと要らなくなった。
- **会社の列(`company_id`)は残る。** こちらは可視性の境界そのもの(`reads[].filters`)であり、RLS が 1 つの列で絞れることに意味がある —— 束縛の解決のための畳み込みとは役割が違う(INV-SHELF-002 が一致を守る)。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
