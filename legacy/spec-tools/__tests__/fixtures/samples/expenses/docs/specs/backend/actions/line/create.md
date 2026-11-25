---
doc_type: action_spec
scope: backend
id: line-create-action

handles: line.create

input:
  - line.claim_id
  - line.spent_on
  - line.category
  - line.amount
  - line.memo

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LINE-CREATE-001
    type: unit
    covers: [success]
    by_role: claim_owner
    spec_ids: [line.create]
    implementation: app/src/operation/__tests__/line/create.test.ts::申請者は下書きの申請に明細を足せる
  - id: TC-LINE-CREATE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [line.create]
    implementation: app/src/operation/__tests__/line/create.test.ts::提出済みの申請に明細は足せない
  - id: TC-LINE-CREATE-003
    type: unit
    covers: [forbidden]
    spec_ids: [line-access]
    implementation: app/src/operation/__tests__/line/create.test.ts::他人の申請に明細は足せない
  - id: TC-LINE-CREATE-004
    type: unit
    covers: [conflict]
    spec_ids: [line.create]
    implementation: app/src/operation/__tests__/line/create.test.ts::判断のあとに親の状態が動いていた追加は競合になる
  - id: TC-LINE-CREATE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-CLAIM-003]
    implementation: app/src/composition/__tests__/line/create.test.ts::明細を足しても合計額は明細の総和と一致し続ける
---

# 明細を足す（line.create）

- 複数行をまとめて足す口はこの仕様に無い — まとめ入れはユースケース(保存点)の側が担う。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
