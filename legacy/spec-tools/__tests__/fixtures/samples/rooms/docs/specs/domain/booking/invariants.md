---
doc_type: invariant_spec
scope: common
id: booking-invariants
invariants:
  - id: INV-BOOKING-001
    statement: 同じ部屋の同じ時間帯に、取消でない予約は 1 つしか存在しない（時間帯の重複禁止）
    entities: [booking]
    formal:
      type: exclusion
      keys: [room_id]
      range: [starts_at, ends_at]
      where: state not in [cancelled]
    enforced_by:
      - kind: db_constraint
        ref: bookings_room_slot_exclude     # 期間の重なりを見る排他制約
      - kind: guard
        ref: booking.confirm                # 確定時のアプリ側の早期エラー（UX 用）
  - id: INV-BOOKING-002
    statement: 終了日時は開始日時より後でなければならない
    entities: [booking]
    formal:
      type: check
      expr: booking.starts_at < booking.ends_at
    enforced_by:
      - kind: db_constraint
        ref: bookings_period_check
  - id: INV-BOOKING-003
    statement: 1 つの部屋に、取消でない予約は同時に 20 件までしか存在しない（台帳の暴走を止める天井）
    entities: [booking]
    formal:
      type: cardinality
      keys: [room_id]
      max: 20
      where: state not in [cancelled]
    enforced_by:
      - kind: trigger
        ref: check_booking_room_quota
---

# 予約の不変条件

- 重複の禁止は `exclusion`（期間の重なり）で書く。`keys` が一致する行どうしで `range` の半開区間 `[starts_at, ends_at)` が重ならない、という宣言であり、執行点の排他制約（`bookings_room_slot_exclude`）と `keys` / `range` が突き合わされる（T5）。「終了時刻 = 次の開始時刻」は重ならない扱いである（端の扱いは体系が半開に固定しており、宣言では選べない）。
- 「就業時間内だけ」は不変条件にしない — 部門ごとに違ううえ、夜間の利用を止める運用ではない。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
