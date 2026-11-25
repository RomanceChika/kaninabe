---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0002, PRIN-0006, PRIN-0009, ARCH-BE-0001]
decisions: [ADR-0004]
---

# 型の厳格性の機械執行

TypeScript の型検査を「最も安価な仕様検証」として使い切るための設定。対応表の **Y1〜Y13** の詳細。

## 目的・スコープ

- **目的:** 仕様から生成した型（zod スキーマ・遷移テーブル）と実装のズレを、テストより前・実行より前に落とす（PRIN-0001 / ADR-0004）。
- **スコープ:** `app/` の全 TypeScript コード。ESLint の型認識ルールは `src/**/*.ts(x)` に限定、tsc のオプションは `app/` 全体に効く。
- **正の所在:** 本文書。ARCH-BE-0001 は「TypeScript（strict）」とだけ定めており、個々のオプションの根拠はここに置く。

## ルール

### `any` を明示的にも暗黙的にも通さない（Y1 / Y2）

- **してはいけないこと:** `any` を書く。`any` の値を代入・引数渡し・呼び出し・プロパティ参照・返却する。
- **すべきこと:** 外部からの入力（`FormData`・環境変数・外部 API のレスポンス）は `unknown` で受け、**パース境界で zod スキーマを通してから**型付きの領域に入れる。以降は型付きの値だけを流す（[scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md) と同じ方針）。
- **なぜ:** `any` は 1 か所書くだけで、そこを通る値の型検査を全部無効化する。生成された zod スキーマと実装の対応が型で保証されなくなり、「仕様が正」の担保がテストだけになる。
- **執行者:** `@typescript-eslint/no-explicit-any`（Y1）、`no-unsafe-assignment` / `no-unsafe-argument` / `no-unsafe-call` / `no-unsafe-member-access` / `no-unsafe-return` ほか（Y2）。

### Promise を取りこぼさない（Y3）

- **してはいけないこと:** Promise を返す式を `await` も `void` も付けずに捨てる。`async` 関数を、同期関数を期待する場所（`Array#filter` のコールバック等）に渡す。
- **なぜ:** 「永続化 → outbox を同一トランザクションで」という順序は仕様の一部（ARCH-BE-0013 / ARCH-BE-0015）であり、`await` の取りこぼしはそのまま仕様違反になる。しかも実行時には例外にならず、静かに順序だけが崩れる。
- **執行者:** `@typescript-eslint/no-floating-promises` / `no-misused-promises` / `await-thenable` / `require-await`。

### 型専用 import を明示する（Y5 / Y13）

- **すべきこと:** 型としてしか使わない import は `import type` で書く。
- **なぜ:** `verbatimModuleSyntax` 下では、`import` 文はそのまま出力に残る。型だけの import が値として残ると、`src/infrastructure` → `src/operation` の依存性逆転（B5）が**実行時の依存になってしまう**。`import type` は境界の意味を出力にまで保つ。
- **執行者:** ESLint `@typescript-eslint/consistent-type-imports` + tsc `verbatimModuleSyntax` / `isolatedModules`。

### tsc の厳格オプション（Y7〜Y12）

| オプション | 何が変わるか | なぜ入れているか |
|---|---|---|
| `strict: true` | `noImplicitAny` / `strictNullChecks` / `strictFunctionTypes` / `strictBindCallApply` / `strictPropertyInitialization` / `useUnknownInCatchVariables` / `alwaysStrict` が一括で有効 | null 安全は後から入れると全面改修になる。最初から入れる |
| `noUncheckedIndexedAccess: true` | `arr[0]` の型が `T \| undefined` になる | 「存在しない」を型で扱わせる。状態遷移テーブルの引き当て（`table[state]?.[event]`）で特に効く |
| `exactOptionalPropertyTypes: true` | `{ a?: string }` に `{ a: undefined }` を渡せない | 「キーが無い（未入力）」と「値が undefined（明示的な空）」を仕様どおり区別する |
| `noImplicitOverride: true` | 基底メンバーの上書きに `override` が必要 | 基底側のリネームで、上書きのつもりが新規メンバーになる事故を防ぐ |
| `noFallthroughCasesInSwitch: true` | `case` の落下がエラー | 状態機械の分岐は仕様と 1:1 であり、意図しない落下は仕様違反 |
| `forceConsistentCasingInFileNames: true` | 参照とファイル名の綴りの不一致がエラー | macOS で通り Linux（CI・Vercel）で落ちる差異を手元で検出する |

## コード例

### この例が示すルール: 外部入力は `unknown` で受けて zod で絞る（Y1 / Y2）

✅ 正しい

```ts
// app/src/app/_actions/loan/check_out.ts
'use server';
import { loanCheckOutInputSchema } from '@/domain/generated/loan.schema';
import type { ActionResult } from '@kaninabe/runtime/result';

export async function checkOutLoanAction(formData: FormData): Promise<ActionResult<void>> {
  const parsed = loanCheckOutInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: { kind: 'invalid_input', issues: toFieldIssues(parsed.error) } };
  }
  // ここから先は parsed.data が型付き
}
```

❌ 間違い

