---
doc_type: action_spec
scope: backend
id: customer-activate-action

handles: customer.activate

input:
  - customer.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-CUSTOMER-ACTIVATE-001
    type: unit
    covers: [success]
    by_role: employee_self
    spec_ids: [customer.activate]
    implementation: app/src/operation/__tests__/customer/activate.test.ts::従業員は顧客を本登録にできる
  - id: TC-CUSTOMER-ACTIVATE-002
    type: unit
    covers: [invalid_from]
    spec_ids: [customer.activate]
    implementation: app/src/operation/__tests__/customer/activate.test.ts::遷移元でない状態からは本登録にできない
  - id: TC-CUSTOMER-ACTIVATE-003
    type: integration
    covers: [forbidden]
    spec_ids: [customer-access]
    implementation: app/src/composition/__tests__/customer/activate.test.ts::顧客本人は自分を本登録にできない
  - id: TC-CUSTOMER-ACTIVATE-004
    type: integration
    covers: [conflict]
    spec_ids: [customer.activate]
    implementation: app/src/composition/__tests__/customer/activate.test.ts::判断後に状態が変わっていれば競合として拒否される
---

# 顧客の本登録(customer.activate)

- 理由や連絡事項は input で受けない。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
