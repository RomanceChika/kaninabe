---
doc_type: invariant_spec
scope: common
id: company-invariants
invariants:
  - id: INV-COMPANY-001
    statement: 会社名は重複しない(同じ会社を二重登録しない)
    entities: [company]
    formal:
      type: uniqueness
      keys: [name]
    enforced_by:
      - kind: db_constraint
        ref: companies_name_unique
---

# 会社の不変条件

- 「1 会社あたりの店舗数の上限」は置かない — 契約で決まる値であり、業務の決まりではない。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
