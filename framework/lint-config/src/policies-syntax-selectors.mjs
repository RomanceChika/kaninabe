/**
 * 禁止する構文パターンのうち、**名前に `RESTRICTED_SYNTAX` を含まない 2 組**
 * (環境変数の読み方 `PROCESS_ENV_SELECTORS` と、matcher の無い `expect(...)` の禁止
 * `EXPECT_MATCHER_SELECTORS`)の置き場。
 *
 * 入口は `policies-syntax.mjs`(`RESTRICTED_SYNTAX` がここの 2 組を末尾に連ねる)と `policies.mjs` で、
 * 利用側は今までどおりそこから import する。ファイルを分けたのは 300 行の信号に当たったためで、
 * 境界は「`RESTRICTED_SYNTAX` の閉世界の外にある 2 組」という意味で引いた。
 */

/**
 * 環境変数の読み方の閉世界(K1 が読める形だけを書かせる)。
 *
 * **なぜ要るのか。** 設定の閉世界(K1・K2)は `config/env-scan.ts` が**字面で**拾う —— 拾えるのは
 * `process.env.<名前>` / `process.env['<名前>']` / `requireEnv('<名前>')` の 3 つだけで、名前が
 * 文字列リテラルとしてその場にある形に限る。分割代入(`const { X } = process.env;`)・別名・
 * 計算した鍵・`process.env` そのものを渡す形は**カタログにも `.env.example` にも無い設定を読んでいても
 * K1・K2 とも緑**になる(網の穴探し 2026-10-06 の M02。K1 の注釈は「拾えない書き方をしないことは
 * 規約が要求する」と書いていたが、執行者が居なかった)。ここが**その執行者**である。
 *
 * **この注記と文言の中の例は `<名前>` と書く** —— K1 の走査は仕組み側の `@kaninabe/lint-config` も読むので、
 * ここに `process.env.` の直後へ大文字の名前を書くと、**この文書自身が読まれた設定として数えられる**。
 *
 * 母集合は K1 の走査の木と揃える(製品の `src` / `e2e` / `scripts` と、仕組み側の `@kaninabe/runtime` /
 * `@kaninabe/lint-config`)。名前に `RESTRICTED_SYNTAX` を含めないのは、`no-restricted-syntax-policies.test.ts` が
 * その名前の export を「1 つずつ違反フィクスチャを持つポリシー」として閉世界で数えるからである
 * (この配列の各セレクタの実効性は `env-and-matcher-syntax.test.ts` が見る)。
 *
 * **`requireEnv(name)` の定義の内側だけは計算した鍵を許す。** あの関数は `requireEnv('<名前>')` という
 * 呼び出しの形で K1 に読まれる入口であり、定義の中の `process.env[name]` は読み手に名前が見える形の
 * 一部である(免除ではなく、K1 の 3 つ目の拾い方の実装そのもの)。その呼び出しの引数がリテラルでないものは
 * 最後のセレクタが止める。
 */
