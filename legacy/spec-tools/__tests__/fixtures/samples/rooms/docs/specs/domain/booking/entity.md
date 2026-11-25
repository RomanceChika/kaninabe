---
doc_type: entity_spec
scope: common
id: booking-entity
entity: booking
label: 予約
context:
  booking: booking.id                # 自分自身（自分の欄をガード式から参照するため）
  room: booking.room_id           # 予約した部屋（部門はここから 2 段目で辿る）
  user: booking.user_id           # 申込者
fields:
  - name: id
    type: uuid
    auto: true
    label: 予約ID
    description: 予約ID
    personal: false
  - name: room_id
    type: ref(room)
    required: true
    label: 会議室
    description: 予約した会議室
    personal: false
  - name: user_id
    type: ref(user)
    required: true
    label: 申込者
    description: 予約を入れた人
    personal: false
  - name: reference_no
    type: string
    required: true
    max_length: 16
    supplied_by: db               # 入力にも実行者にも現れない。DB が採番する（V17）
    label: 予約番号
    description: 受付票に印字する連番（DB が採番する）
    personal: false
  - name: purpose
    type: enum([meeting, interview, other])
    required: true
    labels:
      meeting: 打合せ
      interview: 面接
      other: その他
    label: 利用目的
    description: 利用目的（面接は部屋の外に予定を出さない扱いにするための区別）
    personal: false
  - name: title
    type: string
    required: true
    max_length: 80
    label: 件名
    description: 予約一覧に出る件名
    personal: false
  - name: starts_at
    type: datetime
    required: true
    label: 開始日時
    description: 利用の開始日時
    personal: false
  - name: ends_at
    type: datetime
    required: true
    label: 終了日時
    description: 利用の終了日時（開始より後 — INV-BOOKING-002）
    personal: false
  - name: note
    type: string
    max_length: 300
    label: 連絡事項
    description: 部門管理者への連絡事項（自由記述）
    personal: true
    personal_placeholder: null
  - name: state
    type: state(booking)
    label: 状態
    description: 予約の状態（states.md が正）
    personal: false
---

# 予約（booking）

- 繰り返し予約（毎週◯曜）は列に持たない — 1 回の予約が 1 行であることを崩すと、重複の禁止を一意制約で書けなくなる。
- 参加者の名簿はこの集約に持たない — 会議室の確保と出席管理は別の仕事である。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
