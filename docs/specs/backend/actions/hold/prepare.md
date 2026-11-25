---
doc_type: action_spec
scope: backend
id: hold-prepare-action

handles: hold.prepare

input:
  - hold.id

# 導出は confirm_required = true(irreversible ∧ affects_others — 受付へ戻る遷移が無く、利用者の取置の状況が変わる)。
# 戻れないことと、利用者の状況が変わることは認める: 取り置くと hold_own_list に ready(取置中)で見える。それでも確認を外すのは、
# 利用者への通知は出ず(通知のカタログは延滞の 1 本だけ)、変わるのは利用者の画面の表示が「取置中」になる範囲で損害が小さく、
# 取り置きは司書が予約を上から順にさばく流れ作業で頻度が高く、1 件ごとの確認が作業を止めるため。(2026-10-06 題材の裁定)
ux:
  confirm: none
  reason: 受付へは戻せず、利用者の取置の状況(hold_own_list に取置中で見える)は変わる。ただし通知は出ず損害が小さく、取り置きは司書が予約を上から順にさばく頻度の高い流れ作業で、1 件ごとの確認が作業を止める(2026-10-06 題材の裁定)

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-HOLD-PREPARE-001
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [hold.prepare]
    implementation: app/src/operation/__tests__/hold/prepare.test.ts::司書は在架の蔵書を取り置ける
  - id: TC-HOLD-PREPARE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [hold.prepare]
    implementation: app/src/operation/__tests__/hold/prepare.test.ts::在架でない蔵書は取り置けない
  - id: TC-HOLD-PREPARE-003
    type: unit
    covers: [invalid_from]
    spec_ids: [hold.prepare]
    implementation: app/src/operation/__tests__/hold/prepare.test.ts::取置中の予約は再び取り置けない
  - id: TC-HOLD-PREPARE-004
    type: unit
    covers: [forbidden]
    spec_ids: [hold.prepare]
    implementation: app/src/operation/__tests__/hold/prepare.test.ts::司書でない利用者は取り置けない
  - id: TC-HOLD-PREPARE-005
    type: unit
    covers: [conflict]
    spec_ids: [hold.prepare]
    implementation: app/src/operation/__tests__/hold/prepare.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 予約を取り置く（hold.prepare）

- 取置の棚番は持たない — 置き場所の運用は仕様の外。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `hold.prepare` |
| 種別 | 状態遷移(state_spec: hold) |
| 実行ロール（by） | librarian |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| from | to | guard | effects |
| --- | --- | --- | --- |
| placed(受付) | ready(取置中) | `item.state == available` | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| hold.id | uuid | —（行では必須） | auto=true | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-HOLD-PREPARE-001 | unit | success | librarian | hold.prepare | `app/src/operation/__tests__/hold/prepare.test.ts::司書は在架の蔵書を取り置ける` |
| TC-HOLD-PREPARE-002 | unit | guard_unsatisfied | — | hold.prepare | `app/src/operation/__tests__/hold/prepare.test.ts::在架でない蔵書は取り置けない` |
| TC-HOLD-PREPARE-003 | unit | invalid_from | — | hold.prepare | `app/src/operation/__tests__/hold/prepare.test.ts::取置中の予約は再び取り置けない` |
| TC-HOLD-PREPARE-004 | unit | forbidden | — | hold.prepare | `app/src/operation/__tests__/hold/prepare.test.ts::司書でない利用者は取り置けない` |
| TC-HOLD-PREPARE-005 | unit | conflict | — | hold.prepare | `app/src/operation/__tests__/hold/prepare.test.ts::判断後に状態が動いていたら競合として拒否される` |
<!-- /AUTO-GENERATED:action-body -->
