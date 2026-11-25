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
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `item.report_lost` |
| 種別 | 状態遷移(state_spec: item) |
| 実行ロール（by） | librarian |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| from | to | guard | effects |
| --- | --- | --- | --- |
| available(在架), on_loan(貸出中) | lost(紛失) | — | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| item.id | uuid | —（行では必須） | auto=true | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-ITEM-REPORT_LOST-001 | unit | success | librarian | item.report_lost | `app/src/operation/__tests__/item/report_lost.test.ts::司書は蔵書を紛失として記録できる` |
| TC-ITEM-REPORT_LOST-002 | unit | invalid_from | — | item.report_lost | `app/src/operation/__tests__/item/report_lost.test.ts::紛失済みの蔵書は二重に記録できない` |
| TC-ITEM-REPORT_LOST-003 | unit | forbidden | — | item.report_lost | `app/src/operation/__tests__/item/report_lost.test.ts::司書でない利用者は紛失として記録できない` |
| TC-ITEM-REPORT_LOST-004 | unit | conflict | — | item.report_lost | `app/src/operation/__tests__/item/report_lost.test.ts::判断後に状態が動いていたら競合として拒否される` |
<!-- /AUTO-GENERATED:action-body -->
