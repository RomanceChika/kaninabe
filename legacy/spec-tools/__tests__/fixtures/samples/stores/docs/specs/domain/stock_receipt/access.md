---
doc_type: access_spec
scope: common
id: stock_receipt-access
entity: stock_receipt
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
    scope: context(store)           # 自分が責任者である店舗の伝票
creates:
  - by: staff_member
    when: shelf.is_active == true and shelf.company_id == actor.company_id   # 使えない棚・他社の棚には荷物を入れられない(テナント境界)
accept:
  - by: store_manager
    filter: company_id
    reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず実行者が責任者の店舗 —— 会社を跨いだ行はそもそも集合に入らない
---

# 入荷伝票のアクセス権限

- 伝票の編集・削除は持たない(writes / deletes なし) — 中身の訂正は打ち消しの移動で行う。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
