---
doc_type: action_spec
scope: backend
id: product-update-action

handles: product.update

input:
  - product.id
  - product.name
  - product.unit_price

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-PRODUCT-UPDATE-001
    type: unit
    covers: [success]
    by_role: company_admin
    spec_ids: [product.update]
    implementation: app/src/operation/__tests__/product/update.test.ts::会社管理者は商品名と単価を直せる
  - id: TC-PRODUCT-UPDATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [product-access]
    implementation: app/src/composition/__tests__/product/update.test.ts::管理者でない従業員は直せない
  - id: TC-PRODUCT-UPDATE-003
    type: integration
    covers: [conflict]
    spec_ids: [product.update]
    implementation: app/src/composition/__tests__/product/update.test.ts::判断後に消えていた商品の編集は競合として拒否される
  # テナント境界(access_spec の writes[].when)—— 他社の商品の編集が拒否される
  - id: TC-PRODUCT-UPDATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [product-access]
    implementation: app/src/composition/__tests__/product/update.test.ts::他社の商品は直せない
---

# 商品の編集(product.update)

- 値上げの履歴は残さない — 過去の請求額は注文の行が持っており、単価は「いまの値」である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
