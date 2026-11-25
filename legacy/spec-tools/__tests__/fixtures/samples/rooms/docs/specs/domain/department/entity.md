---
doc_type: entity_spec
scope: common
id: department-entity
entity: department
label: 部門
context:
  department: department.id       # 自分自身（department_admin binding の解決用）
fields:
  - name: id
    type: uuid
    auto: true
    label: 部門ID
    description: 部門ID
    personal: false
  - name: name
    type: string
    required: true
    max_length: 60
    label: 部門名
    description: 部門名（重複しない — INV-DEPARTMENT-001）
    personal: false
  - name: admin_id
    type: ref(user)
    required: true
    label: 部門管理者
    description: この部門の部屋の予約を承認する人
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時（システム採番）
    personal: false
---

# 部門（department）

- 部門の階層（親部門）は持たない — 承認の委譲の実例が無いうちに木構造を入れると、承認者の解決が仕様から読めなくなる。
- 状態機械を持たない。部門は「ある / 無い」だけの台帳である。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
