---
doc_type: entity_spec
scope: common
id: patron-entity
entity: patron
label: 利用者
fields:
  - name: id
    type: uuid
    auto: true
    label: 利用者ID
    personal: false
  - name: display_name
    type: string
    max_length: 40
    required: true
    session: true
    label: 表示名
    personal: true
    personal_placeholder: 退会した利用者
  - name: is_librarian
    type: boolean
    required: true
    session: true
    label: 司書フラグ
    personal: false
  - name: card_number
    type: string
    required: true
    supplied_by: db
    max_length: 9                 # 'L' + lpad(採番, 8)(lpad は 8 桁に切り詰めるので常に 9 文字)
    label: 利用者番号
    personal: false
  - name: card
    type: enum([valid, expired, revoked])
    required: true
    labels:
      valid: 有効
      expired: 期限切れ
      revoked: 停止
    label: カードの状態
    description: 利用者カードの状態（auth.md の決定表の主語。期限切れは窓口で更新する）
    personal: false
---

# 利用者

- 住所・電話番号の欄は持たない — 貸出の可否に要らない個人情報を集約に入れない。
- 退会は状態機械を持たせない — 行を残す必要が無くなったら削除で扱う(この版では削除の口も作らない)。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
