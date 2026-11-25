/**
 * `check-dist-fresh.mjs` の型(本体は依存なしの素の JavaScript。型はテストと globalSetup が読むためだけにある)。
 */

/** `build:framework` が作るパッケージ(リポジトリの根から)。 */
export const FRAMEWORK_PACKAGES: readonly string[];

/** `@kaninabe/runtime` を解く入口(リポジトリの根から)。 */
export const CONSUMERS: readonly string[];

/** 前置きを通る入口の表(パッケージ → script の名前。点検 21 回目 C の O21-4)。 */
export const FRESHNESS_ENTRIES: Readonly<Record<string, readonly string[]>>;

/** 照らしが最後の段に来る入口(パッケージ → script の名前。関所の後で照らす build:gate。点検 22 回目 O22-1)。 */
export const FRESHNESS_AT_END: Readonly<Record<string, readonly string[]>>;

/**
 * 入口の表と package.json の script の食い違い(両方向と、照らしの段の位置)。
 *
 * @param scriptsOf - パッケージ → その package.json の scripts
 * @param entries - 入口の表
 * @param atEnd - 照らしが最後の段に来る入口
 * @returns 食い違い(無ければ空)
 */
export function entryProblems(
  scriptsOf: Readonly<Record<string, Readonly<Record<string, string>>>>,
  entries?: Readonly<Record<string, readonly string[]>>,
  atEnd?: Readonly<Record<string, readonly string[]>>,
): string[];

/**
 * script の本文から照らしの段を外した残り(点検 22 回目 O22-1)。
 *
 * @param command - script の本文
 * @returns 照らしの段を外した本文
 */
export function withoutFreshness(command: string): string;

/** 印のファイル名(各パッケージの `dist` の下)。 */
export const HASH_FILE: string;

/** このファイルから見たリポジトリの根。 */
export const REPO_ROOT: string;

/**
 * ソースのうち配布物に入るもの。
 *
 * @param file - パッケージからの相対パス
 * @returns 入るなら true
 */
export function isBuiltSource(file: string): boolean;

/**
 * パッケージのソースの hash。
 *
 * @param packageDir - パッケージの場所
 * @returns sha256 の 16 進
 */
export function sourceHash(packageDir: string): string;

/**
 * パッケージの dist の中身の hash(印のファイルを除く)。
 *
 * @param packageDir - パッケージの場所
 * @returns sha256 の 16 進(dist が無ければ空文字)
 */
export function distHash(packageDir: string): string;

/**
 * 印の本文(ソースの hash と dist の hash)。
 *
 * @param packageDir - パッケージの場所
 * @returns 本文
 */
export function markText(packageDir: string): string;

/**
 * パッケージの印を消す(パッケージの build の始め)。
 *
 * @param root - リポジトリの根
 * @param cwd - 作業ディレクトリ(パッケージ)
 * @returns 消したパッケージ(表に無い場所なら null)
 */
export function invalidateMark(root: string, cwd: string): string | null;

/**
 * 古い・無い配布物のパッケージ。
 *
 * @param root - リポジトリの根
 * @param packages - 見るパッケージ
 * @returns 古いパッケージ
 */
export function stalePackages(root: string, packages?: readonly string[]): string[];

/**
 * 各パッケージの印を書く。
 *
 * @param root - リポジトリの根
 * @param packages - 書くパッケージ
 */
export function writeMarks(root: string, packages?: readonly string[]): void;

/**
 * 入口から親へ辿って最初に見つかる `node_modules/@kaninabe/runtime`。
 *
 * @param from - 入口の場所
 * @returns 見つかった場所(無ければ null)
 */
export function nearestRuntime(from: string): string | null;

/**
 * `@kaninabe/runtime` の実体がリポジトリの根の中か。
 *
 * @param root - リポジトリの根
 * @param consumers - 解く入口
 * @returns 止める 1 行(問題が無ければ null)
 */
export function locationProblem(root: string, consumers?: readonly string[]): string | null;

/**
 * 照らした結果。
 *
 * @param root - リポジトリの根
 * @returns 終了コードと 1 行
 */
export function verdict(root: string): { readonly code: 0 | 1 | 2; readonly line: string | null };
