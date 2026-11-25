---
doc_type: action_spec
scope: backend
id: hold-create-action

handles: hold.create

# 持ち主の欄(作成者で埋める欄)の明示。入力に無い実行者への参照の欄を推測では埋めない(点検 9 回目 A9-1)。
owner: hold.patron_id

input:
  - hold.item_id
  - hold.note

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-HOLD-CREATE-001
    type: unit
    covers: [success]
    by_role: patron
    spec_ids: [hold.create]
    implementation: app/src/operation/__tests__/hold/create.test.ts::利用者は蔵書に予約をかけられる
  - id: TC-HOLD-CREATE-002
    type: unit
    covers: [forbidden]
    spec_ids: [hold.create]
    implementation: app/src/operation/__tests__/hold/create.test.ts::未ログインでは予約をかけられない
  - id: TC-HOLD-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-HOLD-001]
    implementation: app/src/composition/__tests__/hold/create.test.ts::同じ蔵書への二重の予約は拒否される
  - id: TC-HOLD-CREATE-004
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [hold.create]
    implementation: app/src/operation/__tests__/hold/create.test.ts::他の利用者の名前では予約をかけられない
  - id: TC-HOLD-CREATE-005
    type: unit
    covers: [conflict]
    spec_ids: [hold.create]
    implementation: app/src/operation/__tests__/hold/create.test.ts::判断後に前提が崩れていたら競合として拒否される
---

# 予約をかける（hold.create）

- 順番待ちの位置は返さない — 待ち行列をドメインに持たせていないため、示せる順位が無い。

<!-- AUTO-GENERATED:action-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| handles | `hold.create` |
| 種別 | 作成(access_spec: hold の creates) |
| 実行ロール（by） | patron |
| エラー契約 | common（共通 3 分類） |

### 前提と帰結（ドメイン仕様からの導出）

| by | 条件（when） |
| --- | --- |
| patron | — |

### input（受けるフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| hold.item_id | ref(item) | ✓ | — | — |
| hold.note | string | — | max_length=200 | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-HOLD-CREATE-001 | unit | success | patron | hold.create | `app/src/operation/__tests__/hold/create.test.ts::利用者は蔵書に予約をかけられる` |
| TC-HOLD-CREATE-002 | unit | forbidden | — | hold.create | `app/src/operation/__tests__/hold/create.test.ts::未ログインでは予約をかけられない` |
| TC-HOLD-CREATE-003 | integration | invariant | — | INV-HOLD-001 | `app/src/composition/__tests__/hold/create.test.ts::同じ蔵書への二重の予約は拒否される` |
| TC-HOLD-CREATE-004 | unit | guard_unsatisfied | — | hold.create | `app/src/operation/__tests__/hold/create.test.ts::他の利用者の名前では予約をかけられない` |
| TC-HOLD-CREATE-005 | unit | conflict | — | hold.create | `app/src/operation/__tests__/hold/create.test.ts::判断後に前提が崩れていたら競合として拒否される` |
<!-- /AUTO-GENERATED:action-body -->
