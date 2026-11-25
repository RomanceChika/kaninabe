---
doc_type: action_spec
scope: backend
id: shelf-update-action

handles: shelf.update

input:
  - shelf.id
  - shelf.is_active

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SHELF-UPDATE-001
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [shelf.update]
    implementation: app/src/operation/__tests__/shelf/update.test.ts::店舗責任者は棚を使用停止にできる
  - id: TC-SHELF-UPDATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [shelf-access]
    implementation: app/src/composition/__tests__/shelf/update.test.ts::他店舗の責任者は直せない
  - id: TC-SHELF-UPDATE-003
    type: integration
    covers: [conflict]
    spec_ids: [shelf.update]
    implementation: app/src/composition/__tests__/shelf/update.test.ts::判断後に消えていた棚の編集は競合として拒否される
  # テナント境界(access_spec の writes[].when)—— 他社の棚の編集が拒否される
  - id: TC-SHELF-UPDATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [shelf-access]
    implementation: app/src/composition/__tests__/shelf/update.test.ts::他社の棚は直せない
---

# 棚の編集(shelf.update)

- 棚番の付け替えは受けない(code は input に無い) — 棚札の貼り替えは新しい棚として登録する運用である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
