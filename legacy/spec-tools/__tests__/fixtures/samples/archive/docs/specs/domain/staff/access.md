---
doc_type: access_spec
scope: common
id: staff-access
entity: staff
reads:
  - by: anonymous
    scope: none
  - by: staff
    scope: all                              # 社内の名簿は社内に開く
    filters: { department_id: actor.department_id }   # 他部署の名簿は引けない(部署の境界)
  - by: curator
    scope: none                             # staff として読める
  - by: document_author
    scope: none                             # document 文脈のロール
  - by: system
    scope: all
---

# 職員のアクセス権限

- **「自分の部署の職員だけ見える」は `reads[].filters` で宣言する。** `actor.department_id` が引けるのは `staff.department_id` が `session: true` を宣言しているからである。
- 職員を作る口・消す口は持たない — 行の正は人事側の台帳である。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
