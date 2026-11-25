---
doc_type: access_spec
scope: common
id: customer-access
entity: customer
reads:
  - by: anonymous
    scope: none
  - by: signed_in
    scope: none
  - by: system
    scope: all
  - by: customer_self
    scope: own
  - by: employee_self
    scope: all
---

# 顧客のアクセス権限

- 顧客どうしは互いを見ない(`own` だけ)。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
