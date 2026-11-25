---
doc_type: usecase_spec
scope: frontend
id: usecase-borrow-self
name: borrow_self
goal: 棚にある本を自分で借りる
actor: patron
start: screen-item-detail
done: loan.state == checked_out

saves:
  - id: borrow
    label: 借りる
    migration: 20260911090000_usecase_borrow_self_borrow.sql
    steps:
      - op: loan.create
        label: 借りる本
        defaults:
          self: true
      - op: loan.check_out
        label: 受け取り

test_cases:
  - id: TC-USECASE-BORROW_SELF-001
    type: integration
    covers: [success]
    spec_ids: [usecase-borrow-self]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::borrow_self.borrow の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-BORROW_SELF-002
    type: integration
    covers: [success]
    spec_ids: [usecase-borrow-self]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::borrow_self.borrow の複合 RPC の本文が生成物と一致する
  # 保存点の decide ⇔ 複合 RPC の一致の証明(束 ⑳-5a2)も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  - id: TC-EQ-UC_BORROW_SELF-0001
    type: integration
    covers: [other]
    spec_ids: [usecase-borrow-self]
    implementation: "app/src/composition/__tests__/generated/equivalence/borrow_self.uc.eq.test.ts::borrow_self.borrow の判定の全 27 通りで decide と複合 RPC の結末が一致する"
  - id: TC-EQ-UC_BORROW_SELF-0002
    type: integration
    covers: [other]
    spec_ids: [usecase-borrow-self]
    implementation: "app/src/composition/__tests__/generated/equivalence/borrow_self.uc.eq.test.ts::borrow_self.borrow の書き込み経路の全 2 通りで宣言どおりの行ができる"
  - id: TC-EQ-UC_BORROW_SELF-0003
    type: integration
    covers: [other]
    spec_ids: [usecase-borrow-self]
    implementation: "app/src/composition/__tests__/generated/equivalence/borrow_self.uc.eq.test.ts::borrow_self.borrow の world が設計図どおりに作られている"
  # /AUTO-GENERATED:usecase-eq-tests
---

# 棚の本を自分で借りる（borrow_self）

- 蔵書を貸出中にする手順（item.lend）は入れない — 保存点の再送の読み直しが「最初に作る行からの鎖」しか辿れず、保存点の外にある別集約への遷移を混ぜられないため（在庫はカウンターの操作で動かす）。混ぜると Y12 が反例と対処つきで止める（束 ⑲-1 で生成器の例外から検査へ移した）。

