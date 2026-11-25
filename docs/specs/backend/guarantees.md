---
doc_type: guarantee_spec
scope: backend
id: guarantee-catalog

vocabulary:
  enforcer:                              # 執行者の語彙(この題材の事情。検査器は分岐しない)
    - id: rls
      label: 行単位セキュリティ(Postgres RLS)
    - id: trigger
      label: DB トリガ
    - id: grant
      label: テーブル権限(GRANT / REVOKE)
    - id: parity_test
      label: 生成した期待表と実 DB の閉世界突合

guarantees:
  - id: loans_by_rls
    label: 他人の貸出は返らない
    enforced_by: [rls, parity_test]
    status: enforced
    canaries: [TC-GUAR-LOANS-001]
    summary: 貸出の表は RLS が有効で、宣言(reads)から生成した期待ポリシー表と pg_policies が過不足なく一致する
  - id: concurrent_loan_ceiling
    label: 同時貸出の上限を超える貸出は作れない
    enforced_by: [trigger]
    status: enforced
    canaries: [TC-GUAR-CEILING-001]
    summary: 同時に借りられる冊数の上限はコミット時に評価するトリガが執行し、アプリ側の判定をすり抜けた並行の申込みでも行が増えない
  - id: writes_only_via_rpc
    label: 書き込みは RPC だけ(直接 INSERT / UPDATE / DELETE は不可)
    enforced_by: [grant]
    status: enforced
    canaries: [TC-GUAR-WRITES-001]
    summary: 利用者のロールには表への INSERT / UPDATE / DELETE の権限が無く、全ての書き込みは security definer の RPC を経由する

test_cases:
  - id: TC-GUAR-LOANS-001
    type: integration
    covers: [forbidden]
    spec_ids: [guarantee-catalog]
    implementation: "app/src/infrastructure/__tests__/guarantees/loans-rls.test.ts::他人の貸出は 1 行も返らない"
  - id: TC-GUAR-CEILING-001
    type: integration
    covers: [forbidden]
    spec_ids: [guarantee-catalog]
    implementation: "app/src/infrastructure/__tests__/guarantees/loan-ceiling.test.ts::上限を超える並行の貸出はコミット時に拒否される"
  - id: TC-GUAR-WRITES-001
    type: integration
    covers: [forbidden]
    spec_ids: [guarantee-catalog]
    implementation: "app/src/infrastructure/__tests__/guarantees/writes-only-via-rpc.test.ts::利用者のロールは表へ直接書き込めない"
---

# 保証台帳 — 設計で不可能にした事実の目録

- **この題材に `status: planned` の行は無い。** 順番待ちの列(予約の受取順の公平性)は、予約が「取り置き 1 件」しか扱わない
  いまの仕様に実体が無いので、台帳に行を置かない(この版では扱わない。未処理の約束を台帳に積むと、Z2 が毎回言い立てる)。
- 見張りテストの実装ファイルは**この `fixture` には存在しない**。`fixture` は仕様だけを持ち、実装との
  突合(Z1 の `@tc`)は `app/` を読める本物のリポジトリの仕事である。

<!-- AUTO-GENERATED:guarantee-body -->
### 保証の全数(見張りテストを宣言していない保証は無い — enforced は canaries が必ず 1 つ以上ある)

| 保証 ID | 何が起こりえないか | 執行者 | 状態 | 見張りテスト | summary |
| --- | --- | --- | --- | --- | --- |
| `loans_by_rls` | 他人の貸出は返らない | rls(行単位セキュリティ(Postgres RLS)), parity_test(生成した期待表と実 DB の閉世界突合) | enforced | `TC-GUAR-LOANS-001` | 貸出の表は RLS が有効で、宣言(reads)から生成した期待ポリシー表と pg_policies が過不足なく一致する |
| `concurrent_loan_ceiling` | 同時貸出の上限を超える貸出は作れない | trigger(DB トリガ) | enforced | `TC-GUAR-CEILING-001` | 同時に借りられる冊数の上限はコミット時に評価するトリガが執行し、アプリ側の判定をすり抜けた並行の申込みでも行が増えない |
| `writes_only_via_rpc` | 書き込みは RPC だけ(直接 INSERT / UPDATE / DELETE は不可) | grant(テーブル権限(GRANT / REVOKE)) | enforced | `TC-GUAR-WRITES-001` | 利用者のロールには表への INSERT / UPDATE / DELETE の権限が無く、全ての書き込みは security definer の RPC を経由する |

### まだ執行されていない保証

無し(すべて enforced)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-GUAR-LOANS-001 | integration | forbidden | guarantee-catalog | `app/src/infrastructure/__tests__/guarantees/loans-rls.test.ts::他人の貸出は 1 行も返らない` |
| TC-GUAR-CEILING-001 | integration | forbidden | guarantee-catalog | `app/src/infrastructure/__tests__/guarantees/loan-ceiling.test.ts::上限を超える並行の貸出はコミット時に拒否される` |
| TC-GUAR-WRITES-001 | integration | forbidden | guarantee-catalog | `app/src/infrastructure/__tests__/guarantees/writes-only-via-rpc.test.ts::利用者のロールは表へ直接書き込めない` |
<!-- /AUTO-GENERATED:guarantee-body -->
