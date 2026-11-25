---
doc_type: process
scope: backend
norms: [PRIN-0003, PRIN-0005, PRIN-0007, ARCH-BE-0001]
decisions: [ADR-0004]
---

# 層境界の機械執行

`app/src` の 6 層の依存方向を、レビューではなくリンターで固定する。対応表の **B1〜B12** の詳細。

## 目的・スコープ

- **目的:** 依存方向が壊れたコードを、書いた本人がコミット前に検出できる状態にする。「気をつける」を仕組みに置き換える（PRIN-0005）。
- **スコープ:** `app/src/**/*.ts` / `*.tsx` の import 関係すべて。層内部の import（同じ層のファイル同士）は対象外。
- **正の所在:** 依存方向の表は [ARCH-BE-0001「依存方向」](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)。本文書はその執行方法と、違反の見分け方を書く。

## ルール

### 既定は禁止（allowlist 方式）

- **保証されること:** 明示的に許可した方向以外の import は、層をまたぐものも外部パッケージも Node 組み込みも、すべてエラーになる。
- **なぜ:** 禁止を列挙する方式は、新しい層・新しい依存が増えるたびに列挙側を更新しないと穴が開く。既定禁止なら、**書き忘れは常に安全側に寄る**（PRIN-0009 の考え方を依存管理に適用したもの）。
- **執行者:** `boundaries/dependencies`（`default: "disallow"`, `checkAllOrigins: true`）。`checkAllOrigins` により、層だけでなく外部パッケージ・Node 組み込みも判定対象になる。
- **評価順:** ポリシーは last-write-wins。後ろに書いたポリシーが前のものを上書きする。

### 層ごとの許可

| 層 | import してよいもの | 典型的な違反 |
|---|---|---|
| `src/domain` | `zod` のみ | `next/headers`、`node:crypto`、`@/operation/...` |
| `src/operation` | `src/domain`、`zod` | `@supabase/supabase-js`、`@/infrastructure/...` |
| `src/infrastructure` | `src/domain`、外部SDK/Node組み込み、`src/operation/**/ports.ts`（**型のみ**） | `@/composition/...`、operation の関数本体の import |
| `src/composition` | `src/domain`、`src/operation`、`src/infrastructure`、外部SDK/Node組み込み | `@/app/...`、`@/components/...` |
| `src/app` | `src/composition`、`src/domain`、`src/components`、外部パッケージ | `@/operation/...`、`@/infrastructure/...` の直接 import |
| `src/components` | `src/domain`、クライアント安全な外部パッケージ | `server-only`、`@supabase/**`、`node:**`、他層すべて |
| `src/proxy.ts`（層ではない入口） | `src/infrastructure`、外部パッケージ | `@/composition/...`（認可の判定を前段に持ち込む）、`@/domain/...` |

### 層に属さないファイルを作らない（B10）

- **保証されること:** `src/**` のファイルは必ずいずれかの層かファイル分類に属する。属さないファイルはエラーになる。
- **なぜ:** 分類されないファイルには**依存方向の検査が一切かからない**（B1 は要素に属するファイルだけを見る）。「層の外側に置けば何でも import できる」抜け道を塞ぐ。
- **執行者:** `boundaries/no-unknown-files`。
- **入口を足すときは:** フレームワークが位置を決めるファイル（`src/proxy.ts` のような）は、`boundaries/files` に分類を登録し、`from: { file: { categories: ... } }` のポリシーで許可先を宣言してから置く。ARCH-BE-0001 の「層に属さないフレームワーク入口」の表にも 1 行足す。

### 依存性逆転の許可は「型のみ・`ports.ts` のみ」

- **すべきこと:** `src/infrastructure` が `src/operation` を参照するのは、operation が宣言した IF を実装するときだけ。`import type` で `src/operation/{aggregate}/ports.ts` から型を取る。
- **してはいけないこと:** operation の関数本体を infrastructure から呼ぶ。`ports.ts` 以外のファイルを参照する。
- **執行者:** `dependency: { kind: "type" }` と `file: { categories: "ports" }`（`boundaries/files` で `**/ports.ts` を `ports` カテゴリとして定義）の 2 条件を同時に満たすポリシーのみ許可。

### テストの扱い

- テストファイル（`**/*.test.{ts,tsx}` = `test` カテゴリ）だけは `vitest` と `@testing-library/**` を import してよい。
- **層境界そのものは緩めない。** `src/operation/__tests__/` のテストから `@/infrastructure/...` を import することはできない。テスト用の実装は `__tests__/fakes/` に置き、IF として注入する（[testing-constraints.md](./testing-constraints.md)）。

## コード例

### この例が示すルール: operation は具象を知らず、IF を引数で受ける（B3）

✅ 正しい

```ts
// app/src/operation/loan/ports.ts — operation が「欲しいもの」を業務語彙で宣言する
import type { Loan } from '@/domain/generated/loan.schema';

export interface LoanRepository {
  findById(id: string): Promise<Loan | null>;
  save(loan: Loan): Promise<void>;
}
```

```ts
// app/src/operation/loan/check_out.ts — 具象は引数で受ける
import type { LoanRepository } from './ports';

export async function checkOutLoan(
  deps: { repo: LoanRepository; now: Date },
  input: { loanId: string },
): Promise<void> {
  const loan = await deps.repo.findById(input.loanId);
  // …遷移可否は @kaninabe/runtime/engine に問い合わせる
}
```

❌ 間違い

