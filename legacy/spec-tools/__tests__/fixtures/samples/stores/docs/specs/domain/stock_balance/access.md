---
doc_type: access_spec
scope: common
id: stock_balance-access
entity: stock_balance
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
    scope: context(store)           # 自分が責任者である店舗の残高
accept:
  - by: store_manager
    filter: company_id
    reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず実行者が責任者の店舗 —— 会社を跨いだ行はそもそも集合に入らない
---

# 在庫残高のアクセス権限

- 誰も作れず・書けず・消せない(creates / writes / deletes を宣言しない) — 残高は移動から導かれる値であり、人が直接触る口を開けると台帳の一致が主張でしかなくなる。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
