---
doc_type: entity_spec
scope: common
id: customer-entity
entity: customer
label: 顧客
context:
  customer: customer.id
fields:
  - name: id
    type: uuid
    auto: true
    label: 顧客ID
    description: 顧客ID
    personal: false
  - name: account_id
    type: uuid
    required: true
    label: アカウントID
    description: サインインしたアカウントとの対応
    personal: false
  - name: display_name
    type: string
    required: true
    max_length: 50
    label: 表示名
    description: 画面に出る名前
    personal: true
    personal_placeholder: "(消去済み)"
    session: true
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時(システム採番)
    personal: false
---

# 顧客(customer)

- **実行者の集約が状態機械を持つ形**である(仮登録 → 本登録 → 停止)。4 題材のどれにも無かった形。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