```ts
export async function checkOutLoanAction(formData: FormData): Promise<ActionResult<void>> {
  const input = Object.fromEntries(formData) as any;   // ← ①
  const renewals: number = input.renewals;        // ← ②
  await repo.save({ ...input, renewals });           // ← ③
}
```

- ① は ESLint の `@typescript-eslint/no-explicit-any` で検出される。
- ② は `@typescript-eslint/no-unsafe-assignment` と `no-unsafe-member-access` で検出される。
- ③ は `@typescript-eslint/no-unsafe-argument` で検出される。

**ポイント:** `as any` を 1 つ置くと、そこから下流のすべてが検査対象から外れる。unsafe-* 群は「`any` を消し忘れた」ではなく「**`any` を隠した**」ケースを捕まえるためにある。

### この例が示すルール: 添字アクセスは `undefined` を含む（Y8）

✅ 正しい

```ts
// app/src/domain/engine/machine.ts
export function canFire(table: MachineTable, state: string, event: string): boolean {
  const byEvent = table[state];
  if (byEvent === undefined) return false; // 仕様に無い状態は「発火できない」
  return byEvent[event] !== undefined;
}
```

❌ 間違い

```ts
export function canFire(table: MachineTable, state: string, event: string): boolean {
  return table[state][event] !== undefined; // ← state が未知なら実行時に TypeError
}
```

これは **tsc の `noUncheckedIndexedAccess`** で検出される（`table[state]` の型が `... | undefined` になるため、`[event]` のアクセスがエラーになる）。

**ポイント:** 状態機械のテーブル引きは、仕様に無い状態が来たときの挙動が最も重要である。`noUncheckedIndexedAccess` は、その分岐を書き忘れることを許さない。

### この例が示すルール: Promise を捨てない（Y3）

✅ 正しい

```ts
await deps.repo.save(next);
await deps.outbox.enqueue(effects);
```

❌ 間違い

```ts
deps.repo.save(next);          // ← ①
deps.outbox.enqueue(effects);  // ← ②（①より先に走りうる）
```

これは ESLint の `@typescript-eslint/no-floating-promises` で検出される。

❌ 間違い（もう一例）

```tsx
<button onClick={() => void checkOutLoanAction(formData)}>送信</button>  // OK（void で明示）
<ul>{items.filter(async (i) => await isVisible(i))}</ul>                // ← async を同期コールバックに渡している
```

後者は ESLint の `@typescript-eslint/no-misused-promises` で検出される（`filter` は `boolean` を期待するが Promise が返る＝常に truthy）。

### この例が示すルール: 「キーが無い」と「undefined」を混ぜない（Y9）

✅ 正しい

```ts
type LoanPatch = { note?: string };

const patch: LoanPatch = note === null ? {} : { note };
```

❌ 間違い

```ts
const patch: LoanPatch = { note: note ?? undefined }; // ← 「note を undefined に更新する」意味になる
```

これは **tsc の `exactOptionalPropertyTypes`** で検出される。

**ポイント:** 部分更新（PATCH 的な操作）では、この 2 つの区別がそのまま DB の UPDATE 文の差になる。型で区別しておくと、`access_spec` の `writes`（どの列を更新するか）と実装の対応が読める。

### この例が示すルール: 型だけの import は `import type`（Y5）

✅ 正しい

```ts
import 'server-only';
import type { LoanRepository } from '@/operation/loan/ports';
```

❌ 間違い

```ts
import { type LoanRepository } from '@/operation/loan/ports'; // 設定次第だがスタイル不統一
import { LoanRepository } from '@/operation/loan/ports';      // ← 値としての import
```

後者は ESLint の `@typescript-eslint/consistent-type-imports` で検出される。加えて、`boundaries/dependencies` の依存性逆転ポリシー（`dependency: { kind: "type" }`）にも該当しなくなるため、**層境界の側でも落ちる**。

## 注意点・例外

- **`skipLibCheck: true` を入れている。** `node_modules` の型定義エラーで自コードの検査が止まるのを避けるための意図的な緩和。自コードの厳格さには影響しない。
- **`allowJs: true` を入れている。** ただし `**/*.js` / `*.mjs` / `*.cjs` には ESLint の型認識ルールを適用していない（`tseslint.configs.disableTypeChecked`）。JS で書いてよいのは設定ファイルだけである。
- **`noUnusedLocals` / `noUnusedParameters` は tsc 側では設定していない。** 同じ検査を ESLint の `@typescript-eslint/no-unused-vars` が担い、`_` 接頭辞による除外を効かせている（Y4）。二重に持たないのは PRIN-0007 に従った判断である。
- **型認識ルールは `src/**` のみ。** `projectService: true` で tsconfig を解決している。`app/tests/*.mts` は対象外。
- **`no-explicit-any` は `eslint-config-next/typescript` にも含まれるが、`recommendedTypeChecked` ブロックで明示的に再宣言している。** 「Next の既定に依存せず、このリポジトリの意思として禁止している」ことを設定上も示すため。緩和するときは本文書の改訂が必要。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)（`legacy/spec-tools/` 側の同種の規約。`any` 禁止・パース境界の考え方は共通）
- [server-actions.md](../server-actions.md)（`Result` 型とエラー分類。型で仕様を表す代表例）
- [layer-boundaries.md](./layer-boundaries.md)（`import type` が境界の意味を持つ理由）
