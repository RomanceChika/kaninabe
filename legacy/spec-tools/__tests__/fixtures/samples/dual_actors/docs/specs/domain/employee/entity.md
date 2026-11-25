---
doc_type: entity_spec
scope: common
id: employee-entity
entity: employee
label: 従業員
context:
  employee: employee.id
fields:
  - name: id
    type: uuid
    auto: true
    label: 従業員ID
    description: 従業員ID
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
    label: 氏名
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

# 従業員(employee)

- **2 つ目の実行者の集約**である。顧客と同じく `session: true` の欄を持つ。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
