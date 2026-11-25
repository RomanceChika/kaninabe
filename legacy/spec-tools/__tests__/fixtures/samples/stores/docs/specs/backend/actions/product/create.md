---
doc_type: action_spec
scope: backend
id: product-create-action

handles: product.create

input:
  - product.company_id
  - product.sku
  - product.name
  - product.unit_price

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-PRODUCT-CREATE-001
    type: unit
    covers: [success]
    by_role: company_admin
    spec_ids: [product.create]
    implementation: app/src/operation/__tests__/product/create.test.ts::会社管理者は商品を足せる
  - id: TC-PRODUCT-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [product-access]
    implementation: app/src/composition/__tests__/product/create.test.ts::管理者でない従業員は商品を足せない
  - id: TC-PRODUCT-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-PRODUCT-001]
    implementation: app/src/composition/__tests__/product/create.test.ts::同じ会社に同じ商品コードは作れない
  # テナント境界(access_spec の creates[].when)—— 他社の company_id を渡した作成が拒否される
  - id: TC-PRODUCT-CREATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [product-access]
    implementation: app/src/composition/__tests__/product/create.test.ts::他社の company_id を渡した商品の作成は拒否される
  # 判断したときの前提を条件に書き込む(OCC)—— 会社が作成中に変わっていた実行は競合になる
  - id: TC-PRODUCT-CREATE-005
    type: integration
    covers: [conflict]
    spec_ids: [product.create]
    implementation: app/src/composition/__tests__/product/create.test.ts::判断のあとに実行者の会社が変わっていた作成は競合になる
---

# 商品の追加(product.create)

- 初期在庫は input に無い — 在庫が動く事実は移動の行が正であり、商品の登録で残高を作ると台帳の一致が崩れる。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
