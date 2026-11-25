---
doc_type: entity_spec
scope: common
id: sales_order-entity
entity: sales_order
label: 注文
context:
  company: sales_order.company_id   # 所属する会社(テナント)
  store: sales_order.store_id       # 受けた店舗(store_manager binding の解決用)
  sales_order: sales_order.id       # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 注文ID
    description: 注文ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(store.company_id の写し)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: store_id
    type: ref(store)
    required: true
    label: 受注店舗
    description: この注文を受けた店舗
    personal: false
  - name: order_no
    type: string
    required: true
    max_length: 16
    supplied_by: db                 # 入力にも実行者にも現れない。DB が採番する(V17)
    label: 注文番号
    description: 決済サービスへ渡す注文番号(DB が採番する)
    personal: false
  - name: total_amount
    type: integer
    required: true
    min: 1
    max: 10000000
    label: 請求額
    description: 請求額(円・税込)
    personal: false
  - name: customer_name
    type: string
    required: true
    max_length: 60
    label: 注文者名
    description: 受け取りに来る人の名前
    personal: true
    personal_placeholder: "(消去済み)"
  - name: placed_by
    type: ref(staff_member)
    required: true
    label: 受注者
    description: 注文を登録した従業員
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 受注日時
    description: 受注日時(システム採番)
    personal: false
  - name: state
    type: state(sales_order)
    label: 状態
    description: 注文の状態(states.md が正)
    personal: false
---

# 注文(sales_order)

- 明細(何をいくつ)は持たない — この題材で試したいのは入金の受信であり、明細は別集約の話である。
- 入金額の列は持たない — 入金の事実は `payment_notice` の行が正であり、写すと 2 つの正ができる。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
