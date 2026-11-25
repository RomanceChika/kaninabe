---
doc_type: invariant_spec
scope: common
id: payment_notice-invariants
invariants:
  - id: INV-PAYMENT-NOTICE-001
    statement: 外部イベントIDは重複しない(決済サービスの再送で二重に反映しない)
    entities: [payment_notice]
    formal:
      type: uniqueness
      keys: [external_event_id]
    enforced_by:
      - kind: db_constraint
        ref: payment_notices_external_event_id_unique
---

# 入金通知の不変条件

- 「署名を検証できなかった通知は注文を動かさない」を不変条件にしない — 受信口が署名を検証してから記録するので、検証を通らなかった通知は行として存在しない。行の内容についての条件ではなく書き込みの経路についての条件であり、執行点は受信口(生成物)である。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
