---
doc_type: access_spec
scope: common
id: payment_notice-access
entity: payment_notice
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: none                     # 入金の生の記録は一般の従業員には見せない
  - by: system
    scope: all
  - by: company_admin
    scope: all                      # 照合の食い違いを調べるのは会社管理者の仕事
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: store_manager
    scope: context(store)           # 自店の注文に紐づく通知(payment_notice → sales_order → store の 2 段)
creates:
  - by: system                      # 受信口(Webhook)だけが行を作る
accept:
  - by: store_manager
    filter: company_id
    reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず実行者が責任者の店舗 —— 会社を跨いだ行はそもそも集合に入らない
  - by: system
    filter: company_id
    on: [create]
    reason: 受信口(Webhook)は決済サービスの署名つきの通知を、注文番号で照合した注文に紐づけて記録するだけの内部実行で、実行者の会社を持たない。通知の会社は照合した注文の会社であり、会社を跨ぐのは通知が指す注文が他社のものであるときだけ(それは通知の正しい宛先)
---

# 入金通知のアクセス権限

- 人が作れる口は開けない(creates は system だけ) — 入金の事実の供給元は決済サービスの通知だけである。
- 店舗責任者の可視性は `scope: context(store)` である — `store_manager` の binding が立つのは店舗であり、通知からそこへは `payment_notice → sales_order → store` と `context` を 2 段辿って届く(束 ⑲-2a)。束 ⑱ ではここが 1 段しか辿れず、可視性を `none` に落とすしかなかった。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
