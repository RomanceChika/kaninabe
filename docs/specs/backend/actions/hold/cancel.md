---
doc_type: action_spec
scope: backend
id: hold-cancel-action

handles: hold.cancel

input:
  - hold.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-HOLD-CANCEL-001
    type: unit
    covers: [success]
    by_role: hold_owner
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::予約した本人が予約を取り消せる
  - id: TC-HOLD-CANCEL-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::司書は取置期限を過ぎた予約を取り消せる
  - id: TC-HOLD-CANCEL-003
    type: unit
    covers: [invalid_from]
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::受取済みの予約は取り消せない
  - id: TC-HOLD-CANCEL-004
    type: unit
    covers: [forbidden]
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::他人の予約は取り消せない
  - id: TC-HOLD-CANCEL-005
    type: unit
    covers: [conflict]
    spec_ids: [hold.cancel]
    implementation: app/src/operation/__tests__/hold/cancel.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 予約を取り消す（hold.cancel）

- 取消の理由は input で受けない — 記録する場所（欄）をドメインに持っていない。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `hold.cancel` |
| 種別 | 状態遷移(state_spec: hold) |
| 実行ロール（by） | hold_owner, librarian |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| from | to | guard | effects |
| --- | --- | --- | --- |
| placed(受付), ready(取置中) | cancelled(取消) | — | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| hold.id | uuid | —（行では必須） | auto=true | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-HOLD-CANCEL-001 | unit | success | hold_owner | hold.cancel | `app/src/operation/__tests__/hold/cancel.test.ts::予約した本人が予約を取り消せる` |
| TC-HOLD-CANCEL-002 | unit | success | librarian | hold.cancel | `app/src/operation/__tests__/hold/cancel.test.ts::司書は取置期限を過ぎた予約を取り消せる` |
| TC-HOLD-CANCEL-003 | unit | invalid_from | — | hold.cancel | `app/src/operation/__tests__/hold/cancel.test.ts::受取済みの予約は取り消せない` |
| TC-HOLD-CANCEL-004 | unit | forbidden | — | hold.cancel | `app/src/operation/__tests__/hold/cancel.test.ts::他人の予約は取り消せない` |
| TC-HOLD-CANCEL-005 | unit | conflict | — | hold.cancel | `app/src/operation/__tests__/hold/cancel.test.ts::判断後に状態が動いていたら競合として拒否される` |
<!-- /AUTO-GENERATED:action-body -->
