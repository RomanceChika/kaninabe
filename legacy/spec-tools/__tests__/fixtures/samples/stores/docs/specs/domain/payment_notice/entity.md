---
doc_type: entity_spec
scope: common
id: payment_notice-entity
entity: payment_notice
label: 入金通知
context:
  company: payment_notice.company_id      # 所属する会社(テナント)
  sales_order: payment_notice.order_id    # 照合した注文
  payment_notice: payment_notice.id       # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 入金通知ID
    description: 入金通知ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(注文から引き当てる)
    personal: false
  - name: order_id
    type: ref(sales_order)
    required: true
    label: 注文
    description: 注文番号で照合した注文
    personal: false
  - name: external_event_id
    type: string
    required: true
    max_length: 80
    label: 外部イベントID
    description: 決済サービスが付けたイベントID(再送の判別に使う — INV-PAYMENT-NOTICE-001)
    personal: false
  - name: amount
    type: integer
    required: true
    min: 1
    max: 10000000
    label: 入金額
    description: 決済サービスが通知した入金額(円)
    personal: false
  - name: received_at
    type: datetime
    auto: true
    label: 受信日時
    description: 受信日時(システム採番)
    personal: false
---

# 入金通知(payment_notice)

- 決済サービスが送ってくる本文をそのまま残す列は持たない — 個人データが紛れ込む口になり、消去の経路が読めなくなる。
- 署名の検証結果を列に持たない — 検証は受信口(生成された Route Handler)の仕事であり、通らなかった通知はそもそも行にならない(401 を返して記録しない)。「検証済みかどうか」の列があると、false の行を作る経路が仕様のどこにも無いのに列だけが残る。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
