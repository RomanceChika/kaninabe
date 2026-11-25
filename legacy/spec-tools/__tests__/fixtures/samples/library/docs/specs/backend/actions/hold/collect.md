---
doc_type: action_spec
scope: backend
id: hold-collect-action

handles: hold.collect

input:
  - hold.id

# 導出は confirm_required = true(irreversible ∧ affects_others — 受取済みは終端で、司書も起こせる)。戻れないことは認める。
# それでも確認を外すのは、受け取りが取置の通常の完了で、受け取りの後に戻す業務がドメインに存在しないため(受取済みから
# 巻き戻したい場面は、確認ではなく別の運用の話になる)。この操作は利用者本人の画面(my_library)にも載るので窓口の事情に
# 頼らず、利用者が自分の予約を自分で受け取る操作で、誤ったときの損害は予約 1 件の完了にとどまる。窓口でも受け取りは頻度が
# 高い流れ作業で、1 件ごとの確認は列を止める。(2026-10-06 題材の裁定)
ux:
  confirm: none
  reason: 受け取りの後に戻す業務がドメインに存在しない(受取済みは終端で戻せないことは認める)。誤ったときの損害は予約 1 件の完了にとどまり、窓口では頻度が高い流れ作業で 1 件ごとの確認が列を止める(2026-10-06 題材の裁定)

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-HOLD-COLLECT-001
    type: unit
    covers: [success]
    by_role: hold_owner
    spec_ids: [hold.collect]
    implementation: app/src/operation/__tests__/hold/collect.test.ts::予約した本人が取置を受け取れる
  - id: TC-HOLD-COLLECT-002
    type: unit
    covers: [success]
    by_role: librarian
    spec_ids: [hold.collect]
    implementation: app/src/operation/__tests__/hold/collect.test.ts::司書はカウンターで取置を渡せる
  - id: TC-HOLD-COLLECT-003
    type: unit
    covers: [invalid_from]
    spec_ids: [hold.collect]
    implementation: app/src/operation/__tests__/hold/collect.test.ts::受付のままの予約は受け取れない
  - id: TC-HOLD-COLLECT-004
    type: unit
    covers: [forbidden]
    spec_ids: [hold.collect]
    implementation: app/src/operation/__tests__/hold/collect.test.ts::他人の予約は受け取れない
  - id: TC-HOLD-COLLECT-005
    type: unit
    covers: [conflict]
    spec_ids: [hold.collect]
    implementation: app/src/operation/__tests__/hold/collect.test.ts::判断後に状態が動いていたら競合として拒否される
---

# 取置を受け取る（hold.collect）

- 貸出の作成はここに混ぜない — 受け取りと貸出は別の操作であり、まとめるのは保存点の仕事である。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
