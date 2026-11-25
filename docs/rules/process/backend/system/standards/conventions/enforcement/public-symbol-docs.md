---
doc_type: process
scope: backend
norms: [PRIN-0002, PRIN-0004, PRIN-0005, PRIN-0007, ARCH-BE-0001]
---

# 公開シンボルの説明の機械執行

`export` されたシンボル＝層の契約。契約には説明を付ける。対応表の **J1〜J4** の詳細。

## 目的・スコープ

- **目的:** 層の境界に現れるもの（他の層・他のファイルから見えるもの）を、読み手が定義に飛ばずに理解できる状態にする（PRIN-0002 / PRIN-0004）。
- **スコープ:** `app/src/**/*.ts(x)` の **export されたシンボルのみ**。テスト（`src/**/*.test.ts(x)`）、テスト支援コード（`src/**/__tests__/**`）、生成物（`src/domain/generated/**`）は対象外。
- **正の所在:** 本文書。`legacy/spec-tools/` 側の同趣旨の規定は [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)（「全エクスポートに JSDoc を付ける」）。

## 前提となる考え方

### 縛りの粒度

このリポジトリの機械執行は、**配置と公開シンボルまでを縛り、内側は自由にする**という粒度で設計されている。

| 対象 | 縛る | 執行者 |
|---|---|---|
| ファイルの置き場と export 名 | する | `layer/action-naming` / `layer/operation-naming`（[naming-and-placement.md](./naming-and-placement.md)） |
| export されたシンボルの説明 | する | `jsdoc/*`（本文書） |
| 関数の内部実装・ローカル変数・非 export の補助関数 | **しない** | — |
| 実装の逐次説明コメント | **求めない**（[scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md) と同方針） | — |

**なぜこの粒度か:** 契約（層の外から見えるもの）は複数人・複数層が依存するため、説明が無いと読み手側で推測が生まれ、推測は必ずズレる。一方、関数の内側は 1 人が 1 度に読み切れる単位（300 行以下。[file-size.md](./file-size.md)）に保たれているため、コード自体が説明になる。**縛る場所を絞ることで、形式を満たすためだけの同語反復コメントが増えるのを避けている。**

## ルール

### export された関数・クラスに JSDoc を付ける（J1）

- **対象:** `FunctionDeclaration` / `ClassDeclaration` / `ClassExpression` / `ArrowFunctionExpression` / `FunctionExpression` のうち、**export されているもの**。
- **執行者:** `jsdoc/require-jsdoc`（`publicOnly: true`, `enableFixer: false`）。`publicOnly` により、非 export のものは検査されない。自動修正は無効（空の JSDoc を機械が量産しないため）。

### export された type / interface / enum に JSDoc を付ける（J2）

- **対象:** `TSInterfaceDeclaration` / `TSTypeAliasDeclaration` / `TSEnumDeclaration`。
- **なぜ型も対象か:** このリポジトリでは層の契約が**型そのもの**として表現される（`operation/{aggregate}/ports.ts` の IF、`domain/result.ts` の `Result` / `ActionError`）。契約に説明が要るなら、その形が型であっても同じである。
- **執行者:** `jsdoc/require-jsdoc` の `contexts`。

### JSDoc は説明文を持つ（J3）

- **してはいけないこと:** タグだけの JSDoc（`/** @param x */`）や空の JSDoc（`/** */`）で要件を満たしたことにする。
- **執行者:** `jsdoc/require-description`（J1・J2 と同じ対象に適用）、`jsdoc/no-blank-blocks`。

### タグを書くなら説明を伴い、名前を実装と一致させる（J4）

- **`@param` / `@returns` の網羅は要求しない。** 型注釈があれば型は読めるので、機械が求めるのは「説明」だけである。
- **書いた場合は:** `@param` に説明を伴い（`require-param-description`）、`@returns` に説明を伴い（`require-returns-description`）、`@param` の名前が実際の引数と一致し（`check-param-names`）、値を取るタグが空でない（`empty-tags`）こと。
- **整形:** アスタリスクの位置を揃える（`check-alignment`）。
- **執行者:** `jsdoc/require-param-description` / `jsdoc/require-returns-description` / `jsdoc/check-param-names` / `jsdoc/empty-tags` / `jsdoc/check-alignment`。

## コード例

### この例が示すルール: 契約に「何を・なぜ」を書く（J1・J3）

✅ 正しい

```ts
// app/src/operation/loan/check_out.ts

/**
 * 貸出を受け取る（ドメインイベント loan.check_out）。
 *
 * 遷移可否は domain/engine に問い合わせ、永続化と effects の積み込みは
 * Repository IF 経由で同一トランザクションに載せる。
 */
export async function checkOutLoan(
  deps: { repo: LoanRepository; now: Date },
  input: { loanId: string },
): Promise<void> { /* … */ }
```

❌ 間違い

```ts
export async function checkOutLoan(deps: Deps, input: Input): Promise<void> { /* … */ }
```

これは ESLint の `jsdoc/require-jsdoc` で検出される（`publicOnly: true` のため、export されているこの関数が対象になる）。

