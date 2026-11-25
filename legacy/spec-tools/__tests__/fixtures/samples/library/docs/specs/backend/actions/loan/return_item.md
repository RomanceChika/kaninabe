---
doc_type: action_spec
scope: backend
id: loan-return_item-action

handles: loan.return_item

input:
  - loan.id

# 導出は confirm_required = true(irreversible ∧ affects_others — 返却済みは終端で、司書も起こせる)。戻れないことは認める:
# 返却済みの貸出は終端で、誤って返却にしても元の貸出の状態へは戻せない(貸出を作り直しても別の貸出の行になる)。それでも
# 確認を外すのは、返却は貸出の通常の完了で、返却台に本が置かれた事実が操作の根拠になり、窓口では返却が流れ作業で頻度が高く、
# 1 冊ごとの確認が列を止めるため。誤ったときの損害は、1 件の貸出が完了の記録になる範囲にとどまる。(2026-10-06 題材の裁定)
ux:
  confirm: none
  reason: 返却済みは終端で戻せない。ただし返却は貸出の通常の完了で、返却台に本が置かれた事実が根拠になり、誤ったときの損害は 1 件の貸出の完了の記録にとどまる。窓口では頻度が高い流れ作業で、1 冊ごとの確認が列を止める(2026-10-06 題材の裁定)

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-LOAN-RETURN_ITEM-001
    type: unit
    covers: [success]
    by_role: loan_owner
    spec_ids: [loan.return_item]
    implementation: app/src/operation/__tests__/loan/return_item.test.ts::借りた本人が返却できる
  - id: TC-LOAN-RETURN_ITEM-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [loan.return_item]
    implementation: app/src/operation/__tests__/loan/return_item.test.ts::司書はカウンターで返却を受け付けられる
  - id: TC-LOAN-RETURN_ITEM-003
    type: unit
    covers: [invalid_from]
    spec_ids: [loan.return_item]
    implementation: app/src/operation/__tests__/loan/return_item.test.ts::受け取り前の貸出は返却できない
  - id: TC-LOAN-RETURN_ITEM-004
    type: unit
    covers: [forbidden]
    spec_ids: [loan.return_item]
    implementation: app/src/operation/__tests__/loan/return_item.test.ts::他人の貸出は返却できない
  - id: TC-LOAN-RETURN_ITEM-005
    type: unit
    covers: [conflict]
    spec_ids: [loan.return_item]
    implementation: app/src/operation/__tests__/loan/return_item.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 貸出を返却する（loan.return_item）

- 延滞のまま返す経路を別の操作にしない — 延滞も貸出中も「返す」は同じ 1 つの操作である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
