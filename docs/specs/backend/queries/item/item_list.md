---
doc_type: query_spec
scope: backend
id: query-item-list

name: item_list
for: [anonymous, patron]
source: item
scope_used: all
returns: many

filters:
  - state != lost                 # 紛失した蔵書は目録に並べない（UX の取捨選択）

sort:
  - title asc
  - id asc

paging: limit(50)

projection:
  - id
  - title
  - author
  - shelf_code
  - media
  - state

test_cases:
  - id: TC-ITEM-ITEM_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-item-list]
    implementation: app/src/composition/__tests__/item/item_list.test.ts::未ログインでも蔵書目録を書名順に読める
---

# 蔵書目録（item_list）

- 紛失を上限で切らない — filters で返す集合そのものを絞る（切ってよい行と悪い行を上限は区別できない）。

<!-- AUTO-GENERATED:query-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| source | item |
| 実行ロール（for） | anonymous, patron |
| 可視性の供給元（via） | —（for 自身の reads） |
| スコープ（scope_used） | all |
| 返し方 | many / limit(50) |
| 並び順（sort） | title asc, id asc |

### params（実行時入力）

実行時入力はない（このクエリは実行者のセッションだけで決まる）。

### filters（絞り込み）

- `state != lost`

### projection（返すフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| id | uuid | —（行では必須） | auto=true | — |
| title | string | ✓ | max_length=120 | — |
| author | string | ✓ | max_length=120 | — |
| shelf_code | string | ✓ | max_length=20 | — |
| media | enum([book, dvd, magazine]) | ✓ | labels(book=図書 / dvd=視聴覚資料 / magazine=雑誌) | — |
| state | state(item) | —（行では必須） | — | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-ITEM-ITEM_LIST-001 | integration | success | — | query-item-list | `app/src/composition/__tests__/item/item_list.test.ts::未ログインでも蔵書目録を書名順に読める` |
<!-- /AUTO-GENERATED:query-body -->
