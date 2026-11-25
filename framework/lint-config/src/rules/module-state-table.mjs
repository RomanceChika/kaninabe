/**
 * **サーバーのモジュールの最上位に置いてよい値の閉じた表**(点検 13 回目 B13-2)。規則の本体は `no-module-state.mjs`。
 *
 * モジュールの変数は Node のプロセスが生きている間ずっと残り、全部の要求で共有される。`Map` に一覧を覚えると、次の利用者に前の利用者の行を返す。
 * 表に載るのは「**要求をまたいで値を増やさない**」と言える初期化の形だけで、載っていない形は全部赤にする。足すときは、その呼び出しが呼び出しの外に状態を残さない
 * 理由を書く。ファイルごとの例外は規則の `allow` の行(`{ file, name, why }`)で、製品の行は製品の設定に、仕組みの行は {@link FRAMEWORK_MODULE_STATE_ROWS} に置く。
 *
 * 表と行は実際の使い手の調査から作った(製品の木・生成物・`@kaninabe/runtime`・アダプタ)。
 */

/** 呼び出しの外に状態を残さない、言語の組み込みの関数(ドットつきの綴り)。 */
export const INERT_BUILTIN_CALLS = new Map([
  ["Object.freeze", "凍結するだけ"],
  ["Object.keys", "新しい配列を返すだけ"],
  ["Object.entries", "新しい配列を返すだけ"],
  ["Object.fromEntries", "新しいオブジェクトを返すだけ"],
  ["Symbol", "値を作るだけ"],
  ["Symbol.for", "登録簿の鍵。値を持たない"],
]);

/** 置いてよい `new`(値を持ち運ばない型だけ。`Map` / `Set` は要素を足せるので、ここに載せず `allow` の行に理由を書く)。 */
export const INERT_CONSTRUCTORS = new Map([
  ["RegExp", "旗に `g` / `y` が無ければパターンを持つだけ。`g` / `y` の `lastIndex` は前の入力で決まる状態で次の要求の判定を変えるので、規則の本体が旗を字句で読んで止める(点検 14 回目 B14-2)"],
]);

/**
 * import した関数のうち、呼んでも外に状態を残さないもの。`chain` はそこから続けて呼んでよいメソッドの閉じた表で、連なりの全部のメソッドが表の中のときだけ通す。
 * 行は 13 回目の見直しで実装を読んで確かめた(呼び出しは値を返すだけで、モジュールの状態に書かない)。読んで確かめられない名前は足さない。
 *
 * `primitiveArguments` に載る名前は、引数を書き換えられない字面に閉じる(`createContext([])` の既定値は全部の要求で共有される。点検 14 回目 B14-6)。
 *
 * @type {ReadonlyMap<string, { why: string, names: readonly string[] | null, chain?: readonly string[], primitiveArguments?: readonly string[] }>}
 */
