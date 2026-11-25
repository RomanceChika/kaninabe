/**
 * **実装の木が枠(Next.js・React)から使ってよいものの閉じた表**(点検 12 回目 B12-1・B12-2)。規則の本体は `closed-framework-surface.mjs`。
 *
 * 点検のたびに、閉じた機能の隣の機能が見つかった(`next/script`・`unstable_cache`・`'use cache'` …)。禁止の 1 行を足し続けるのをやめ、
 * **表に載っていないものは全部赤**にする。行には理由を持たせ、理由を言えない口は載せない。足すときは「その口が要求をまたいで値を持たないか」
 * 「利用者の値をスクリプトや行き先にしないか」を理由の欄に書く。
 *
 * 表は実際の使い手の調査から作った(製品の木・生成物・`@kaninabe/runtime`)。`next/*` は**使い手のあるものだけ**を載せる。`react` だけは、部品の中で閉じる
 * 安定した口(状態と描画の順序だけを扱い、サーバーに値を持たず HTML も足さない)を、使い手が無くても載せる。
 *
 * テストと支援コードは表の外である(配信されないので、`next/dist/…` のテスト用の文脈や `react-dom/server` を使う)。範囲は設定が決める。
 */

/** 型の import だけを許す行の理由(消えるので実行時の口にならない)。 */
const TYPES_ONLY = '型だけ。実行時に残らない';

/** 部品の中で閉じる React の口の理由。 */
const COMPONENT_LOCAL = '部品の中の状態と描画の順序だけを扱う。サーバーに値を持たず、HTML もスクリプトも足さない';

/**
 * 枠のモジュールの表。`names` は値として引いてよい名前と理由で、型の import はこの表のモジュールからなら名前を問わない。
 * `anyName` はモジュールの全部の名前を許す行で、理由はモジュールの `why` が持つ。
 *
 * @type {ReadonlyMap<string, { why: string, anyName?: boolean, names: Readonly<Record<string, string>> }>}
 */
export const FRAMEWORK_ENTRIES = new Map([
  ['next', { why: TYPES_ONLY, names: {} }],
  ['next/headers', {
    why: '要求の文脈(要求ごとに値が変わる)',
    names: {
      cookies: 'セッションの接続の唯一の材料(置き場は認証の接続層。`FRAMEWORK_NAME_HOMES` が閉じる)',
      headers: 'ログの要求 ID と、前段で更新の予算が尽きた印の材料(読むだけ。`FRAMEWORK_NAME_HOMES` が配線の 2 ファイルに閉じる)',
    },
  }],
  ['next/navigation', {
    why: '描画の分岐と現在の場所',
    names: {
      notFound: '本文なしの 404 に落とす(行き先を持たない)',
      usePathname: '現在のパスを読むだけ',
      redirect: '`layer/require-safe-redirect` が安全な転送の部品の実装だけに閉じる',
      permanentRedirect: '`layer/require-safe-redirect` が安全な転送の部品の実装だけに閉じる',
      useRouter: '`layer/require-safe-redirect` が安全な遷移の部品の実装だけに閉じる',
    },
  }],
  ['next/server', {
    why: '要求の前段と Route Handler の補助',
    names: {
      NextResponse: '要求の前段の `next()` の応答(`.redirect`・`.rewrite` と表の外のメンバーは `layer/require-safe-redirect` が止める)',
      after: '応答の後にログを書き出す(値を返さない)',
      connection: '要求ごとの描画を宣言する(nonce の前提。値を持たない)',
    },
  }],
  ['next/link', {
    why: '自サイトの遷移の部品',
    names: { default: '行き先は `layer/require-safe-link` が閉じる' },
  }],
  ['next/font/local', {
    why: '同梱した書体(製品の木の中のファイル)を自分のオリジンから配る。`next/font/google` は build のときに外へ取りに行くので表に置かない(ビルドは手元だけで閉じる。2026-11-05)',
    names: { default: '書体のファイルの宣言(src は製品の木の中の相対パス)' },
  }],
  ['react', {
    why: '画面の部品の土台',
    names: {
      cache: '**要求の中だけ**の memo。実体は描画の要求ごとの入れ物(`getCacheForType`)で、要求をまたがない',
      createContext: '描画の木の中で閉じる',
      createElement: '要素の名前は `layer/no-dom-assembly`、送り先は `layer/require-safe-link` が見る',
      cloneElement: '送り先は `layer/require-safe-link` が見る',
      Children: COMPONENT_LOCAL,
      Fragment: COMPONENT_LOCAL,
      Suspense: COMPONENT_LOCAL,
      forwardRef: COMPONENT_LOCAL,
      isValidElement: COMPONENT_LOCAL,
      memo: COMPONENT_LOCAL,
      startTransition: COMPONENT_LOCAL,
      useActionState: '部品の中の状態だけを扱う(第 3 引数の permalink は `<form action>` になるので `layer/closed-framework-surface` が止める)',
      useCallback: COMPONENT_LOCAL,
      useContext: COMPONENT_LOCAL,
      useDeferredValue: COMPONENT_LOCAL,
      useEffect: COMPONENT_LOCAL,
      useId: COMPONENT_LOCAL,
      useImperativeHandle: COMPONENT_LOCAL,
      useLayoutEffect: COMPONENT_LOCAL,
      useMemo: COMPONENT_LOCAL,
      useOptimistic: COMPONENT_LOCAL,
      useReducer: COMPONENT_LOCAL,
      useRef: COMPONENT_LOCAL,
      useState: COMPONENT_LOCAL,
      useSyncExternalStore: COMPONENT_LOCAL,
      useTransition: COMPONENT_LOCAL,
    },
  }],
  ['react-dom', {
    why: 'フォームの状態と重ね置き(`preinit` などの資材の読み込みの口は載せない)',
    names: {
      createPortal: COMPONENT_LOCAL,
      useFormStatus: COMPONENT_LOCAL,
    },
  }],
]);

