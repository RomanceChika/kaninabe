---
doc_type: access_spec
scope: common
id: staff_member-access
entity: staff_member
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all                      # 移動の記録者名を出すため、従業員の台帳は開く
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none                     # staff_member として全件読める
  - by: store_manager
    scope: none                     # store 文脈のロール。従業員は staff_member として読む
fields_hidden:
  - field: email                    # 連絡先は管理側の情報。一覧には出さない
    from: [staff_member]
  - field: phone
    from: [staff_member]
---

# 従業員のアクセス権限

- 本人だけが自分の連絡先を直せる、という規則は書けない — `own` の解決は宣言できても「本人にだけ見せる」方向の宣言が無い(隠す方向しか無い)。
- 従業員の作成・削除・編集はこの仕組みでは扱わない(creates / writes / deletes なし) — 入社・退社・任免の正は人事側にあり、`is_admin` は人事側の同期が書く。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
