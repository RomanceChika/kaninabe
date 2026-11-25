---
doc_type: query_spec
scope: backend
id: query-desk-loan-list

name: desk_loan_list
for: [librarian]
source: loan
scope_used: all
returns: many

filters:
  - state in [requested, checked_out, overdue]

sort:
  - due_at asc
  - id asc

paging: limit(50)

projection:
  - id
  - item_id
  - patron_id
  - due_at
  - state

test_cases:
  - id: TC-LOAN-DESK_LOAN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-desk-loan-list]
    implementation: app/src/composition/__tests__/loan/desk_loan_list.test.ts::司書は返却前の貸出を期限順に読める
---

# カウンターの貸出一覧（desk_loan_list）

- 返却済みを混ぜない — カウンターで見たいのは「これから動く貸出」だけである。

<!-- AUTO-GENERATED:query-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| source | loan |
| 実行ロール（for） | librarian |
| 可視性の供給元（via） | —（for 自身の reads） |
| スコープ（scope_used） | all |
| 返し方 | many / limit(50) |
| 並び順（sort） | due_at asc, id asc |

### params（実行時入力）

実行時入力はない（このクエリは実行者のセッションだけで決まる）。

### filters（絞り込み）

- `state in [requested, checked_out, overdue]`

### projection（返すフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| id | uuid | —（行では必須） | auto=true | — |
| item_id | ref(item) | ✓ | — | — |
| patron_id | ref(patron) | ✓ | — | — |
| due_at | datetime | —（DB が供給。行では必須） | supplied_by=db | — |
| state | state(loan) | —（行では必須） | — | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-LOAN-DESK_LOAN_LIST-001 | integration | success | — | query-desk-loan-list | `app/src/composition/__tests__/loan/desk_loan_list.test.ts::司書は返却前の貸出を期限順に読める` |
<!-- /AUTO-GENERATED:query-body -->
