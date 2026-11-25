---
doc_type: invariant_spec
scope: common
id: entry-invariants
invariants:
  - id: INV-ENTRY-001
    statement: 同一発表者は同一催しにアクティブなエントリーを1つしか持てない
    entities: [entry]
    formal:
      type: uniqueness
      keys: [workshop_id, performer_id]
      where: "state not in [withdrawn, rejected]"
    enforced_by:
      - kind: db_constraint
        ref: entries_active_unique
      - kind: guard
        ref: entry.submit
  - id: INV-ENTRY-002
    statement: 1つの催しに受理済みエントリーは定員数までしか存在しない
    entities: [entry, workshop]
    formal:
      type: cardinality
      keys: [workshop_id]
      max: "workshop.capacity"
      where: "state == accepted"
    enforced_by:
      - kind: trigger
        ref: entries_capacity_check
  - id: INV-ENTRY-003
    statement: 受理済みエントリーの合計発表時間は催しの発表枠を超えない
    entities: [entry, workshop]
    enforced_by:
      - kind: application
        ref: assert_total_duration_within_slot
---

# エントリーの不変条件
