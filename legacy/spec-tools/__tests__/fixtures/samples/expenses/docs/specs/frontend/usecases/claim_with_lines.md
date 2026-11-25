---
doc_type: usecase_spec
scope: frontend
id: usecase-claim-with-lines

name: claim_with_lines
goal: 明細を並べて経費申請を起こす
actor: employee
start: screen-claim-list
done: claim.state == draft

saves:
  - id: register
    label: 申請と明細をまとめて作る
    migration: 20260911000001_usecase_claim_with_lines_register.sql
    steps:
      - op: claim.create
        label: 申請
      - op: line.create
        as: lines
        label: 明細
        repeat: true

accept:
  - invariant: INV-CLAIM-001
    reason: 明細が1件以上あることは提出の遷移が見る条件であり、下書きを作るこの保存点では破れない
  - invariant: INV-CLAIM-003
    reason: 合計額は提出の遷移が確定させる列で、この保存点は1行も触らない

test_cases:
  - id: TC-USECASE-CLAIM_WITH_LINES-001
    type: integration
    covers: [success]
    spec_ids: [usecase-claim-with-lines]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::claim_with_lines.register の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-CLAIM_WITH_LINES-002
    type: integration
    covers: [success]
    spec_ids: [usecase-claim-with-lines]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::claim_with_lines.register の複合 RPC の本文が生成した SQL と一致する
  # 保存点の decide ⇔ 複合 RPC の一致の証明(束 ⑳-5a2)も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  # /AUTO-GENERATED:usecase-eq-tests
---

# 明細を並べて経費申請を起こす（claim_with_lines）

- 提出(claim.submit)は保存点に入れない — 合計額を確定させる computes の供給元を複合 RPC が
  渡せないため、1 手順ぶん外に出してある。入れると Y12 が「この供給元は複合 RPC に渡せない」と止める(束 ⑲-1 で生成器の例外から検査へ移した)。
- 承認以降はこのユースケースの範囲外(立場が違う人のタスクである)。
