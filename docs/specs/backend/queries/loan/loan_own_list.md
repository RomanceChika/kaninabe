---
doc_type: query_spec
scope: backend
id: query-loan-own-list

name: loan_own_list
for: [patron]
via: loan_owner
source: loan
scope_used: own
returns: many

filters:
  - state in [requested, checked_out, overdue]

includes:
  - entity: item
    scope_used: all
    projection: [id, title, author]

sort:
  - due_at asc
  - id asc

paging: none
bounded_by: window

projection:
  - id
  - item_id
  - due_at
  - state

test_cases:
  - id: TC-LOAN-LOAN_OWN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-loan-own-list]
    implementation: app/src/composition/__tests__/loan/loan_own_list.test.ts::利用者は自分の返却前の貸出だけを期限順に読める
  - id: TC-LOAN-LOAN_OWN_LIST-002
    type: integration
    covers: [other]
    spec_ids: [loan-access]
    implementation: app/src/composition/__tests__/loan/loan_own_list.test.ts::司書として他人の貸出が見えている状況でも自分の貸出しか返らない
---

# 自分の貸出（loan_own_list）

- 返却済みの履歴は返さない — 履歴の閲覧は loan_own_history が受ける（これから動く貸出と済んだ貸出は読む目的が違う）。

<!-- AUTO-GENERATED:query-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| source | loan |
| 実行ロール（for） | patron |
| 可視性の供給元（via） | loan_owner |
| スコープ（scope_used） | own |
| 返し方 | many / none |
| 並び順（sort） | due_at asc, id asc |
| 有界性の根拠（bounded_by） | window（via のスコープ条件が実行者 1 人分に絞るため有界） |

### params（実行時入力）

実行時入力はない（このクエリは実行者のセッションだけで決まる）。

### filters（絞り込み）

- `state in [requested, checked_out, overdue]`

### includes（併読）

| entity | scope_used | via | filters | projection | sort | limit |
| --- | --- | --- | --- | --- | --- | --- |
| item | all | —（for 自身の reads） | — | id, title, author | — | —（全件） |

### projection（返すフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| id | uuid | —（行では必須） | auto=true | — |
| item_id | ref(item) | ✓ | — | — |
| due_at | datetime | —（DB が供給。行では必須） | supplied_by=db | — |
| state | state(loan) | —（行では必須） | — | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-LOAN-LOAN_OWN_LIST-001 | integration | success | — | query-loan-own-list | `app/src/composition/__tests__/loan/loan_own_list.test.ts::利用者は自分の返却前の貸出だけを期限順に読める` |
| TC-LOAN-LOAN_OWN_LIST-002 | integration | other | — | loan-access | `app/src/composition/__tests__/loan/loan_own_list.test.ts::司書として他人の貸出が見えている状況でも自分の貸出しか返らない` |
<!-- /AUTO-GENERATED:query-body -->
