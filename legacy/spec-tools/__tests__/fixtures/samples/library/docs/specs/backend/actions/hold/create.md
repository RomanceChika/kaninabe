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
<!-- /AUTO-GENERATED:action-body -->
