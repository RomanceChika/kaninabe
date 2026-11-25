---
doc_type: action_spec
scope: backend
id: section-delete-action

handles: section.delete

input:
  - section.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SECTION-DELETE-001
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [section.delete]
    implementation: app/src/operation/__tests__/section/delete.test.ts::棚の無い売場は消せる
  - id: TC-SECTION-DELETE-002
    type: integration
    covers: [forbidden]
    spec_ids: [section-access]
    implementation: app/src/composition/__tests__/section/delete.test.ts::他店舗の責任者は消せない
  - id: TC-SECTION-DELETE-003
    type: integration
    covers: [not_found, conflict]
    spec_ids: [section.delete]
    implementation: app/src/composition/__tests__/section/delete.test.ts::既に消えている売場の削除は存在を漏らさず拒否される
  - id: TC-SECTION-DELETE-004
    type: integration
    covers: [invariant]
    spec_ids: [INV-SECTION-003]
    implementation: app/src/composition/__tests__/section/delete.test.ts::棚がぶら下がっている売場は消せない
  # テナント境界(access_spec の deletes[].when)—— 他社の売場の削除が拒否される
  - id: TC-SECTION-DELETE-005
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [section-access]
    implementation: app/src/composition/__tests__/section/delete.test.ts::他社の売場の削除は拒否される
---

# 売場の削除(section.delete)

- 「閉鎖中」の状態は持たないので、間違えて登録した売場の消し込みだけがこの操作の用途である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
