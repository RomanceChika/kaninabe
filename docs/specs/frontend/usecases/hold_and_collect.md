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
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0001
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.collect の判定の全 48 通りで decide と複合 RPC の結末が一致する"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0002
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.collect の書き込み経路の全 2 通りで宣言どおりの行ができる"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0003
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.collect の world が設計図どおりに作られている"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0004
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.place の判定の全 6 通りで decide と複合 RPC の結末が一致する"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0005
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.place の書き込み経路の全 4 通りで宣言どおりの行ができる"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0006
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.place の world が設計図どおりに作られている"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0007
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.place の同じ鍵で入力を 1 欄変えた押し直しは resend_input_mismatch で断られ、行は 1 回目のまま"
  - id: TC-EQ-UC_HOLD_AND_COLLECT-0008
    type: integration
    covers: [other]
    spec_ids: [usecase-hold-and-collect]
    implementation: "app/src/composition/__tests__/generated/equivalence/hold_and_collect.uc.eq.test.ts::hold_and_collect.place の 1 回目がコミットする前に届いた同じ鍵の押し直しは、同じ入力なら 1 回目の行を返し、変えた入力なら resend_input_mismatch で断られ、錨の行を消す txn と重なれば resend_target_deleted で断られる"
  # /AUTO-GENERATED:usecase-eq-tests
---

# 予約して受け取る（hold_and_collect）

- 受け取りと同じ保存点で貸出を起こさない — 保存点の内側は「最初に作る行から辿れる手順」に限られ、別集約の行を混ぜられないため（受け取ったあと borrow_self で借りる）。混ぜると Y12 が止める。

