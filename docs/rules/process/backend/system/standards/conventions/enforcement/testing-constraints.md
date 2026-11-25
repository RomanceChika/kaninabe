---
doc_type: process
scope: backend
norms: [PRIN-0003, PRIN-0005, PRIN-0006, ARCH-BE-0001]
---

# テスト構造の制約の機械執行

テストの書き方のうち、**設計を壊す書き方だけ**をリンターで塞ぐ。対応表の **T1・T2** の詳細。

## 目的・スコープ

- **目的:** 「テストが通っている」という事実を、設計の健全性の証拠として使える状態に保つ。モジュール差し替えを許すと、テストは**依存方向が壊れていても通ってしまう**（PRIN-0003）。
- **スコープ:** `app/src/**/*.ts(x)`（テストファイルを含む）。
- **正の所在:** テストの書き方そのものは [testing/unit.md](../testing/unit.md) / [testing/integration.md](../testing/integration.md)。本文書はそのうち**機械執行している 2 点**の理由と検出方法を書く。

## ルール

### モジュール差し替え API の禁止（T1 / T2）

- **禁止する呼び出し:**
  - `vi.mock` / `vi.doMock` / `vi.unmock` / `vi.doUnmock`
  - `jest.mock` / `jest.doMock` / `jest.unmock` / `jest.setMock` / `jest.requireMock`
- **すべきこと:** インターフェース（`src/operation/{aggregate}/ports.ts`）を切り、DI された注入点にテスト用実装を渡す。テスト用実装は `src/operation/__tests__/fakes/` に置き、複数のテストで共有してよい。
- **執行者:** `no-restricted-syntax`。`CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock|unmock|doUnmock)$/]` と、`jest` に対する同型のセレクタ。

### なぜ「禁止」なのか

モジュール差し替えは、**テストできない設計をテストできるように見せかける**道具である。

1. `src/operation` が Supabase クライアントを直接 import している（依存方向の違反）。
2. それでも `vi.mock('@supabase/supabase-js', …)` を書けばテストは通る。
3. 結果、**違反が緑のテストに隠れる**。

ARCH-BE-0001 は「内側の層で仕様網羅 100% が達成できないことは、テスト不足ではなく依存方向の破綻の兆候」と定めている。この診断が機能するのは、**逃げ道がないとき**だけである。T1 / T2 はその逃げ道を塞ぐルールであり、[layer-boundaries.md](./layer-boundaries.md) の B3（operation は具象を知らない）と対で成立している。

## コード例

### この例が示すルール: 依存は引数で注入し、テスト用実装を渡す（T1）

✅ 正しい

```ts
// app/src/operation/__tests__/fakes/loan-ports.ts
import type { LoanRepository } from '@/operation/loan/ports';
import type { Loan } from '@/domain/generated/loan.schema';

/** インメモリの LoanRepository。保存内容をテストから検査できる。 */
export function createFakeLoanRepository(seed: Loan[] = []) {
  const rows = new Map(seed.map((e) => [e.id, e]));
  return {
    repo: {
      async findById(id) { return rows.get(id) ?? null; },
      async save(loan) { rows.set(loan.id, loan); },
    } satisfies LoanRepository,
    rows,
  };
}
```

```ts
// app/src/operation/__tests__/loan/check_out.test.ts
import { describe, expect, it } from 'vitest';
import { checkOutLoan } from '@/operation/loan/check_out';
import { createFakeLoanRepository } from '../fakes/loan-ports';

describe('checkOutLoan', () => {
  // @tc TC-LOAN-CHECK_OUT-001
  it('受取待ちの貸出を受け取れる', async () => {
    const { repo, rows } = createFakeLoanRepository([requestedLoan]);
    await checkOutLoan({ repo, now: new Date('2026-01-01T00:00:00Z') }, { loanId: requestedLoan.id });
    expect(rows.get(requestedLoan.id)?.state).toBe('checked_out');
  });
});
```

❌ 間違い

```ts
// app/src/operation/__tests__/loan/check_out.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/loan/loan.repository', () => ({
  createLoanRepository: () => ({ findById: async () => requestedLoan, save: async () => {} }),
}));

import { checkOutLoan } from '@/operation/loan/check_out';
```

これは ESLint の `no-restricted-syntax` で検出される（「vi.mock() 等によるモジュール差し替えは禁止。インターフェースを切り、DIされた注入点にテスト用実装を渡すこと。」）。

**ポイント:** ❌ 側は、そもそも `src/operation` が `src/infrastructure` を import していることが前提になっている。その import 自体が `boundaries/dependencies` で落ちる。つまり**このテストが書きたくなった時点で設計が壊れている**。リンターは 2 か所で同じことを言っている。

### この例が示すルール: 現在時刻・ID 生成も注入点にする（T1 の帰結）

✅ 正しい

```ts
// 本体: 時刻は引数で受ける
export async function checkOutLoan(deps: { repo: LoanRepository; now: Date }, input: { loanId: string }) { /* … */ }

// テスト: 固定値を渡すだけでよい
await checkOutLoan({ repo, now: new Date('2026-03-01T09:00:00Z') }, { loanId });
```

❌ 間違い

```ts
// 本体が Date.now() を直接呼ぶ
export async function checkOutLoan(deps: { repo: LoanRepository }, input: { loanId: string }) {
  const now = new Date(); // ← テストから固定できない
}
```

```ts
// テスト側で時計を差し替える
vi.useFakeTimers(); // ← T1 の禁止セレクタには含まれないが、本体の設計が壊れている兆候
vi.setSystemTime(new Date('2026-03-01T09:00:00Z'));
```

`vi.useFakeTimers` は現在**リンターの禁止対象ではない**（`no-restricted-syntax` のセレクタは `mock` 系のみ）。しかし ARCH-BE-0001 は `src/domain` に「日時の取得」を置かないことを制約として定めており、`src/operation` も同じ方針に従う。**リンターが検出しない違反はレビューで見る**という切り分けを、ここで明示しておく。

## 注意点・例外

- **`vi.fn()` / `vi.spyOn()` は禁止していない。** 禁止しているのはモジュール解決への介入（`mock` 系）だけ。IF の実装として `vi.fn()` を使うのは注入点への差し込みであり、方針に反しない。
- **`vi.useFakeTimers()` は現在未執行。** 上記のとおり、リンターでは検出されない。
- **セレクタの適用範囲は `src/**` のみ。** `app/tests/*.mts`（統合テストの globalSetup / setup-env）と設定ファイルは `no-restricted-syntax` の対象外である。これらは層に属さないインフラ的コードのため、意図的に除外している。
- **`__tests__/fakes/` は半分だけ本体扱い。** `*.test.ts` ではないため 300 行の宣言（`layer/declared-oversize`）が効く（[file-size.md](./file-size.md)）。fake が 300 行を超えたら、IF が大きすぎるという信号として読む。一方、`src/**/__tests__/**` は JSDoc 必須（[public-symbol-docs.md](./public-symbol-docs.md)）と配置・命名規則（[naming-and-placement.md](./naming-and-placement.md)）からは免除されている。
- **テストファイルは境界を 1 点だけ緩めている。** `vitest` と `@testing-library/**` の import のみ。層境界は緩めていない（[layer-boundaries.md](./layer-boundaries.md)）。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [testing/unit.md](../testing/unit.md)（ユニットテストの規約。仕様網羅の定義・配置・命名）
- [testing/integration.md](../testing/integration.md)（統合テストの規約）
- [layer-boundaries.md](./layer-boundaries.md)（この制約を成立させている前提）
- [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)（E6）
