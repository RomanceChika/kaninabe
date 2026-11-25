---
doc_type: action_spec
scope: backend
id: department-update-action

handles: department.update

input:
  - department.id
  - department.name

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-DEPARTMENT-UPDATE-001
    type: unit
    covers: [success]
    by_role: department_admin
    spec_ids: [department.update]
    implementation: app/src/operation/__tests__/department/update.test.ts::部門管理者は部門名を直せる
  - id: TC-DEPARTMENT-UPDATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [department-access]
    implementation: app/src/composition/__tests__/department/update.test.ts::他部門の管理者は直せない
  - id: TC-DEPARTMENT-UPDATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-DEPARTMENT-001]
    implementation: app/src/composition/__tests__/department/update.test.ts::既存の部門名へは改名できない
  - id: TC-DEPARTMENT-UPDATE-004
    type: integration
    covers: [conflict]
    spec_ids: [department.update]
    implementation: app/src/composition/__tests__/department/update.test.ts::判断後に消えていた部門の編集は競合として拒否される
---

# 部門名の編集（department.update）

- 管理者の付け替えは input に無い — 任免の正は人事側の台帳にある。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
