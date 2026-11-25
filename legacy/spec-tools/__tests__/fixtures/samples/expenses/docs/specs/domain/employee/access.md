---
doc_type: access_spec
scope: common
id: employee-access
entity: employee
reads:
  - by: anonymous
    scope: none
  - by: employee
    scope: all                    # 申請者・承認者の名前は社内で相互に見える
  - by: accountant
    scope: all
  - by: system
    scope: all
  - by: claim_owner
    scope: none                   # 申請の文脈ロールは従業員の行の可視性を供給しない
  - by: approver
    scope: none
fields_hidden:
  - field: is_accountant          # 経理かどうかは名簿に出さない
    from: [employee]
---

# 従業員のアクセス権限

- creates / writes / deletes を宣言しない — 従業員の行は人事側の台帳から入る想定で、この系では作らない。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
