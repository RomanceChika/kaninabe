---
doc_type: query_spec
scope: backend
id: query-item-detail

name: item_detail
for: [patron]
source: item
scope_used: all
returns: one

params:
  - name: item_id
    ref: item.id

filters:
  - id == param.item_id

projection:
  - id
  - title
  - author
  - shelf_code
  - media
  - state

test_cases:
  - id: TC-ITEM-ITEM_DETAIL-001
    type: integration
    covers: [success]
    spec_ids: [query-item-detail]
    implementation: app/src/composition/__tests__/item/item_detail.test.ts::利用者は蔵書の 1 件を読める
---

# 蔵書の詳細（item_detail）

- 貸出履歴は併読しない — 誰が借りたかは利用者側の可視性であり、目録の詳細に混ぜない。

<!-- AUTO-GENERATED:query-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| source | item |
| 実行ロール（for） | patron |
| 可視性の供給元（via） | —（for 自身の reads） |
| スコープ（scope_used） | all |
| 返し方 | one |
| 並び順（sort） | — |

### params（実行時入力）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| item_id（ref: item.id） | uuid | —（行では必須） | auto=true | — |

### filters（絞り込み）

- `id == param.item_id`

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
| TC-ITEM-ITEM_DETAIL-001 | integration | success | — | query-item-detail | `app/src/composition/__tests__/item/item_detail.test.ts::利用者は蔵書の 1 件を読める` |
<!-- /AUTO-GENERATED:query-body -->
