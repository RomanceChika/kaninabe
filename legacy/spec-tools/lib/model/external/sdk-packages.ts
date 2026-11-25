/**
 * **外部の SDK のパッケージの綴り**(external_spec の `sdk_packages` / `client_ui`、土台の `sdkPackages`、配置の `foundationPackages`)を
 * 読み、import の指定子と突き合わせる純関数(点検 9 回目 B9-4)。
 *
 * 綴りは 2 形だけ —— 包みの名前そのもの(`ai` / `@ai-sdk/anthropic`)と、スコープの全部(`@ai-sdk/*`)。
 * 包みの名前の綴りに当たれば下位パス(`ai/rsc`・`@ai-sdk/anthropic/internal`)も同じ包みとして当たる。
 * `*` 1 つ・`**`・途中の `*` は書けない(何でも許す綴りを作らない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**。
 */

/** 包みの名前 1 区画(npm の規則の小文字の範囲)。 */
const SEGMENT = '[a-z0-9][a-z0-9._-]*';

/** 書いてよい綴り(包みの名前か `@scope/*`)。 */
const PATTERN = new RegExp(`^(?:@${SEGMENT}/(?:\\*|${SEGMENT})|${SEGMENT})$`, 'u');

/** 包みの名前として書いてよい綴り(グロブなし)。 */
const NAME = new RegExp(`^(?:@${SEGMENT}/${SEGMENT}|${SEGMENT})$`, 'u');

/**
 * 綴りが `sdk_packages` に書ける形か。
 *
 * @param text 宣言の綴り
 * @returns 書ける形なら true
 */
export function isPackagePattern(text: string): boolean {
  return PATTERN.test(text);
}

/**
 * 綴りがグロブを含まない包みの名前か(`client_ui` の `packages` が書ける形)。
 *
 * @param text 宣言の綴り
 * @returns 包みの名前なら true
 */
export function isPackageName(text: string): boolean {
  return NAME.test(text);
}

/** import の指定子の分類。 */
export type SpecifierKind =
  /** 相対・製品のソースの根の別名(配置が決める)・仕組みの部品(`@kaninabe/`)・Node のサブパス import(`#`)。外部パッケージではない。 */
  | 'internal'
  /** Node の組み込み(`node:` の接頭辞か、組み込みの名前)。 */
  | 'core'
  /** 外部パッケージ(`name` が包みの名前)。 */
  | 'package';

/** 指定子を分類した結果。 */
export interface ClassifiedSpecifier {
  readonly kind: SpecifierKind;
  /** `package` のときの包みの名前(下位パスを落とした形)。 */
  readonly name: string | null;
}

/**
 * 指定子を分類する。
 *
 * @param specifier import の指定子
 * @param builtins Node の組み込みの名前の集合(`node:module` の `builtinModules`)
 * @param aliases 製品のソースの根の別名の接頭辞(置き場の配置の `source-root` のモジュール指定に `/` を接いだもの。無ければ空)
 * @returns 分類
 */
export function classifySpecifier(specifier: string, builtins: ReadonlySet<string>, aliases: readonly string[] = []): ClassifiedSpecifier {
  const internal = ['.', '/', '@kaninabe/', '#', ...aliases].some((prefix) => specifier.startsWith(prefix));
  if (internal) return { kind: 'internal', name: null };
  if (specifier.startsWith('node:')) return { kind: 'core', name: null };
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '');
  if (builtins.has(name)) return { kind: 'core', name: null };
  return { kind: 'package', name };
}

/**
 * 包みの名前が綴りに当たるか(`@scope/*` はスコープの全部)。
 *
 * @param pattern 宣言の綴り
 * @param name 包みの名前(下位パスを落とした形)
 * @returns 当たれば true
 */
export function packageMatches(pattern: string, name: string): boolean {
  if (pattern.endsWith('/*')) return name.startsWith(pattern.slice(0, -1)) && name.length > pattern.length - 1;
  return pattern === name;
}

/**
 * 包みの名前がどれかの綴りに当たるか。
 *
 * @param patterns 宣言の綴りの並び
 * @param name 包みの名前
 * @returns 当たれば true
 */
export function anyPackageMatches(patterns: readonly string[], name: string): boolean {
  return patterns.some((pattern) => packageMatches(pattern, name));
}
