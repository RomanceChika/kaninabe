---
doc_type: action_spec
scope: backend
id: customer-suspend-action

handles: customer.suspend

input:
  - customer.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CUSTOMER-SUSPEND-001
    type: unit
    covers: [success]
    by_role: employee_self
    spec_ids: [customer.suspend]
    implementation: app/src/operation/__tests__/customer/suspend.test.ts::従業員は顧客を停止にできる
  - id: TC-CUSTOMER-SUSPEND-002
    type: unit
    covers: [invalid_from]
    spec_ids: [customer.suspend]
    implementation: app/src/operation/__tests__/customer/suspend.test.ts::遷移元でない状態からは停止にできない
  - id: TC-CUSTOMER-SUSPEND-003
    type: integration
    covers: [forbidden]
    spec_ids: [customer-access]
    implementation: app/src/composition/__tests__/customer/suspend.test.ts::顧客本人は自分を停止にできない
  - id: TC-CUSTOMER-SUSPEND-004
    type: integration
    covers: [conflict]
    spec_ids: [customer.suspend]
    implementation: app/src/composition/__tests__/customer/suspend.test.ts::判断後に状態が変わっていれば競合として拒否される
---

# 顧客の停止(customer.suspend)

- 理由や連絡事項は input で受けない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
