---
doc_type: directory_guide
id: DG-FE-0001
norms: []
scope: frontend

# S10(UI 到達の網羅)の免除宣言。
unexposed: []

# S13(状態×ロールの到達)の免除宣言。
unreachable_states: []

# S14(状態の可視性)の免除宣言。
unseen_states:
  - state: stock_move.posted
    reason: 移動の履歴を返す読み取り経路は未着手(残高だけを見せている。棚の履歴画面が要るという実需が出てから起こす)
  - state: stock_move.voided
    reason: 同上。取り消した移動は残高の差分としてしか見えない
  - state: sales_order.paid
    reason: 入金済みの注文を返す読み取り経路は未着手(入金待ちの一覧だけを持つ)
  - state: sales_order.cancelled
    reason: 同上。取り消した注文の一覧はまだ誰も見ない
---

# 画面仕様(複数店舗の在庫と入金)

- 会社をまたぐ横断の画面は置かない — 会社の境界は access_spec の `reads[].filters`(`actor.company_id`)が持ち、画面は境界の内側だけを読む(束 ⑲-2a)。

<!-- AUTO-GENERATED:screen-index -->
<!-- /AUTO-GENERATED:screen-index -->
