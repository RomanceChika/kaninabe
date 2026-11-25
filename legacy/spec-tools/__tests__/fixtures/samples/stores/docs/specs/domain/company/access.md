---
doc_type: access_spec
scope: common
id: company-access
entity: company
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all                      # 行は全社ぶんあるが、filters で自分の会社だけに狭める
    filters: { id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none                     # staff_member として読めるので、このロールで読む必要が無い
  - by: store_manager
    scope: none                     # store 文脈のロール。会社は staff_member として読む
---

# 会社のアクセス権限

- `scope: own` は採れない — company は実行者の行を指す `ref(staff_member)` を持たず、own の解決先が無い。
- 会社の列を書き換える宣言は置かない(creates / writes / deletes なし = 誰も書けない)。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