export const PROCESS_ENV_SELECTORS = [
  {
    selector:
      ":matches(VariableDeclarator[init.object.name='process'][init.property.name='env'], AssignmentExpression[right.object.name='process'][right.property.name='env'])",
    message:
      "process.env を分割代入・別名にしない(`const { X } = process.env;` / `const env = process.env;`)。設定の閉世界(K1)は " +
      "`process.env.<名前>` / `process.env['<名前>']` / `requireEnv('<名前>')` という名前がその場にある形だけを拾うので、" +
      "この形で読んだ設定はカタログにも .env.example にも無いまま緑になる。`process.env.<名前>` と直に書く。",
  },
  {
    selector:
      "MemberExpression[computed=true][object.object.name='process'][object.property.name='env'][property.type!='Literal']:not(:matches(FunctionDeclaration[id.name='requireEnv'], VariableDeclarator[id.name='requireEnv']) MemberExpression)",
    message:
      "process.env[式] で名前を計算して読まない。K1 は名前が文字列リテラルとしてその場にある形(`process.env['<名前>']`)しか拾えない。" +
      "名前を引数に取る読み口が要るなら `requireEnv('<名前>')` の定義の内側に置き、呼ぶときにリテラルで渡す。",
  },
  {
    selector:
      "MemberExpression[object.name='process'][property.name='env']:not([parent.type=/^(MemberExpression|VariableDeclarator|AssignmentExpression)$/])",
    message:
      "process.env そのものを値として渡さない(引数・スプレッド・戻り値・比較など)。受け取った先で何の名前が読まれるか、" +
      "K1 から見えなくなる。必要な設定を `process.env.<名前>` と名指しで読んで渡す。",
  },
  {
    selector: "CallExpression[callee.name='requireEnv']:not([arguments.0.type='Literal'])",
    message:
      "requireEnv の引数は文字列リテラルで渡す(`requireEnv('<名前>')`)。変数・テンプレートで渡すと K1 が設定の名前を拾えない。",
  },
  // ここから下は `process` の側から `process.env` の字面を消す形(分割代入・別名・添字・別の入口)。
  // 上の 4 本は `process.env` の字面がある形を見るので、字面を作らない書き方はここで止める。
  {
    selector:
      ":matches(VariableDeclarator, AssignmentExpression, AssignmentPattern)" +
      ":matches([init.name='process'], [right.name='process'], [init.expression.name='process'], [right.expression.name='process'])," +
      "CallExpression > Identifier.arguments[name='process'], NewExpression > Identifier.arguments[name='process']," +
      "Property > Identifier.value[name='process'], ArrayExpression > Identifier.elements[name='process']," +
      "SpreadElement > Identifier.argument[name='process'], ReturnStatement > Identifier.argument[name='process']",
    message:
      "process そのものを別名・分割代入・引数・戻り値にしない(`const { env } = process;` / `const p = process;` / `use(process)`)。" +
      "`process.env` の字面が消えるので、K1 が読まれた設定の名前を拾えなくなる。`process.env.<名前>` と直に書く。",
  },
  {
    selector: "MemberExpression[object.name='process'][computed=true]",
    message:
      "process に添字でアクセスしない(`process['env']`)。K1 は `process.env` の字面だけを読むので、" +
      "この書き方では環境変数の名前が拾えない。`process.env.<名前>` と直に書く。",
  },
  {
    selector:
      "MemberExpression:matches([property.name='process'], [property.value='process'])[object.name=/^(globalThis|global|window|self)$/]",
    message:
      "globalThis / global 経由で process を読まない(`globalThis.process.env.<名前>`)。K1 は素の `process.env` の字面だけを読む。" +
      "`process.env.<名前>` と直に書く。",
  },
  {
    selector:
      ":matches(ImportDeclaration[source.value=/^(node:)?process$/], CallExpression[callee.name='require'][arguments.0.value=/^(node:)?process$/], ImportExpression[source.value=/^(node:)?process$/])",
    message:
      "process を import しない(`import { env } from 'node:process'`)。K1 は素の `process.env.<名前>` の字面だけを読むので、" +
      "import した名前の読み取りは拾えない。グローバルの `process.env.<名前>` と直に書く。",
  },
  {
    selector:
      ":matches(MemberExpression:matches([property.name='env'], [property.value='env']):matches([object.type='MetaProperty'], [object.expression.type='MetaProperty'])," +
      "VariableDeclarator[init.type='MetaProperty'], AssignmentExpression[right.type='MetaProperty'], CallExpression > MetaProperty.arguments)",
    message:
      "import.meta.env を使わない(この製品の環境変数は `process.env.<名前>` だけ。K1 は import.meta を読まない)。" +
      "`import.meta` を変数に束ねる・引数に渡す形も同じ理由で書かない。",
  },
];

