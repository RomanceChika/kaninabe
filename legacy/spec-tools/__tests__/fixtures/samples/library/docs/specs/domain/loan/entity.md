---
doc_type: entity_spec
scope: common
id: loan-entity
entity: loan
label: 貸出
context:
  loan: loan.id                   # 自分自身(loan_owner の binding の解決用)
  item: loan.item_id              # 借りている蔵書(貸出可否のガードで参照する)
  patron: loan.patron_id          # 借りている利用者
fields:
  - name: id
    type: uuid
    auto: true
    label: 貸出ID
    personal: false
  - name: item_id
    type: ref(item)
    required: true
    label: 蔵書
    personal: false
  - name: patron_id
    type: ref(patron)
    required: true
    label: 借受者
    personal: false
  - name: due_at
    type: datetime
    required: true
    supplied_by: db               # 貸出期間は館の慣習。列の既定値が now() から決める
    label: 返却期限
    personal: false
  - name: state
    type: state(loan)
    label: 貸出状態
    personal: false
---

# 貸出

- 延長回数の欄は持たない — 延長はこの版で扱わない(期限は 1 度だけ決まる)。
- 貸出期間の日数は仕様の欄にしない — 館の運用設定であり、data_table の列の既定値の式が宣言する。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
