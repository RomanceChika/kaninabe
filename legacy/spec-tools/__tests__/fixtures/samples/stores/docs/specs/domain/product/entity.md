---
doc_type: entity_spec
scope: common
id: product-entity
entity: product
label: 商品
context:
  company: product.company_id       # 所属する会社(テナント)
  product: product.id               # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 商品ID
    description: 商品ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: この商品台帳を持つ会社
    personal: false
  - name: sku
    type: string
    required: true
    max_length: 24
    label: 商品コード
    description: 商品コード(会社の中で重複しない — INV-PRODUCT-001)
    personal: false
  - name: name
    type: string
    required: true
    max_length: 80
    label: 商品名
    description: 棚札と一覧に出る名前
    personal: false
  - name: unit_price
    type: integer
    required: true
    min: 0
    max: 10000000
    label: 単価
    description: 売値(円・税込)
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時(システム採番)
    personal: false
---

# 商品(product)

- 取扱終了の状態機械は持たない — 残高が 0 になった商品を隠すのは読み取り側の絞り込みで足りる。
- 仕入値は列に持たない(この仕組みは原価を扱わない)。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
