---
doc_type: invariant_spec
scope: common
id: room-invariants
invariants:
  - id: INV-ROOM-001
    statement: 同じ部門の中で部屋名は重複しない
    entities: [room]
    formal:
      type: uniqueness
      keys: [department_id, name]
    enforced_by:
      - kind: db_constraint
        ref: rooms_department_name_unique
  - id: INV-ROOM-002
    statement: 予約が入っている部屋は台帳から消えない（使用中のため削除できない）
    entities: [room, booking]
    enforced_by:
      - kind: db_constraint
        ref: bookings_room_id_fkey
---

# 会議室の不変条件

- 「予約が 0 件のときだけ消せる」を `deletes[].when` に書く道は採らない — 集計を書く語彙がガード式に無く、書けたとしても判断と削除の間に予約が入れば同じことが起きる。執行点は参照整合そのものである。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