export const INERT_IMPORTED_CALLS = new Map([
  ["react", { why: "`cache` は描画の要求ごとの入れ物(要求をまたがない)・`createContext` は描画の木の中で閉じる", names: ["cache", "createContext"], primitiveArguments: ["createContext"] }],
  // `z.config`・`z.globalRegistry`・`z.registry`・`.meta`・`.describe`・`.register` は全体の登録簿に書くので表に載せない。
  [
    "zod",
    {
      why: "スキーマを作るだけ(メソッドは新しいスキーマを返す。初回の構築が書く全体の設定は既定の言語と記憶の口の定数で、要求の値を持たない)",
      names: ["z"],
      chain: ["array", "boolean", "datetime", "default", "enum", "extend", "int", "iso", "max", "min", "nullable", "number", "object", "omit", "optional", "partial", "pick", "refine", "regex", "strict", "strictObject", "string", "superRefine", "transform", "trim", "uuid"],
    },
  ],
  [
    "@kaninabe/runtime/text-input",
    {
      why: "文字列のスキーマを作るだけ(制御文字を拒む検証を載せた新しいスキーマを返す。状態を持たず、メソッドは新しいスキーマを返す)。続けてよいメソッドは zod の表の部分集合",
      names: ["textInput"],
      chain: ["max", "min", "nullable", "optional", "regex", "trim"],
    },
  ],
  ["next/font/local", { why: "同梱した書体の宣言。build のときに解決される(外へ取りに行かない)", names: null }],
  ["@kaninabe/runtime/form", { why: "スキーマを包む。値を持たない", names: ["formOf"] }],
  ["@kaninabe/runtime/http/route-guard", { why: "口の関数を包む。状態は要求の中だけ", names: ["guardRoute"] }],
  ["@kaninabe/runtime/preflight", { why: "宣言の表から欄を読むだけ", names: ["writableFields"] }],
  ["@kaninabe/runtime/template", { why: "実行計画を包む関数を返す。状態は呼び出しの中だけ", names: ["runPlanOperation"] }],
  ["@kaninabe/runtime/template/transition", { why: "同上", names: ["transitionOperation"] }],
  ["@kaninabe/runtime/template/update", { why: "同上", names: ["updateOperation"] }],
  ["@kaninabe/runtime/template/update-fields", { why: "同上", names: ["updateFieldsOperation"] }],
]);

/** 同じファイルの関数のうち、呼んでも外に状態を残さないもの(生成物の定数を凍結する同名の関数。`layer/generated-header` の下の生成物が持つ)。 */
export const INERT_LOCAL_FUNCTIONS = new Map([["deepFreeze", "引数を凍結するだけ"]]);

/** 新しい値を返すだけのメソッド(相手も引数も同じ表で見る)。配列と文字列の組み込みと、スキーマの派生。 */
export const INERT_METHODS = new Map(
  ["concat", "filter", "find", "flat", "flatMap", "join", "map", "slice", "array", "extend", "min", "omit", "partial", "pick", "refine", "strict", "superRefine", "transform"].map((name) => [name, "新しい値を返すだけ"]),
);

/** 中身を書き換えるメソッド(`Map` / `Set` / 配列)。モジュールの名前から届く相手に呼ぶと赤。 */
export const MUTATING_METHODS = new Set(["add", "clear", "compile", "copyWithin", "delete", "fill", "pop", "push", "reverse", "set", "shift", "sort", "splice", "unshift"]);

/** 第 1 引数を書き換える組み込み。 */
export const MUTATING_BUILTINS = new Set(["Object.assign", "Object.defineProperties", "Object.defineProperty", "Object.setPrototypeOf", "Reflect.defineProperty", "Reflect.deleteProperty", "Reflect.set", "Reflect.setPrototypeOf"]);

/** 仕組みのパッケージの行(`package` はリポジトリルートからのパッケージの根・`file` はそこからの相対)。 */
export const FRAMEWORK_MODULE_STATE_ROWS = [
  { package: "framework/runtime", file: "src/domain/markdown.ts", name: "toHtml", why: "変換の手順の組み立てだけ。呼び出しごとに本文を渡し、最初の使用で凍結されて本文を持たない" },
  { package: "framework/runtime", file: "src/domain/markdown.ts", name: "toTree", why: "同上(構文解析の手順だけ)" },
  { package: "framework/runtime", file: "src/domain/markdown.ts", name: "PHRASING_PARENTS", why: "節の型の名前の固定の表。初期化の後に書かない" },
  { package: "framework/runtime", file: "src/domain/url.ts", name: "LOOPBACK_HOSTS", why: "固定の表。初期化の後に書かない" },
  { package: "framework/runtime", file: "src/http/request-origin.ts", name: "SAFE_METHODS", why: "固定の表。初期化の後に書かない" },
  { package: "framework/runtime", file: "src/http/request-origin.ts", name: "WEB_SCHEMES", why: "固定の表。初期化の後に書かない" },
  { package: "framework/adapters/postgrest", file: "src/rpc/rpc-outcome.ts", name: "NOT_CONNECTED", why: "接続の失敗のコードの固定の表。初期化の後に書かない" },
];
