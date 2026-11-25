---
doc_type: entity_spec
scope: common
id: line-entity
entity: line
label: 明細
context:
  claim: line.claim_id
fields:
  - name: id
    type: uuid
    auto: true
    label: 明細ID
    description: 明細ID
    personal: false
  - name: claim_id
    type: ref(claim)
    required: true
    label: 申請
    description: この明細が属する申請
    personal: false
  - name: spent_on
    type: date
    required: true
    label: 支出日
    description: 支出した日
    personal: false
  - name: category
    type: enum([transport, lodging, supplies, entertainment])
    required: true
    label: 費目
    description: 費目の区分
    labels:
      transport: 交通費
      lodging: 宿泊費
      supplies: 消耗品費
      entertainment: 交際費
    personal: false
  - name: amount
    type: integer
    min: 1
    max: 1000000
    required: true
    label: 金額
    description: 明細1行の金額(円)
    personal: false
  - name: memo
    type: string
    max_length: 200
    label: 摘要
    description: 支出の摘要(取引先・用途)
    personal: false
---

# 明細

- 領収書の画像はこの版では持たない — 添付の保管は別系の責務にする線引き。
- 税区分の欄は持たない(合計は税込の総和として扱う)。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
