---
doc_type: action_spec
scope: backend
id: store-create-action

handles: store.create

input:
  - store.company_id
  - store.name
  - store.manager_id

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-STORE-CREATE-001
    type: unit
    covers: [success]
    by_role: company_admin
    spec_ids: [store.create]
    implementation: app/src/operation/__tests__/store/create.test.ts::会社管理者は店舗を足せる
  - id: TC-STORE-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [store-access]
    implementation: app/src/composition/__tests__/store/create.test.ts::管理者でない従業員は店舗を足せない
  - id: TC-STORE-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-STORE-001, INV-STORE-002]
    implementation: app/src/composition/__tests__/store/create.test.ts::同名の店舗と他社の責任者は拒否される
  # テナント境界(access_spec の creates[].when)—— 他社の company_id を渡した作成が拒否される
  - id: TC-STORE-CREATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [store-access]
    implementation: app/src/composition/__tests__/store/create.test.ts::他社の company_id を渡した作成は拒否される
  # 判断したときの前提を条件に書き込む(OCC)—— 会社が作成中に変わっていた実行は競合になる
  - id: TC-STORE-CREATE-005
    type: integration
    covers: [conflict]
    spec_ids: [store.create]
    implementation: app/src/composition/__tests__/store/create.test.ts::判断のあとに実行者の会社が変わっていた作成は競合になる
---

# 店舗の追加(store.create)

- `company_id` は input で受けるが、他社の値は通らない — access_spec の `creates[].when`(`store.company_id == actor.company_id`)が実行者の所属会社と突き合わせる(束 ⑲-2a)。`actor.company_id` が引けるのは `staff_member.company_id` が `session: true` だからである。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
