// legacy/spec-tools(検証器・生成器・CLI)のリンター設定。
//
// 規約の正は docs/rules/process/common/tooling/standards/scripts-code-quality.md であり、
// この設定はその執行者である。機械執行するのは 5 つ ——
//   - 「300 行を超えるファイルは冒頭に宣言(@oversize / @split-review)を持つ」(責務の肥大化。
//     300 行は信号であり上限ではない。**正は `@kaninabe/lint-config` の `layer/declared-oversize`**)
//   - 「生成器は throw しない」(前提は検査器へ。仕様の問題をスタックトレースで出さない)
//   - 「ソースに生の制御文字を埋めない」(git がバイナリ扱いにして diff が読めなくなる)。
//     **正は `@kaninabe/lint-config` の `layer/no-raw-control-char` 1 本**で、app / framework と
//     同じ規則を読む(母集合は 3 つの木すべて。束 ①-c-e)
//   - **「使われていない宣言を残さない」**(未使用の import / 変数 / 引数)。300 行で割った跡に
//     死んだ import が残っていたのを**どの検査も見ていなかった**(束 ①-c-c のレビュー。
//     `noUnusedLocals` も無く、`--print-config` で `no-unused-vars` 系が undefined だった)
//   - **「matcher の無い `expect(...)` を式文に書かない」**(テスト全体。A16 は注釈付きのテストの
//     assert を matcher で終わる連鎖で数える。ここは注釈の無いテストにも掛ける。網の穴探し 2026-10-06 M31)
// 型認識ルールや設計規約の執行は app/ 側と同じ構成を持ち込む必要があるため、必要になった
// 時点で足す。
//
// 使い方: ルートで `npm run lint:spec-tools`(この木の中なら `npm run lint`)

import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
// **生の制御文字の禁止は仕組み側の 1 本を共有する**（`@kaninabe/lint-config` の自作規則）。
// この木はワークスペースに入れない（ADR-0013。検査器のツールチェーンを製品のビルドに
// 混ぜない）ので、パッケージ名では規則の実装まで掘れない（`exports` に出していない）—— だから
// ファイルを相対パスで読む。
// 綴りが増えるのを避けて `src/rules/` の 1 本だけを指す（規則の実装がここの正である）。
import { noRawControlChar } from '../../framework/lint-config/src/rules/no-raw-control-char.mjs';
import { declaredOversize } from '../../framework/lint-config/src/rules/declared-oversize.mjs';
// matcher の無い `expect(...)` の禁止(A16 の ESLint 側の対)も、仕組み側の 1 組を読む(同じ理由で相対パス)。
import { DISABLED_TEST_SELECTORS, EXPECT_MATCHER_SELECTORS } from '../../framework/lint-config/src/policies-syntax.mjs';

export default [
  {
    files: ['lib/**/*.ts', 'cli/**/*.ts', '__tests__/**/*.ts'],
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      layer: { rules: { 'no-raw-control-char': noRawControlChar, 'declared-oversize': declaredOversize } },
    },
    rules: {
      // 300 行は信号。超えるファイルは冒頭の JSDoc に @oversize と @split-review を持つ
      // (宣言の無い超過・行数を理由にした宣言・300 行以下に残った宣言は error)。
      // テスト・生成コードは対象外(規約の但し書き)。
      'layer/declared-oversize': ['error', { max: 300 }],
      // **使われていない宣言を残さない**(TypeScript 版。型だけの import も見る)。
      // 意図して使わないものは `_` で始める —— 名前に書いてあるので、免除リストも
      // `eslint-disable` も要らない(既にこの木の作法である: 差し替え口の `_a` / `_env` 等)。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // **生の制御文字を埋めない。** 正は `@kaninabe/lint-config` の `layer/no-raw-control-char`
      // 1 本である(上の import の理由つき)。`no-restricted-syntax` に相乗りさせていた形は
      // **後ろのブロックの再定義で丸ごと消えていた** —— `lib/generate/**` と `lib/diff/**` が
      // 同じ規則名を再定義しており、その穴の中に生きた違反(`lib/diff/facts.ts` の NUL)が
      // 住んでいた(束 ①-c-d の独立レビューが `--print-config` で実測)。名前が別なら消えない。
      'layer/no-raw-control-char': 'error',
    },
  },
  {
    // **生成器は throw しない。** 決められない入力は検査器が Finding(場所・対処・反例)で
    // 止め、生成器は「検査を通った入力しか来ない」前提で書く。前提が破れたときの最後の砦は
    // `lib/kernel/generator-precondition.ts` の `preconditionFailure()` だけであり、そこは
    // 「どの検査器が先に見るはずだったか」を報告するので、直し方(検査の穴を埋める)が読める。
    // **差分器(`lib/diff/**`)も同じ規律**である —— 生成物が読めないことは仕様の問題では
    // なく判定できない事実であり、スタックトレースではなく「どちらの版のどのファイルが
    // 読めなかったか」の 1 行で報告する(`DiffProblem`)。
    files: ['lib/generate/**/*.ts', 'lib/diff/**/*.ts'],
    // 「書き方の例」の章だけは入力が仕様モデルではなく**リポジトリの実ファイル**であり、
    // 失敗は仕様の問題ではなく鮮度エラーである(code-examples.md。同じ理由で
    // 「生成器はファイル読み込みをしない」の例外にもなっている)。
    // 本の HTML の出力の口(`html/markup.ts`)も外す。止めるのは仕様の前提ではなく**生成器のコードの不具合**
    // (型をすり抜けた属性・許可表の外の URL・子を持てない要素への子)で、見るべき検査器が無い。
    // 黙って書き出すより止めるのがこの口の役目である(安全な出力の最後の砦)。
    ignores: ['lib/generate/render/code-examples.ts', 'lib/generate/render/book/examples-page-render.ts', 'lib/generate/render/book/html/markup.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ThrowStatement',
          message:
            '生成器は throw しない(scripts-code-quality.md)。前提は検査器へ移し、破れたときは lib/kernel/generator-precondition.ts の preconditionFailure() で「その前提を見るべき検査器」の ID を示して止める',
        },
      ],
    },
  },
  {
    // テストコードは規約の 300 行の宣言の対象外(「テスト・生成コードを除く」)。
    files: ['__tests__/**/*.ts'],
    rules: {
      'layer/declared-oversize': 'off',
      // **matcher の無い `expect(...)` は何も確かめない**(`expect(x);`)。A16 は注釈付きのテストしか見ない
      // ので、注釈の有無に依らずテスト全体に掛ける(網の穴探し 2026-10-06 の M31)。`lib/generate/**` の
      // throw 禁止のブロックとは `files` が重ならない(後勝ちの上書きは起きない)。
      'no-restricted-syntax': ['error', ...EXPECT_MATCHER_SELECTORS, ...DISABLED_TEST_SELECTORS],
    },
  },
];
