---
doc_type: access_spec
scope: common
id: section-access
entity: section
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all                      # 売場の名前は在庫の場所を読むために全員に開く
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none                     # staff_member として全件読める
  - by: store_manager
    scope: none                     # 同上
creates:
  - by: store_manager
    when: store.company_id == actor.company_id   # 他社の店舗に売場は作れない(テナント境界)
deletes:
  - by: store_manager
    when: store.company_id == actor.company_id   # 他社の売場は消せない(テナント境界)
---

# 売場のアクセス権限

- 売場の改名は持たない(writes なし) — 名前が変わるなら別の売場として作り直す運用である。
- 削除の前提(棚がぶら下がっていないこと)は `when` に書けない — 件数を数える語彙がガード式に無い。執行点は参照整合そのもの(INV-SECTION-003)。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
