---
doc_type: access_spec
scope: common
id: sales_order-access
entity: sales_order
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none                     # staff_member として全件読める
  - by: store_manager
    scope: context(store)           # 自分が責任者である店舗の注文
fields_hidden:
  - field: customer_name            # 注文者名は会社の全員には出さない
    from: [staff_member]
creates:
  - by: staff_member
    when: store.company_id == actor.company_id   # 他社の店舗に注文は立てない(テナント境界。company_id は店舗から写す列なので、入力の店舗で結ぶ)
accept:
  - by: store_manager
    filter: company_id
    reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず実行者が責任者の店舗 —— 会社を跨いだ行はそもそも集合に入らない
---

# 注文のアクセス権限

- 請求額の後からの編集は持たない(writes なし) — 決済サービスへ渡した金額が動くと、入金の照合が成り立たない。
- 削除も持たない(deletes なし) — 取り消しは状態遷移(cancel)が担う。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
