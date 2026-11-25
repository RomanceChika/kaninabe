---
doc_type: invariant_spec
scope: common
id: hold-invariants
invariants:
  - id: INV-HOLD-001
    statement: 同じ利用者が同じ蔵書に対して持てる有効な予約は1件までである
    entities: [hold]
    formal:
      type: uniqueness
      keys: [item_id, patron_id]
      where: state not in [collected, cancelled]
    enforced_by:
      - kind: db_constraint
        ref: holds_active_unique
---

# 予約の不変条件

- 「取置中の予約は在架の蔵書に限る」は不変条件にしない — 取り置いた時点で蔵書は棚から外れるため、常には成り立たない。

<!-- AUTO-GENERATED:invariant-table -->
| ID | 内容 | 形式定義 | 執行点 |
| --- | --- | --- | --- |
| INV-HOLD-001 | 同じ利用者が同じ蔵書に対して持てる有効な予約は1件までである | unique(item_id, patron_id) where state not in [collected, cancelled] | db_constraint: holds_active_unique |
<!-- /AUTO-GENERATED:invariant-table -->
