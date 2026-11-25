---
doc_type: entity_spec
scope: common
id: stock_move-entity
entity: stock_move
label: 在庫の移動
context:
  company: stock_move.company_id    # 所属する会社(テナント)
  store: stock_move.store_id        # 棚の属する店舗(store_manager binding の解決用)
  stock_receipt: stock_move.receipt_id  # この移動を束ねる伝票
  shelf: stock_move.shelf_id        # 置き場
  product: stock_move.product_id    # 動いた商品
  stock_move: stock_move.id         # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 移動ID
    description: 移動ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(shelf.company_id の写し — INV-STOCK-MOVE-003)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: store_id
    type: ref(store)
    required: true
    label: 所属店舗
    description: 棚の属する店舗の写し(2 段先の束縛を 1 段に畳むための列 — INV-STOCK-MOVE-004)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: receipt_id
    type: ref(stock_receipt)
    required: true
    label: 伝票
    description: この移動を束ねる入荷伝票(棚と店舗と会社はここから引き当てる)
    personal: false
  - name: shelf_id
    type: ref(shelf)
    required: true
    label: 棚
    description: 動いた先の棚(伝票の写し — INV-STOCK-MOVE-003)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: product_id
    type: ref(product)
    required: true
    label: 商品
    description: 動いた商品
    personal: false
  - name: kind
    type: enum([receipt, issue, count])
    required: true
    labels:
      receipt: 入庫
      issue: 出庫
      count: 棚卸
    label: 種別
    description: 移動の種別(入庫は加算・出庫は減算・棚卸は差分の記録)
    personal: false
  - name: quantity
    type: integer
    required: true
    min: -100000
    max: 100000
    label: 数量
    description: 増減の数量(整数。出庫は負の数で記録する — INV-STOCK-MOVE-002)
    personal: false
  - name: source_ref
    type: string
    max_length: 64
    label: 送り元の伝票番号
    description: 外部の入荷システムが付けた伝票番号(再送の判別に使う — INV-STOCK-MOVE-001)
    personal: false
  - name: recorded_by
    type: ref(staff_member)
    required: true
    label: 記録者
    description: この移動を記録した従業員
    personal: false
  - name: recorded_at
    type: datetime
    auto: true
    label: 記録日時
    description: 記録日時(システム採番)
    personal: false
  - name: state
    type: state(stock_move)
    label: 状態
    description: 移動の状態(states.md が正)
    personal: false
---

# 在庫の移動(stock_move)

- 「下書き」の状態は置かない — 台帳の行は書いた瞬間に残高へ効くのが正しく、下書きは残高の一致(INV-STOCK-BALANCE-001)の意味を曖昧にする。
- 棚を入力で受けない(伝票から引き当てる) — 1 枚の伝票の中で行ごとに棚が違う形を許すと、伝票の意味が消える。
- 移動の理由(破損・返品)は列に持たない — `kind` の 3 値で会計の向きは決まり、理由は運用の記録である。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
