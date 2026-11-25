---
doc_type: access_spec
scope: common
id: store-access
entity: store
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all                      # 応援勤務があるため、店舗の台帳は全員に開く
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none                     # staff_member として全件読める
  - by: store_manager
    scope: none                     # 同上
creates:
  - by: company_admin
    when: store.company_id == actor.company_id and staff_member.company_id == actor.company_id   # 他社の店舗は作れず、他社の従業員を責任者にもできない(テナント境界。責任者は入力で受ける)
    delegate:
      - field: store.manager_id
        reason: 会社管理者が店舗を開くときに責任者を指名する(自分以外を選ぶのが業務)
    self_assign:
      - field: store.manager_id
        role: store_manager
        by: [company_admin]
        reason: 会社管理者が店舗を開くときに責任者を指名する。会社管理者は自社の店舗を既に管理できるので、自分を責任者にしても新しい権限は増えない
writes:
  - by: company_admin
    fields: [name, manager_id]
    when: store.company_id == actor.company_id   # 他社の店舗は直せない(テナント境界)
    self_assign:
      - field: store.manager_id
        role: store_manager
        by: [company_admin]
        reason: 会社管理者が店舗の責任者を任免する。会社管理者は自社の店舗を既に管理できるので、自分を責任者にしても新しい権限は増えない
  - by: store_manager
    fields: [name]
    when: store.company_id == actor.company_id   # 責任者の店舗でも、他社の店舗は直せない(テナント境界)
---

# 店舗のアクセス権限

- **「自分の会社の店舗だけ見える」は `reads[].filters` で宣言する。** `scope` は「原理としてどの行か」を答え、`filters` が「実行者の属性でどこまで狭めるか」を答える(束 ⑲-2a)。`actor.company_id` が引けるのは `staff_member.company_id` が `session: true` を宣言しているからで、そこが外れれば V2 がエラーにする。
- **他社の店舗を作れる口も塞いである**(`creates[].when`)。`company_id` は入力で受けるが、実行者の会社と一致しなければ作成が許可されない。
- **責任者の付け替えが他社の従業員を指す穴は DB のトリガが塞ぐ。** 編集の `when` は今ある行(旧い責任者)しか読めないが、INV-STORE-002 のコミット時評価の制約トリガ(店舗の側・責任者の側)が新しい責任者の会社を確かめるので、`accept` は要らない(V26 は執行点が実在する不変条件として数える)。
- 店舗の削除は持たない(deletes なし) — 売場と棚と台帳がぶら下がっており、消す実例が無い。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
