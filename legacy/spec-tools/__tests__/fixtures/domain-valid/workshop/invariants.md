---
doc_type: invariant_spec
scope: common
id: workshop-invariants
invariants:
  - id: INV-WORKSHOP-001
    statement: エントリー締切は開演日時より前でなければならない
    entities: [workshop]
    formal:
      type: check
      expr: "workshop.entry_deadline < workshop.starts_at"
    enforced_by:
      - kind: db_constraint
        ref: workshops_deadline_before_start
---

# 催しの不変条件
