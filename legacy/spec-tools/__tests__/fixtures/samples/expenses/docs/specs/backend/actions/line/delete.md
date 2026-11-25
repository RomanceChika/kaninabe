---
doc_type: action_spec
scope: backend
id: line-delete-action

handles: line.delete

input:
  - line.id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LINE-DELETE-001
    type: unit
    covers: [success]
    by_role: claim_owner
    spec_ids: [line.delete]
    implementation: app/src/operation/__tests__/line/delete.test.ts::申請者は下書きの明細を消せる
  - id: TC-LINE-DELETE-002
    type: unit
    covers: [guard_unsatisfied]
    spec_ids: [line.delete]
    implementation: app/src/operation/__tests__/line/delete.test.ts::提出済みの申請の明細は消せない
  - id: TC-LINE-DELETE-003
    type: unit
    covers: [forbidden]
    spec_ids: [line-access]
    implementation: app/src/operation/__tests__/line/delete.test.ts::他人の申請の明細は消せない
  - id: TC-LINE-DELETE-004
    type: unit
    covers: [conflict, not_found]
    spec_ids: [line.delete]
    implementation: app/src/operation/__tests__/line/delete.test.ts::対象が消えていても存在を漏らさずに断る
  - id: TC-LINE-DELETE-005
    type: integration
    covers: [invariant]
    spec_ids: [INV-CLAIM-001]
    implementation: app/src/composition/__tests__/line/delete.test.ts::最後の明細を消したあとは提出できない
---

# 明細を消す（line.delete）

- 論理削除にしない — 下書きのうちの消しは履歴として残す必要が無い。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
