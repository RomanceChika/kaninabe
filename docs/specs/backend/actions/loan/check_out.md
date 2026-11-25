---
doc_type: action_spec
scope: backend
id: loan-check_out-action

handles: loan.check_out

input:
  - loan.id

# 導出は confirm_required = true(irreversible ∧ affects_others — 受取待ちへ戻る遷移が無く、司書も起こせる)。戻れないことは
# 認める: 返却(loan.return_item)は受け取りの取り消しではなく貸出の完了で、受け取りを巻き戻す操作はこの題材に無い。それでも
# 確認を外すのは、誤ったときの損害が貸出 1 件の取り違えにとどまり、窓口では貸出が流れ作業で頻度が高く、1 冊ごとの確認が
# 列を止めるため。受け取りの前に意思を確かめる場は申込み(loan.create)の側にある。(2026-10-06 題材の裁定)
ux:
  confirm: none
  reason: 受け取りは戻せない(返却は貸出の完了で、取り消しではない)。ただし誤ったときの損害は貸出 1 件の取り違えにとどまり、窓口では頻度が高い流れ作業で、1 冊ごとの確認が列を止める(2026-10-06 題材の裁定)

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LOAN-CHECK_OUT-001
    type: unit
    covers: [success]
    by_role: loan_owner
    spec_ids: [loan.check_out]
    implementation: app/src/operation/__tests__/loan/check_out.test.ts::申し込んだ本人が貸出を受け取れる
  - id: TC-LOAN-CHECK_OUT-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [loan.check_out]
    implementation: app/src/operation/__tests__/loan/check_out.test.ts::司書はカウンターで貸出を渡せる
  - id: TC-LOAN-CHECK_OUT-003
    type: unit
    covers: [invalid_from]
    spec_ids: [loan.check_out]
    implementation: app/src/operation/__tests__/loan/check_out.test.ts::受け取り済みの貸出は再び受け取れない
  - id: TC-LOAN-CHECK_OUT-004
    type: unit
    covers: [forbidden]
    spec_ids: [loan.check_out]
    implementation: app/src/operation/__tests__/loan/check_out.test.ts::他人の貸出は受け取れない
  - id: TC-LOAN-CHECK_OUT-005
    type: unit
    covers: [conflict]
    spec_ids: [loan.check_out]
    implementation: app/src/operation/__tests__/loan/check_out.test.ts::判断後に状態が動いていたら競合として拒否される
  - id: TC-LOAN-CHECK_OUT-006
    type: integration
    covers: [invariant]
    spec_ids: [INV-LOAN-001]
    implementation: app/src/composition/__tests__/loan/check_out.test.ts::同じ蔵書の二重の貸出は拒否される
---

# 貸出を受け取る（loan.check_out）

- 蔵書の状態はここで変えない — 在庫の遷移は item.lend が別に受ける（1 アクション 1 操作）。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `loan.check_out` |
| 種別 | 状態遷移(state_spec: loan) |
| 実行ロール（by） | librarian, loan_owner |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| from | to | guard | effects |
| --- | --- | --- | --- |
| requested(受取待ち) | checked_out(貸出中) | — | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| loan.id | uuid | —（行では必須） | auto=true | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-LOAN-CHECK_OUT-001 | unit | success | loan_owner | loan.check_out | `app/src/operation/__tests__/loan/check_out.test.ts::申し込んだ本人が貸出を受け取れる` |
| TC-LOAN-CHECK_OUT-002 | unit | success | librarian | loan.check_out | `app/src/operation/__tests__/loan/check_out.test.ts::司書はカウンターで貸出を渡せる` |
| TC-LOAN-CHECK_OUT-003 | unit | invalid_from | — | loan.check_out | `app/src/operation/__tests__/loan/check_out.test.ts::受け取り済みの貸出は再び受け取れない` |
| TC-LOAN-CHECK_OUT-004 | unit | forbidden | — | loan.check_out | `app/src/operation/__tests__/loan/check_out.test.ts::他人の貸出は受け取れない` |
| TC-LOAN-CHECK_OUT-005 | unit | conflict | — | loan.check_out | `app/src/operation/__tests__/loan/check_out.test.ts::判断後に状態が動いていたら競合として拒否される` |
| TC-LOAN-CHECK_OUT-006 | integration | invariant | — | INV-LOAN-001 | `app/src/composition/__tests__/loan/check_out.test.ts::同じ蔵書の二重の貸出は拒否される` |
<!-- /AUTO-GENERATED:action-body -->
