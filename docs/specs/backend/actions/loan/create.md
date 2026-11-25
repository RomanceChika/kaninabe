---
doc_type: action_spec
scope: backend
id: loan-create-action

handles: loan.create

input:
  - loan.item_id
  - loan.patron_id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LOAN-CREATE-001
    type: unit
    covers: [success]
    by_role: patron
    spec_ids: [loan.create]
    implementation: app/src/operation/__tests__/loan/create.test.ts::利用者は在架の蔵書に貸出を申し込める
  - id: TC-LOAN-CREATE-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [loan.create]
    implementation: app/src/operation/__tests__/loan/create.test.ts::司書は代理で貸出を起こせる
  - id: TC-LOAN-CREATE-003
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [loan.create]
    implementation: app/src/operation/__tests__/loan/create.test.ts::在架でない蔵書には貸出を申し込めない
  - id: TC-LOAN-CREATE-004
    type: unit
    covers: [forbidden]
    spec_ids: [loan.create]
    implementation: app/src/operation/__tests__/loan/create.test.ts::未ログインでは貸出を申し込めない
  - id: TC-LOAN-CREATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-LOAN-002]
    implementation: app/src/composition/__tests__/loan/create.test.ts::4件目の貸出は上限として拒否される
  - id: TC-LOAN-CREATE-006
    type: unit
    covers: [conflict]
    spec_ids: [loan.create]
    implementation: app/src/operation/__tests__/loan/create.test.ts::判断後に蔵書の状態が動いていたら競合として拒否される
---

# 貸出を申し込む（loan.create）

- 返却期限を input で受けない — 貸出期間は館の慣習で、DB が入れる（supplied_by: db）。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `loan.create` |
| 種別 | 作成(access_spec: loan の creates) |
| 実行ロール（by） | patron, librarian |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| by | 条件（when） |
| --- | --- |
| patron | `item.state == available` |
| librarian | `item.state == available` |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| loan.item_id | ref(item) | ✓ | — | — |
| loan.patron_id | ref(patron) | ✓ | — | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-LOAN-CREATE-001 | unit | success | patron | loan.create | `app/src/operation/__tests__/loan/create.test.ts::利用者は在架の蔵書に貸出を申し込める` |
| TC-LOAN-CREATE-002 | unit | success | librarian | loan.create | `app/src/operation/__tests__/loan/create.test.ts::司書は代理で貸出を起こせる` |
| TC-LOAN-CREATE-003 | unit | guard_unsatisfied | — | loan.create | `app/src/operation/__tests__/loan/create.test.ts::在架でない蔵書には貸出を申し込めない` |
| TC-LOAN-CREATE-004 | unit | forbidden | — | loan.create | `app/src/operation/__tests__/loan/create.test.ts::未ログインでは貸出を申し込めない` |
| TC-LOAN-CREATE-005 | integration | invariant | — | INV-LOAN-002 | `app/src/composition/__tests__/loan/create.test.ts::4件目の貸出は上限として拒否される` |
| TC-LOAN-CREATE-006 | unit | conflict | — | loan.create | `app/src/operation/__tests__/loan/create.test.ts::判断後に蔵書の状態が動いていたら競合として拒否される` |
<!-- /AUTO-GENERATED:action-body -->