❌ 間違い（空の JSDoc で形だけ満たす）

```ts
/** */
export async function checkOutLoan(deps: Deps, input: Input): Promise<void> { /* … */ }
```

```ts
/**
 * @param deps
 * @param input
 */
export async function checkOutLoan(deps: Deps, input: Input): Promise<void> { /* … */ }
```

前者は `jsdoc/no-blank-blocks` と `jsdoc/require-description` で、後者は `jsdoc/require-description`（説明文が無い）と `jsdoc/require-param-description`（`@param` に説明が無い）で検出される。

**ポイント:** このルールが求めているのは「JSDoc というブロックの存在」ではなく「**説明**」である。だから自動修正（`enableFixer`）を無効にしている。機械が空のブロックを埋めてしまうと、ルールの意味が消える。

### この例が示すルール: 型も契約なので説明が要る（J2）

✅ 正しい

```ts
// app/src/operation/loan/ports.ts

/** 貸出の永続化。実装は infrastructure が持ち、operation には引数で注入される。 */
export interface LoanRepository {
  findById(id: string): Promise<Loan | null>;
  save(loan: Loan): Promise<void>;
}

/** ドメイン上の拒否 3 分類 + 入力検証。分類の意味は ARCH-BE-0013 を正とする。 */
export type ActionError =
  | { kind: 'invalid_input'; issues: FieldIssue[] }
  | { kind: 'forbidden'; event: string; role: string };
```

❌ 間違い

```ts
export interface LoanRepository {
  findById(id: string): Promise<Loan | null>;
  save(loan: Loan): Promise<void>;
}
```

これは ESLint の `jsdoc/require-jsdoc` で検出される（`contexts` に `TSInterfaceDeclaration` を含めているため）。

**ポイント:** IF の名前（`LoanRepository`）は「何を」しか言わない。「実装がどこにあるか」「どう渡ってくるか」は名前からは読めないので、そこを 1 文で書く。

### この例が示すルール: 内側は縛らない（方針の確認）

✅ 正しい（JSDoc は不要）

```ts
/** 貸出の返却期限を過ぎているかを判定する。 */
export function isPastDeadline(deadline: Date, now: Date): boolean {
  // 非 export のローカル関数・変数には JSDoc を求めない
  const marginMs = 0;
  const normalize = (d: Date) => d.getTime() + marginMs;
  return normalize(now) > normalize(deadline);
}
```

`normalize` は `ArrowFunctionExpression` だが export されていないため、`publicOnly: true` により検査対象外。**「書いてはいけない」ではなく「求めない」**である。

### この例が示すルール: `@param` を書くなら実装と揃える（J4）

✅ 正しい

```ts
/**
 * snake_case を PascalCase に変換する。
 *
 * @param snake - snake_case の識別子
 * @returns PascalCase の識別子
 */
export function toPascalCase(snake: string): string { /* … */ }
```

❌ 間違い

```ts
/**
 * snake_case を PascalCase に変換する。
 *
 * @param input - snake_case の識別子   ← 実際の引数名は snake
 * @returns
 */
export function toPascalCase(snake: string): string { /* … */ }
```

`@param input` は ESLint の `jsdoc/check-param-names` で、説明の無い `@returns` は `jsdoc/require-returns-description` で検出される。

**ポイント:** `@param` / `@returns` を書くこと自体は義務ではない。**書いたなら正しくあること**だけが義務である。放置されて実装とズレたタグは、無いより悪い。

## 注意点・例外

- **`@param` / `@returns` の網羅は求めていない。** `jsdoc/require-param` / `jsdoc/require-returns` は有効にしていない。型注釈で読める情報を二重に書かせないための意図的な判断である（PRIN-0007）。
- **`settings.jsdoc.mode = "typescript"` を設定している。** TypeScript 構文（ジェネリクス・型パラメータ）を正しく解釈させるため。
- **テスト支援コード（`src/**/__tests__/**`）は JSDoc の対象外だが、300 行の宣言と `server-only` 宣言は免除されない。** 免除の範囲が規則ごとに違う点に注意（[file-size.md](./file-size.md) / [server-client-separation.md](./server-client-separation.md)）。
- **生成物（`src/domain/generated/**`）は対象外。** JSDoc の有無は生成器の責務であり、生成物側で執行しても直せない（ADR-0006）。
- **`legacy/spec-tools/` 側には別の執行者がある。** 方針（全エクスポートに JSDoc、実装の逐次説明コメントは書かない）は共通で、正は [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)。**方針を変える場合は両方の文書を同時に改訂する。**
- **説明の「質」は執行できない。** 機械が見るのは説明文の存在だけである。名前を言い換えただけの説明（`/** 貸出を受け取る */ export function checkOutLoan`）はルールを通る。何を書くかはレビューの対象として残る。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [naming-and-placement.md](./naming-and-placement.md)（同じ「配置と公開シンボルまで」方針のもう一方）
- [file-size.md](./file-size.md)（内側を自由にできる前提＝読み切れる単位に保たれていること）
- [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)（`legacy/spec-tools/` 側の同一方針）
