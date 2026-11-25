---
doc_type: action_spec
scope: backend
id: section-create-action

handles: section.create

input:
  - section.store_id
  - section.name

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SECTION-CREATE-001
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [section.create]
    implementation: app/src/operation/__tests__/section/create.test.ts::店舗責任者は自店舗に売場を足せる
  - id: TC-SECTION-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [section-access]
    implementation: app/src/composition/__tests__/section/create.test.ts::他店舗の責任者は売場を足せない
  - id: TC-SECTION-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-SECTION-001, INV-SECTION-002]
    implementation: app/src/composition/__tests__/section/create.test.ts::同名の売場は作れず、会社は店舗から引き当てられる
  # テナント境界(access_spec の creates[].when)—— 他社の store_id を渡した作成が拒否される
  - id: TC-SECTION-CREATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [section-access]
    implementation: app/src/composition/__tests__/section/create.test.ts::他社の店舗への売場の追加は拒否される
  # 判断したときの前提を条件に書き込む(OCC)—— 会社が作成中に変わっていた実行は競合になる
  - id: TC-SECTION-CREATE-005
    type: integration
    covers: [conflict]
    spec_ids: [section.create]
    implementation: app/src/composition/__tests__/section/create.test.ts::判断のあとに実行者の会社が変わっていた売場の追加は競合になる
---

# 売場の追加(section.create)

- `company_id` は input に無い — 店舗から引き当てる値であり、入力に開くと木の途中でテナントがずれる(INV-SECTION-002)。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
