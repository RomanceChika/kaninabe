---
doc_type: entity_spec
scope: common
id: hold-entity
entity: hold
label: 予約
context:
  hold: hold.id                   # 自分自身(hold_owner の binding の解決用)
  item: hold.item_id              # 予約している蔵書
  patron: hold.patron_id          # 予約している利用者
fields:
  - name: id
    type: uuid
    auto: true
    label: 予約ID
    personal: false
  - name: item_id
    type: ref(item)
    required: true
    label: 対象蔵書
    personal: false
  - name: patron_id
    type: ref(patron)
    required: true
    label: 予約者
    personal: false
  - name: note
    type: string
    max_length: 200
    label: 連絡事項
    personal: true
    personal_placeholder: null
  - name: state
    type: state(hold)
    label: 予約状態
    personal: false
---

# 予約

- 予約の順番待ち番号は持たない — 待ち行列の運用はこの版の線の外(1 蔵書 1 予約で始める)。

<!-- AUTO-GENERATED:field-table -->
| フィールド | 表示名(label) | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- | --- |
| id | 予約ID | uuid | —（行では必須） | auto=true | — |
| item_id | 対象蔵書 | ref(item) | ✓ | — | — |
| patron_id | 予約者 | ref(patron) | ✓ | — | — |
| note | 連絡事項 | string | — | max_length=200 | — |
| state | 予約状態 | state(hold) | —（行では必須） | — | — |
<!-- /AUTO-GENERATED:field-table -->
