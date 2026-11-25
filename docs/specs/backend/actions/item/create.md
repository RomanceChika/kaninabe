---
doc_type: action_spec
scope: backend
id: item-create-action

handles: item.create

input:
  - item.title
  - item.author
  - item.shelf_code
  - item.media

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ITEM-CREATE-001
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [item.create]
    implementation: app/src/operation/__tests__/item/create.test.ts::司書は蔵書を受け入れられる
  - id: TC-ITEM-CREATE-002
    type: unit
    covers: [forbidden]
    spec_ids: [item.create]
    implementation: app/src/operation/__tests__/item/create.test.ts::司書でない利用者は蔵書を受け入れられない
  - id: TC-ITEM-CREATE-003
    type: integration
    covers: [success]
    spec_ids: [item.create]
    implementation: app/src/composition/__tests__/item/create.test.ts::受け入れた蔵書は仕様の初期状態で始まる
---

# 蔵書を受け入れる（item.create）

- 蔵書IDは input で受けない — 冪等キーは呼び側が作り、業務の入力ではない。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `item.create` |
| 種別 | 作成(access_spec: item の creates) |
| 実行ロール（by） | librarian |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| by | 条件（when） |
| --- | --- |
| librarian | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| item.title | string | ✓ | max_length=120 | — |
| item.author | string | ✓ | max_length=120 | — |
| item.shelf_code | string | ✓ | max_length=20 | — |
| item.media | enum([book, dvd, magazine]) | ✓ | labels(book=図書 / dvd=視聴覚資料 / magazine=雑誌) | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-ITEM-CREATE-001 | unit | success | librarian | item.create | `app/src/operation/__tests__/item/create.test.ts::司書は蔵書を受け入れられる` |
| TC-ITEM-CREATE-002 | unit | forbidden | — | item.create | `app/src/operation/__tests__/item/create.test.ts::司書でない利用者は蔵書を受け入れられない` |
| TC-ITEM-CREATE-003 | integration | success | — | item.create | `app/src/composition/__tests__/item/create.test.ts::受け入れた蔵書は仕様の初期状態で始まる` |
<!-- /AUTO-GENERATED:action-body -->
