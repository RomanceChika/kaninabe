---
doc_type: invariant_spec
scope: common
id: section-invariants
invariants:
  - id: INV-SECTION-001
    statement: 同じ店舗の中で売場名は重複しない
    entities: [section]
    formal:
      type: uniqueness
      keys: [store_id, name]
    enforced_by:
      - kind: db_constraint
        ref: sections_store_name_unique
  - id: INV-SECTION-002
    statement: 売場が持つ会社は、その店舗の会社と一致する(テナントの境界が木の途中でずれない)
    entities: [section, store]
    formal:
      type: check
      expr: section.company_id == store.company_id
    enforced_by:
      - kind: trigger
        ref: sync_section_company
  - id: INV-SECTION-003
    statement: 棚がぶら下がっている売場は消えない
    entities: [section, shelf]
    enforced_by:
      - kind: db_constraint
        ref: shelves_section_id_fkey
---

# 売場の不変条件

- INV-SECTION-002 を「会社は店舗から辿って読む」で済ませない — 辿れるのは 1 段だけで、棚から会社へは届かないため、木の各段が会社を持つ形にしてある。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
