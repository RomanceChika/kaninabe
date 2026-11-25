---
doc_type: invariant_spec
scope: common
id: staff_member-invariants
invariants:
  - id: INV-STAFF-MEMBER-001
    statement: メールアドレスは会社をまたいで重複しない(1 人 1 アカウント)
    entities: [staff_member]
    formal:
      type: uniqueness
      keys: [email]
    enforced_by:
      - kind: db_constraint
        ref: staff_members_email_unique
  - id: INV-STAFF-MEMBER-002
    statement: 1 つの会社に会社管理者は 5 人までしか存在しない
    entities: [staff_member]
    formal:
      type: cardinality
      keys: [company_id]
      max: 5
      where: is_admin == true
    enforced_by:
      - kind: trigger
        ref: check_company_admin_quota
---

# 従業員の不変条件

- 「会社管理者は最低 1 人」は書けない — 下限を表す形式定義が無く、`cardinality` は上限しか持たない。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
