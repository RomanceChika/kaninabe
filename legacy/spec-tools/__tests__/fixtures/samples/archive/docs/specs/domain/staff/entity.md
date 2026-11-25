---
doc_type: entity_spec
scope: common
id: staff-entity
entity: staff
label: 職員
context:
  department: staff.department_id  # 所属部署(可視性の境界)
  staff: staff.id                  # 自分自身(実行者の行の解決用)
fields:
  - name: id
    type: uuid
    auto: true
    label: 職員ID
    description: 職員ID
    personal: false
  - name: department_id
    type: ref(department)
    required: true
    session: true                  # 実行者の属性(actor.department_id)。可視性の境界の右辺
    label: 所属部署
    description: この職員が属する部署
    personal: false
  - name: display_name
    type: string
    required: true
    max_length: 40
    session: true
    label: 表示名
    description: 画面に出る名前
    personal: true
    personal_placeholder: "(退職)"
  - name: is_curator
    type: boolean
    required: true
    session: true
    label: 文書管理者かどうか
    description: 文書管理者の根拠(curator の claim が指す欄)
    personal: false
---

# 職員(staff)

- 在籍の状態機械は持たない — 退職の扱いは人事側が正であり、この系は入館証の写しを読むだけである。
- 役職の欄は持たない — 権限の軸は「文書管理者かどうか」の 1 本だけで足りている。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
