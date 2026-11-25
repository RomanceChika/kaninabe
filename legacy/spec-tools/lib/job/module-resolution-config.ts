/**
 * 製品の**指定子の解き方を変える設定**(`package.json` の `imports` / `exports`・`tsconfig` の `paths` / `baseUrl`)を許可表で閉じる
 * (J2 の続き。点検 7 回目 B7-2)。
 *
 * import の閉包(X8・J2 の届く先の判定)は相対と配置の別名(`@/`)だけを辿る。`package.json` の `imports`(`#comp/*`)・`tsconfig` の
 * `paths` の別名・`baseUrl` の素の綴りは、束ねる道具が自分のソースに解くのに閉包からは消えるので、書けば届く先が黙って消える。
 * 閉包の側は許可表の外の素の指定子を欠けとして赤にする(`semantics/bare-specifiers.ts`)が、**設定そのもの**も許可表で拒み、
 * 別名を足した時点で名指す(うっかり足した別名を、使う前に止める)。
 *
 * | ファイル | 受ける形(これ以外は error) |
 * |---|---|
 * | `package.json` | 最上位の欄が `PACKAGE_JSON_ALLOWED_KEYS` の中だけ(`imports` / `exports` / `main` / `browser` などの解き方を変える欄は載せない) |
 * | `tsconfig.json` | `compilerOptions.paths` が配置の別名 1 本(`{ "<別名>*": ["./<ソースの根>/*"] }`)と同じ・`baseUrl` / `rootDirs` / `extends` が無い |
 *
 * 純粋関数で throw しない(本文は呼び手が読んで渡す)。
 */

import ts from 'typescript';

/** 製品の `package.json` の最上位に書いてよい欄(許可表。指定子の解き方を変える欄は載せない)。 */
export const PACKAGE_JSON_ALLOWED_KEYS: readonly string[] = [
  'name',
  'version',
  'private',
  'description',
  'license',
  'type',
  'engines',
  'packageManager',
  'scripts',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
];

/** `tsconfig` の `compilerOptions` のうち、書けば素の指定子を自分のソースに解く欄(書けない)。 */
const TSCONFIG_REFUSED_OPTIONS: readonly string[] = ['baseUrl', 'rootDirs'];

/** オブジェクト(配列でない)か。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `package.json` の最上位の欄が許可表の中だけか。違えば理由(通れば null)。
 *
 * @param text 本文
 */
export function packageJsonResolutionProblem(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'JSON として読めない';
  }
  if (!isRecord(parsed)) return '最上位がオブジェクトでない';
  const outside = Object.keys(parsed).filter((key) => !PACKAGE_JSON_ALLOWED_KEYS.includes(key));
  return outside.length === 0 ? null : `許可表の外の欄 ${outside.join('・')}`;
}

/** `./` を剥がした綴り(`./src/*` と `src/*` を同じに読む)。 */
function withoutDot(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value;
}

/**
 * `tsconfig.json` の別名が配置の別名 1 本だけか。違えば理由(通れば null)。
 *
 * @param file 設定ファイルの名前(診断用)
 * @param text 本文(JSON with comments)
 * @param alias 配置の別名(`prefix` は区切り `/` まで含む。`dir` は製品の根からの相対のソースの根)。null なら別名を持たない(`paths` は書けない)
 */
export function tsconfigPathsProblem(file: string, text: string, alias: { readonly prefix: string; readonly dir: string } | null): string | null {
  const read = ts.parseConfigFileTextToJson(file, text);
  if (read.error !== undefined || !isRecord(read.config)) return '構文として読めない';
  const config = read.config;
  if ('extends' in config) return '`extends` で別の設定を継いでいる(別名を静的に読めない)';
  const options = config['compilerOptions'];
  if (options === undefined) return null;
  if (!isRecord(options)) return '`compilerOptions` がオブジェクトでない';
  const refused = TSCONFIG_REFUSED_OPTIONS.filter((key) => key in options);
  if (refused.length > 0) return `素の指定子を自分のソースに解く欄 ${refused.join('・')} がある`;
  const paths = options['paths'];
  if (paths === undefined) return null;
  const expected = alias === null ? {} : { [`${alias.prefix}*`]: [`${withoutDot(alias.dir)}/*`] };
  if (!isRecord(paths)) return '`paths` がオブジェクトでない';
  const normalized = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? withoutDot(item) : item)) : value]));
  return JSON.stringify(normalized) === JSON.stringify(expected) ? null : `\`paths\` が配置の別名 ${JSON.stringify(expected)} と違う(${JSON.stringify(paths)})`;
}
