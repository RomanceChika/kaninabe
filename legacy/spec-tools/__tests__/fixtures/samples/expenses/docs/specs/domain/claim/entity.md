---
doc_type: entity_spec
scope: common
id: claim-entity
entity: claim
label: 経費申請
context:
  claim: claim.id                 # 自分自身(claim_owner / approver の binding の解決用)
  employee: claim.employee_id     # 申請者の行(表示名の供給元)
fields:
  - name: id
    type: uuid
    auto: true
    label: 申請ID
    description: 申請ID
    personal: false
  - name: employee_id
    type: ref(employee)
    required: true
    label: 申請者
    description: この申請を出した従業員(作成時の実行者)
    personal: false
  - name: approver_id
    type: ref(employee)
    required: true
    label: 承認者
    description: この申請を承認する従業員(申請ごとに指名する)
    personal: false
  - name: title
    type: string
    required: true
    max_length: 80
    label: 件名
    description: 申請の件名(一覧に出る)
    personal: false
  - name: purpose
    type: text
    max_length: 500
    label: 目的
    description: 何のための支出かの説明
    personal: false
  - name: total_amount
    type: integer
    min: 0
    max: 100000000
    label: 合計額
    description: 明細の合計(提出時に確定する。入力では受け取らない)
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 作成日時
    description: 申請を作った日時
    personal: false
  - name: state
    type: state(claim)
    label: 状態
    description: 申請の状態
    personal: false
---

# 経費申請

- 支払日の欄は持たない — 支払い済みかどうかは状態(paid)が表し、日時は監査ログが持つ。
- total_amount を supplied_by: db にしない — 合計は明細の集計であり、締めの規則(税・上限)が
  入る余地を残すために純関数(computes)の側に置く。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
