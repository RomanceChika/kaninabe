---
doc_type: action_spec
scope: backend
id: feedback-create-action

handles: feedback.create

input:
  - feedback.message

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-FEEDBACK-CREATE-001
    type: unit
    covers: [success]
    by_role: anonymous
    spec_ids: [feedback.create]
    implementation: app/src/operation/__tests__/feedback/create.test.ts::未ログインの足場の作成は全体の天井の中なら通る
  - id: TC-FEEDBACK-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [feedback-access]
    implementation: app/src/composition/__tests__/feedback/create.test.ts::未ログインでない役割の足場の作成は拒否される
  # 天井(INV-FEEDBACK-001)は DB のコミット時評価なので、実 DB でしか実行できない(点検 26 回目 A26-1 で不変条件に宣言した)
  - id: TC-FEEDBACK-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-FEEDBACK-001]
    implementation: app/src/composition/__tests__/feedback/create.test.ts::全体の天井を超える未ログインの作成は不変条件違反になる
---

# 匿名の意見を送る（feedback.create）

- 検査の足場である。天井の執行は DB のコミット時評価（生成されるトリガ）が持つ。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
