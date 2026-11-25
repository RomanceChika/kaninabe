---
doc_type: access_spec
scope: common
id: shelf-access
entity: shelf
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none
  - by: store_manager
    scope: context(store)           # 自分が責任者である店舗の棚(棚から 2 段先)
creates:
  - by: store_manager
    when: section.company_id == actor.company_id   # 他社の売場に棚は作れない(テナント境界。売場は入力で受ける)
writes:
  - by: store_manager
    fields: [is_active]
    when: shelf.company_id == actor.company_id   # 他社の棚は直せない(テナント境界)
accept:
  - by: store_manager
    filter: company_id
    reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず実行者が責任者の店舗 —— 会社を跨いだ行はそもそも集合に入らない
---

# 棚のアクセス権限

- 棚の削除は持たない(deletes なし) — 台帳(残高・移動)がぶら下がっており、消すと過去の在庫が説明できなくなる。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
