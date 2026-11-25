---
doc_type: action_spec
scope: backend
id: item-report_lost-action

handles: item.report_lost

input:
  - item.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ITEM-REPORT_LOST-001
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [item.report_lost]
    implementation: app/src/operation/__tests__/item/report_lost.test.ts::司書は蔵書を紛失として記録できる
  - id: TC-ITEM-REPORT_LOST-002
    type: unit
    covers: [invalid_from]
    spec_ids: [item.report_lost]
    implementation: app/src/operation/__tests__/item/report_lost.test.ts::紛失済みの蔵書は二重に記録できない
  - id: TC-ITEM-REPORT_LOST-003
    type: unit
    covers: [forbidden]
    spec_ids: [item.report_lost]
    implementation: app/src/operation/__tests__/item/report_lost.test.ts::司書でない利用者は紛失として記録できない
  - id: TC-ITEM-REPORT_LOST-004
    type: unit
    covers: [conflict]
    spec_ids: [item.report_lost]
    implementation: app/src/operation/__tests__/item/report_lost.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 蔵書を紛失として記録する（item.report_lost）

- 弁償の金額は扱わない — 会計はこの版の線の外。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
