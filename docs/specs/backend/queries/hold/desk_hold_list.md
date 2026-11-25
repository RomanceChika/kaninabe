---
doc_type: query_spec
scope: backend
id: query-desk-hold-list

name: desk_hold_list
for: [librarian]
source: hold
scope_used: all
returns: many

filters:
  - state in [placed, ready]

sort:
  - id asc

paging: limit(50)

projection:
  - id
  - item_id
  - patron_id
  - note
  - state

test_cases:
  - id: TC-HOLD-DESK_HOLD_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-desk-hold-list]
    implementation: app/src/composition/__tests__/hold/desk_hold_list.test.ts::司書は取置待ちの予約を読める
---

# カウンターの予約一覧（desk_hold_list）

- 取消・受取済みは返さない — カウンターの作業対象は受付と取置中の予約だけである。

<!-- AUTO-GENERATED:query-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| source | hold |
| 実行ロール（for） | librarian |
| 可視性の供給元（via） | —（for 自身の reads） |
| スコープ（scope_used） | all |
| 返し方 | many / limit(50) |
| 並び順（sort） | id asc |

### params（実行時入力）

実行時入力はない（このクエリは実行者のセッションだけで決まる）。

### filters（絞り込み）

- `state in [placed, ready]`

### projection（返すフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| id | uuid | —（行では必須） | auto=true | — |
| item_id | ref(item) | ✓ | — | — |
| patron_id | ref(patron) | ✓ | — | — |
| note | string | — | max_length=200 | — |
| state | state(hold) | —（行では必須） | — | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-HOLD-DESK_HOLD_LIST-001 | integration | success | — | query-desk-hold-list | `app/src/composition/__tests__/hold/desk_hold_list.test.ts::司書は取置待ちの予約を読める` |
<!-- /AUTO-GENERATED:query-body -->
