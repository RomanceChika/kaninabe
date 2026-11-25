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
  - name: display_name
    type: string
    required: true
    max_length: 50
    label: 表示名
    description: 申請・承認の画面に出る名前
    personal: true
    personal_placeholder: "(消去済み)"
    session: true
  - name: department
    type: string
    max_length: 50
    label: 部署
    description: 所属部署(集計の見出しに使う)
    personal: false
  - name: is_accountant
    type: boolean
    required: true
    label: 経理担当
    description: 経理担当かどうか(支払いを実行できる根拠の欄)
    personal: false
    session: true
---

# 従業員

- 役職・等級の欄は持たない — 承認の権限は申請ごとの指名(approver_id)で決まり、組織図を写さない。
- 在籍状態の状態機械は持たない(この題材では退職の扱いを人事側の台帳に委ねる)。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
