---
doc_type: action_spec
scope: backend
id: store-update-action

handles: store.update

input:
  - store.id
  - store.name
  - store.manager_id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-STORE-UPDATE-001
    type: unit
    covers: [success]
    by_role: company_admin
    spec_ids: [store.update]
    implementation: app/src/operation/__tests__/store/update.test.ts::会社管理者は店舗名と責任者を直せる
  - id: TC-STORE-UPDATE-002
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [store.update]
    implementation: app/src/operation/__tests__/store/update.test.ts::店舗責任者は店舗名だけを直せる
  - id: TC-STORE-UPDATE-003
    type: integration
    covers: [forbidden]
    spec_ids: [store-access]
    implementation: app/src/composition/__tests__/store/update.test.ts::他店舗の責任者は直せない
  - id: TC-STORE-UPDATE-004
    type: integration
    covers: [invariant]
    spec_ids: [INV-STORE-001]
    implementation: app/src/composition/__tests__/store/update.test.ts::同じ会社の既存の店舗名へは改名できない
  - id: TC-STORE-UPDATE-005
    type: integration
    covers: [conflict]
    spec_ids: [store.update]
    implementation: app/src/composition/__tests__/store/update.test.ts::判断後に責任者が替わっていた編集は競合として拒否される
  # テナント境界(access_spec の writes[].when)—— 他社の店舗の編集が拒否される
  - id: TC-STORE-UPDATE-006
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [store-access]
    implementation: app/src/composition/__tests__/store/update.test.ts::他社の店舗は直せない
---

# 店舗の編集(store.update)

- 所属会社の付け替えは受けない(company_id は input に無い) — 会社が変われば売場も棚も台帳も一緒に移ることになる。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