/**
 * 「matcher の無い `expect(...)`」の式文の禁止(A16 の ESLint 側の対)。
 *
 * `expect(x);` は何も主張しない —— matcher(`.toBe(...)` 等)を呼んで初めて検査になる。A16 は
 * 注釈付きのテストの assert を「matcher で終わる連鎖」で数える(`matcher-asserts.ts`)が、注釈の無い
 * テストには掛からない。ここは**注釈の有無に依らずテスト全体**に掛かる(`@vitest/eslint-plugin` の
 * `valid-expect` の相当を、新しい依存を足さずに書いたもの。網の穴探し 2026-10-06 の M31)。
 *
 * 見るのは式文として単独で書かれた形(`expect(x);` / `await expect(x);` / `expect(x).not;` /
 * `expect(x).resolves;` 等。連鎖は 3 段まで)。変数に代入する・戻り値にする形は対象外である。
 */
export const EXPECT_MATCHER_SELECTORS = [
  {
    selector:
      "ExpressionStatement > :matches(CallExpression[callee.name='expect'], MemberExpression[object.callee.name='expect'], MemberExpression[object.object.callee.name='expect'], MemberExpression[object.object.object.callee.name='expect'])",
    message:
      "matcher を呼ばない expect(...) は何も確かめていない。`.toBe(...)` などの matcher を呼ぶ(`expect(x).not;` のように修飾で止めない)。",
  },
  {
    selector:
      "ExpressionStatement > AwaitExpression > :matches(CallExpression[callee.name='expect'], MemberExpression[object.callee.name='expect'], MemberExpression[object.object.callee.name='expect'], MemberExpression[object.object.object.callee.name='expect'])",
    message:
      "matcher を呼ばない expect(...) は何も確かめていない。`.toBe(...)` などの matcher を呼ぶ(`await expect(x);` のように await だけで止めない)。",
  },
];

/**
 * テストを止める綴りの禁止(点検 12 回目 C12-1)。
 *
 * `it.skip` / `describe.only` / `it.todo` / `it.fails` と、定数を渡した `skipIf` / `runIf` は、CI の手順を 1 字も変えずに検査を消す。
 * 動かせないテストは直すか消す。環境で分ける `skipIf` は条件を gates の `test-scope.test.ts` の閉じた表に載せる。
 * 同じ切り口の `ctx.skip()` と `it['skip']` も止める(13 回目 C13-2)。別名・早い `return` は gates の構文木の表が見る。
 */
export const DISABLED_TEST_SELECTORS = [
  {
    selector:
      "MemberExpression[property.name=/^(skip|only|todo|fails)$/]:matches([object.name=/^(it|test|describe|suite|bench)$/], [object.object.name=/^(it|test|describe|suite|bench)$/], [object.object.object.name=/^(it|test|describe|suite|bench)$/])",
    message: "テストを止めない。動かないテストは直すか消す(it.skip / it.only / it.todo / it.fails は CI の手順を変えずに検査を消す)。",
  },
  {
    selector:
      "CallExpression:matches([callee.name=/^(it|test|describe|suite|bench)$/], [callee.object.name=/^(it|test|describe|suite|bench)$/]) > ObjectExpression.arguments > Property:matches([key.name=/^(skip|only|todo|fails|retry|repeats)$/], [key.value=/^(skip|only|todo|fails|retry|repeats)$/])",
    message: "テストの第 2 引数の設定で止めない・やり直さない(置けるのは { timeout } だけ。14 回目 C14-2)。",
  },
  {
    selector: "CallExpression[callee.object.name='vi'][callee.property.name='setConfig'] > ObjectExpression > Property:not([key.name=/^(testTimeout|hookTimeout)$/])",
    message: "vi.setConfig は時間の設定だけ(retry などで検査を緩めない。14 回目 C14-2)。",
  },
  {
    selector: "CallExpression[callee.property.name=/^(skipIf|runIf)$/] > Literal.arguments",
    message: "skipIf / runIf に定数を渡さない(テストを止める綴りになる)。",
  },
  {
    selector: "CallExpression[callee.property.name='skip']",
    message: "実行の途中でテストを止めない(ctx.skip() は CI の手順を変えずに検査を消す)。環境で分けるなら skipIf の閉じた表に載せる。",
  },
  {
    selector: "MemberExpression[computed=true][property.value=/^(skip|only|todo|fails|skipIf|runIf)$/]",
    message: "テストを止める綴りを鍵の文字列で書かない。",
  },
];
