---
doc_type: action_spec
scope: backend
id: shelf-create-action

handles: shelf.create

input:
  - shelf.section_id
  - shelf.code
  - shelf.is_active

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-SHELF-CREATE-001
    type: unit
    covers: [success]
    by_role: store_manager
    spec_ids: [shelf.create]
    implementation: app/src/operation/__tests__/shelf/create.test.ts::店舗責任者は自店舗の売場に棚を足せる
  - id: TC-SHELF-CREATE-002
    type: integration
    covers: [forbidden]
    spec_ids: [shelf-access]
    implementation: app/src/composition/__tests__/shelf/create.test.ts::他店舗の責任者は棚を足せない
  - id: TC-SHELF-CREATE-003
    type: integration
    covers: [invariant]
    spec_ids: [INV-SHELF-001, INV-SHELF-002]
    implementation: app/src/composition/__tests__/shelf/create.test.ts::同じ売場の同じ棚番は作れず、会社の境界は売場から引き当てられる
  # テナント境界(access_spec の creates[].when)—— 他社の section_id を渡した作成が拒否される
  - id: TC-SHELF-CREATE-004
    type: integration
    covers: [guard_unsatisfied]
    spec_ids: [shelf-access]
    implementation: app/src/composition/__tests__/shelf/create.test.ts::他社の売場への棚の追加は拒否される
  # 判断したときの前提を条件に書き込む(OCC)—— 会社が作成中に変わっていた実行は競合になる
  - id: TC-SHELF-CREATE-005
    type: integration
    covers: [conflict]
    spec_ids: [shelf.create]
    implementation: app/src/composition/__tests__/shelf/create.test.ts::判断のあとに実行者の会社が変わっていた棚の追加は競合になる
---

# 棚の追加(shelf.create)

- `company_id` は input に無い — 売場から引き当てる可視性の境界であり、入力に開くとテナントを跨いだ棚が作れてしまう。
- `store_id` の列は持たない(束 ⑲-2a) — 店舗の責任者かどうかは `shelf → section → store` を 2 段辿って判定される。

<!-- AUTO-GENERATED:action-body -->
<!-- /AUTO-GENERATED:action-body -->
