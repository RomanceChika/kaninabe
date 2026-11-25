---
doc_type: invariant_spec
scope: common
id: department-invariants
invariants:
  - id: INV-DEPARTMENT-001
    statement: 部門名は重複しない（同じ部門を二重登録しない）
    entities: [department]
    formal:
      type: uniqueness
      keys: [name]
    enforced_by:
      - kind: db_constraint
        ref: departments_name_unique
---

# 部門の不変条件

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
