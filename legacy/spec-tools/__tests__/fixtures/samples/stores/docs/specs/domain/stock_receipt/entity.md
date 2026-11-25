---
doc_type: entity_spec
scope: common
id: stock_receipt-entity
entity: stock_receipt
label: 入荷伝票
context:
  company: stock_receipt.company_id  # 所属する会社(テナント)
  store: stock_receipt.store_id      # 棚の属する店舗(store_manager binding の解決用)
  shelf: stock_receipt.shelf_id      # 荷物を入れる棚
  stock_receipt: stock_receipt.id    # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 伝票ID
    description: 伝票ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(棚から引き当てる写し)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: store_id
    type: ref(store)
    required: true
    label: 所属店舗
    description: 棚の属する店舗の写し(2 段先の束縛を 1 段に畳むための列)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: shelf_id
    type: ref(shelf)
    required: true
    label: 棚
    description: この伝票の荷物を入れる棚
    personal: false
  - name: recorded_by
    type: ref(staff_member)
    required: true
    label: 記録者
    description: この伝票を起こした従業員
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 起票日時
    description: 起票日時(システム採番)
    personal: false
---

# 入荷伝票(stock_receipt)

- 伝票そのものは状態機械を持たない — 効くのはぶら下がる移動の行であり、伝票は束ねる器である。
- 複数の棚にまたがる伝票は作らない(棚は伝票に 1 つ) — 台帳の行が 1 つの棚に閉じるほうが残高の説明が短い。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
