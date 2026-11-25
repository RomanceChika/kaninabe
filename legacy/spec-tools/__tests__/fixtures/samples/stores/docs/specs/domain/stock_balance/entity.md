---
doc_type: entity_spec
scope: common
id: stock_balance-entity
entity: stock_balance
label: 在庫残高
context:
  company: stock_balance.company_id # 所属する会社(テナント)
  store: stock_balance.store_id     # 棚の属する店舗(store_manager binding の解決用)
  shelf: stock_balance.shelf_id     # 置き場
  product: stock_balance.product_id # 商品
fields:
  - name: id
    type: uuid
    auto: true
    label: 残高ID
    description: 残高ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(shelf.company_id の写し)
    personal: false
  - name: store_id
    type: ref(store)
    required: true
    label: 所属店舗
    description: 棚の属する店舗の写し(2 段先の束縛を 1 段に畳むための列)
    personal: false
  - name: shelf_id
    type: ref(shelf)
    required: true
    label: 棚
    description: 残高を数える棚
    personal: false
  - name: product_id
    type: ref(product)
    required: true
    label: 商品
    description: 残高を数える商品
    personal: false
  - name: quantity
    type: integer
    required: true
    supplied_by: db                 # 入力にも実行者にも現れない。移動のトリガが積み上げる(V17)
    min: -100000
    max: 100000
    label: 現在数
    description: 棚 × 商品の現在数(取消でない移動の合計 — INV-STOCK-BALANCE-001)
    personal: false
  - name: updated_at
    type: datetime
    auto: true
    label: 更新日時
    description: 最後に移動が効いた日時(システム採番)
    personal: false
---

# 在庫残高(stock_balance)

- 残高を「移動の合計をその場で数える読み取り」にしない — 棚 × 商品あたりの行数が増え続け、一覧の読み取りが台帳の全走査になる。
- 履歴(いつ何個だったか)は持たない — それは移動の側にある事実である。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