/**
 * 表の名前のうち、**置き場を閉じる行**(点検 13 回目 B13-5)。`cookies` を画面に置くと属性を自由に組めて、`headers` は `origin` / `host` で絶対 URL を組める。
 *
 * @type {ReadonlyMap<string, Readonly<Record<string, RegExp>>>}
 */
export const FRAMEWORK_NAME_HOMES = new Map([
  ['next/headers', { cookies: /(?:^|[\\/])src[\\/]infrastructure[\\/]/u, headers: /(?:^|[\\/])src[\\/](?:composition[\\/]logging|infrastructure[\\/]supabase[\\/]session)\.ts$/u }],
]);

/** 実装の木に置いてよい指令の閉じた表(`'use cache'` の仲間は載せない)。 */
export const FRAMEWORK_DIRECTIVES = new Map([
  ['use client', 'クライアントの部品の境界'],
  ['use server', 'Server Action の口。置き場は `layer/use-server-placement` が閉じる'],
]);

/** ファイルの規約の export のうち、値を 1 つに閉じる行(`dynamic` の `'force-static'` は要求の文脈を消す)。 */
const FORCE_DYNAMIC = Object.freeze(['force-dynamic']);

/** Route Handler のメソッド。形は J2 が閉じる。 */
const ROUTE_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/**
 * Next.js のファイルの規約の、export してよい名前の閉じた表(`revalidate`・`fetchCache`・`generateStaticParams` などは載せない)。
 * 値が `null` の名前は値を問わない。配列は字句の値の閉じた表である。
 *
 * @type {ReadonlyMap<string, Readonly<Record<string, readonly string[] | null>>>}
 */
export const SEGMENT_EXPORTS = new Map([
  ['page', { default: null, generateMetadata: null, metadata: null, dynamic: FORCE_DYNAMIC }],
  ['layout', { default: null, generateMetadata: null, metadata: null, dynamic: FORCE_DYNAMIC }],
  ['route', { dynamic: FORCE_DYNAMIC, ...Object.fromEntries(ROUTE_METHODS.map((method) => [method, null])) }],
  ...['template', 'default', 'loading', 'error', 'global-error', 'not-found'].map((name) => [name, { default: null }]),
]);

/** 表が相手にする枠のモジュール(`next-…` のような別のパッケージは含まない。ほかのパッケージは層の境界の許可表が閉じる)。 */
const FRAMEWORK_MODULE = /^(?:next|react|react-dom|@next\/[^/]+)(?:\/|$)/u;

/**
 * 指定子が枠のモジュールか。
 *
 * @param {string} module - 正規化した指定子
 * @returns {boolean} 枠のモジュールなら true
 */
export function isFrameworkModule(module) {
  return FRAMEWORK_MODULE.test(module);
}

/**
 * 表の行が値の名前を許すか。
 *
 * @param {{ anyName?: boolean, names: Readonly<Record<string, string>> }} row - 表の行
 * @param {string} name - 引く名前(既定の export は `default`)
 * @returns {boolean} 許すなら true
 */
export function entryAllows(row, name) {
  return row.anyName === true || Object.hasOwn(row.names, name);
}
