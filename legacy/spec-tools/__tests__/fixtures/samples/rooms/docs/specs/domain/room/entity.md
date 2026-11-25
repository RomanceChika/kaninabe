---
doc_type: entity_spec
scope: common
id: room-entity
entity: room
label: 会議室
context:
  department: room.department_id  # この部屋を持つ部門（department_admin binding の解決用）
fields:
  - name: id
    type: uuid
    auto: true
    label: 会議室ID
    description: 会議室ID
    personal: false
  - name: department_id
    type: ref(department)
    required: true
    label: 所属部門
    description: この部屋を管理する部門
    personal: false
  - name: name
    type: string
    required: true
    max_length: 60
    label: 部屋名
    description: 部屋名（部門の中で重複しない — INV-ROOM-001）
    personal: false
  - name: capacity
    type: integer
    required: true
    min: 1
    max: 200
    label: 定員
    description: 着席できる人数
    personal: false
  - name: has_projector
    type: boolean
    required: true
    label: プロジェクタの有無
    description: プロジェクタが備え付けかどうか
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時（システム採番）
    personal: false
---

# 会議室（room）

- 「貸出停止中」の状態は持たない — 停止の実例が改修の 1 件だけで、その間の予約は部門管理者が個別に却下している。
- 設備は真偽値 1 つだけに留める — 設備の台帳を別集約にするのは、備品の貸出を扱う日にまとめて決める。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
