---
doc_type: invariant_spec
scope: common
id: entry-invariants
invariants:
  - id: INV-ENTRY-001
    statement: 何かの不変条件
    entities: [entry]
    formal:
      type: aggregate_limit
      keys: [workshop_id]
    enforced_by:
      - kind: db_constraint
        ref: entries_active_unique
  - id: INV-ENTRY-002
    statement: 執行点の宣言が無い不変条件
    entities: [entry]
    formal:
      type: uniqueness
      keys: [workshop_id]
  - id: INV-ENTRY-003
    statement: 前提を when で書いてしまった不変条件
    entities: [entry, workshop]
    formal:
      type: state_dependency
      when: "workshop.state == program_published"
      then: "entry.state in [accepted, withdrawn]"
    enforced_by:
      - kind: application
        ref: assert_entry_state
---

# formal.type が値域の外、enforced_by 欠落
