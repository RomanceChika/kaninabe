---
doc_type: usecase_spec
scope: frontend
id: usecase-hold-and-collect
name: hold_and_collect
goal: 貸出中の本を予約して、用意できたら受け取る
actor: patron
start: screen-item-detail
done: hold.state == collected

saves:
  - id: place
    label: 予約をかける
    migration: 20260911090100_usecase_hold_and_collect_place.sql
    steps:
      - op: hold.create
        label: 予約
        defaults:
          self: true
  - id: collect
    label: 取置を受け取る
    migration: 20260911090200_usecase_hold_and_collect_collect.sql
    steps:
      - op: hold.collect
        label: 受取

test_cases:
  - id: TC-USECASE-HOLD_AND_COLLECT-001
    type: integration
    covers: [success]
    spec_ids: [usecase-hold-and-collect]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::hold_and_collect.place の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-HOLD_AND_COLLECT-002
    type: integration
    covers: [success]
    spec_ids: [usecase-hold-and-collect]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::hold_and_collect.place の複合 RPC の本文が生成物と一致する
  - id: TC-USECASE-HOLD_AND_COLLECT-003
    type: integration
    covers: [success]
    spec_ids: [usecase-hold-and-collect]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::hold_and_collect.collect の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-HOLD_AND_COLLECT-004
    type: integration
    covers: [success]
    spec_ids: [usecase-hold-and-collect]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::hold_and_collect.collect の複合 RPC の本文が生成物と一致する
  # 保存点の decide ⇔ 複合 RPC の一致の証明(束 ⑳-5a2)も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  # /AUTO-GENERATED:usecase-eq-tests
---

# 予約して受け取る（hold_and_collect）

- 受け取りと同じ保存点で貸出を起こさない — 保存点の内側は「最初に作る行から辿れる手順」に限られ、別集約の行を混ぜられないため（受け取ったあと borrow_self で借りる）。混ぜると Y12 が止める。

