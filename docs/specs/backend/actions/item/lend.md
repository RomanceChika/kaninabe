---
doc_type: action_spec
scope: backend
id: item-lend-action

handles: item.lend

input:
  - item.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ITEM-LEND-001
    type: unit
    covers: [success]
    by_role: patron
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::利用者は在架の蔵書を自分で貸出中にできる
  - id: TC-ITEM-LEND-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::司書はカウンターで蔵書を貸出中にできる
  - id: TC-ITEM-LEND-003
    type: unit
    covers: [invalid_from]
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::貸出中の蔵書は再び貸し出せない
  - id: TC-ITEM-LEND-004
    type: unit
    covers: [forbidden]
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::未ログインでは蔵書を貸し出せない
  - id: TC-ITEM-LEND-005
    type: unit
    covers: [conflict]
    spec_ids: [item.lend]
    implementation: app/src/operation/__tests__/item/lend.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 蔵書を貸し出す（item.lend）

- 借りる人を input で受けない — 誰が借りたかは貸出の行が持ち、蔵書は在庫の状態だけを持つ。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `item.lend` |
| 種別 | 状態遷移(state_spec: item) |
| 実行ロール（by） | patron, librarian |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| from | to | guard | effects |
| --- | --- | --- | --- |
| available(在架) | on_loan(貸出中) | — | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| item.id | uuid | —（行では必須） | auto=true | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-ITEM-LEND-001 | unit | success | patron | item.lend | `app/src/operation/__tests__/item/lend.test.ts::利用者は在架の蔵書を自分で貸出中にできる` |
| TC-ITEM-LEND-002 | unit | success | librarian | item.lend | `app/src/operation/__tests__/item/lend.test.ts::司書はカウンターで蔵書を貸出中にできる` |
| TC-ITEM-LEND-003 | unit | invalid_from | — | item.lend | `app/src/operation/__tests__/item/lend.test.ts::貸出中の蔵書は再び貸し出せない` |
| TC-ITEM-LEND-004 | unit | forbidden | — | item.lend | `app/src/operation/__tests__/item/lend.test.ts::未ログインでは蔵書を貸し出せない` |
| TC-ITEM-LEND-005 | unit | conflict | — | item.lend | `app/src/operation/__tests__/item/lend.test.ts::判断後に状態が動いていたら競合として拒否される` |
<!-- /AUTO-GENERATED:action-body -->