```ts
// app/src/operation/loan/check_out.ts
import { createClient } from '@supabase/supabase-js'; // ← operation が具象を知っている

export async function checkOutLoan(input: { loanId: string }): Promise<void> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  // …
}
```

これは ESLint の `boundaries/dependencies` で検出される（`from: operation` ポリシーが許可するのは `src/domain` と `zod` だけ）。加えて `process.env.SUPABASE_URL!` は tsc の `strict`（`strictNullChecks`）下で非 null アサーションを要求している点でも設計の匂いである。

**ポイント:** この境界が守られている限り、operation のテストに DB もモジュール差し替えも要らない。`vi.mock` を禁止できる（T1）のは、この境界が先にあるからである。

### この例が示すルール: infrastructure から operation への参照は型だけ（B5）

✅ 正しい

```ts
// app/src/infrastructure/loan/loan.repository.ts
import 'server-only';
import type { LoanRepository } from '@/operation/loan/ports'; // 型のみ
import type { SupabaseClient } from '@supabase/supabase-js';

export function createLoanRepository(client: SupabaseClient): LoanRepository {
  return {
    async findById(id) { /* … */ },
    async save(loan) { /* … */ },
  };
}
```

❌ 間違い

```ts
// app/src/infrastructure/loan/loan.repository.ts
import 'server-only';
import { checkOutLoan } from '@/operation/loan/check_out'; // ← 値の import。しかも ports.ts ではない
```

これは ESLint の `boundaries/dependencies` で検出される（`dependency: { kind: "type" }` かつ `file: { categories: "ports" }` の組み合わせのみが許可されているため、値 import も `ports.ts` 以外の参照も落ちる）。

### この例が示すルール: `src/app` は必ず composition を経由する（B7）

✅ 正しい

```ts
// app/src/app/_actions/loan/check_out.ts
'use server';
import { getLoanInteractor } from '@/composition';
import type { ActionResult } from '@kaninabe/runtime/result';

export async function checkOutLoanAction(formData: FormData): Promise<ActionResult<void>> {
  const { checkOutLoan } = await getLoanInteractor();
  return checkOutLoan({ loanId: String(formData.get('loanId')) });
}
```

❌ 間違い

```ts
// app/src/app/_actions/loan/check_out.ts
'use server';
import { checkOutLoan } from '@/operation/loan/check_out';           // ← operation を直接
import { createLoanRepository } from '@/infrastructure/loan/loan.repository'; // ← 配線を app に書いている
```

これは ESLint の `boundaries/dependencies` で検出される（`from: app` ポリシーが許可するのは `composition` / `domain` / `components` と外部パッケージのみ）。

**ポイント:** 配線を 1 か所（`src/composition`）に閉じておくと、Supabase を差し替えるときに触るファイルが composition と infrastructure だけで済む。

**B12（Route Handler）はこの B7 の特殊化である。** `src/app/api/**/route.ts` は `src/app` の一部なので、上と同じ `from: app` ポリシーがすでに掛かっており、新しいルールは追加していない。[route-handlers.md](../route-handlers.md) が唯一認める例外（逐次配信）でも `@/operation/*` / `@/infrastructure/*` は import できず、委譲先は `@/composition/*` に限られる。保証台帳（[guarantees.md](../../../../../../../specs/backend/guarantees.md) の `route_handler_no_writes`）の専用見張りテストが `app/src/infrastructure/__tests__/guarantees/route-handler-boundary.test.ts`（(旧製品の保証台帳の行)）で、実際に使われている `eslint.config.mjs` に対して違反例・適合例を通して確かめる。

### この例が示すルール: domain は依存ゼロ（B2）

❌ 間違い

```ts
// framework/runtime/src/domain/engine/machine.ts
import { randomUUID } from 'node:crypto'; // ← Node 組み込み
import { headers } from 'next/headers';   // ← Next.js
```

これは ESLint の `boundaries/dependencies` で検出される（`from: domain` ポリシーが許可するのは `zod` のみ。`checkAllOrigins: true` により `core`（Node 組み込み）と `external` も判定対象）。

**ポイント:** ID 生成・現在時刻は domain の外で作り、**引数で渡す**。これは ARCH-BE-0001 の「`src/domain` に I/O・日時の取得・乱数を置かない」の裏返しであり、テストの決定性（PRIN-0003）を作る。

## 注意点・例外

- **同一層内の import は判定されない。** `eslint-plugin-boundaries` は同じ要素（層）内の依存を「要素内部の依存」として既定で無視する。層内の構造は300 行の宣言（[file-size.md](./file-size.md)）とレビューで保つ。
- **`src/app` から `src/components` への import は許可されている**が、逆（components → app）は許可されていない。UI から Server Action を呼ぶ場合は、`src/app` 側が props としてアクションを渡す。
- **層境界は静的な import グラフしか見ない。** 動的 `import()` や文字列組み立てによる解決は原理的に追えないため、server / client の分離については [server-client-separation.md](./server-client-separation.md) の第二防衛線を併用している。
- **層を増やすときは設定より先に ARCH-BE-0001 を改訂する。** `boundaries/elements` に type を足すだけの変更は禁止（PRIN-0007）。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [ARCH-BE-0001 — app パッケージの層構成と依存方向](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)
- [server-client-separation.md](./server-client-separation.md)（境界をすり抜けた場合の第二防衛線）
- [testing-constraints.md](./testing-constraints.md)（この境界があるから成立するテスト制約）
- [server-actions.md](../server-actions.md)（`src/app` 側の実装規約）
