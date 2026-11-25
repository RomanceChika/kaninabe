---
doc_type: access_spec
scope: common
id: employee-access
entity: employee
reads:
  - by: anonymous
    scope: none
  - by: signed_in
    scope: none
  - by: system
    scope: all
  - by: customer_self
    scope: none
  - by: employee_self
    scope: all
---

# 従業員のアクセス権限

- 顧客からは従業員の台帳を読めない。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
