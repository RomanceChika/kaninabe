---
doc_type: access_spec
scope: common
id: product-access
entity: product
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
    scope: none                     # 同上
creates:
  - by: company_admin
    when: product.company_id == actor.company_id   # 他社の商品は作れない(テナント境界。company_id は入力で受けるので、ここで結ばないと他社に作れる)
writes:
  - by: company_admin
    fields: [name, unit_price]
    when: product.company_id == actor.company_id   # 他社の商品は直せない(テナント境界)
---

# 商品のアクセス権限

- 商品コードの付け替えは受けない(sku は writes に無い) — 過去の移動の照合キーが遡って変わる。
- 商品の削除は持たない(deletes なし) — 台帳が参照している。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
