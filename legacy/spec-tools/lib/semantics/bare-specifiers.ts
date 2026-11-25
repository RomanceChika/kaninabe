/**
 * 製品の実装の木の**素の指定子の許可表**(点検 7 回目 B7-2)。
 *
 * import の閉包(`import-closure.ts`)は相対(`./`)と配置の別名(`@/`)だけを辿り、ほかの素の指定子を「依存のパッケージ」として
 * 閉包に入れない。ところが `package.json` の `imports`(`#comp/*`)・`tsconfig` の `paths` の別名・自分のパッケージ名の自己参照は、
 * 束ねる道具(Node・TypeScript の `bundler` 解決・webpack・Turbopack)が**自分のソースに解く**綴りなので、境界として捨てると
 * 届く先(有料の連携のアダプタ)が閉包から黙って消える。そこで素の指定子を**許可表**で閉じる: 受けるのは
 *
 * | 綴り | 例 |
 * |---|---|
 * | 製品の `package.json` が依存に宣言したパッケージの名前と、その下のパス | `next` / `next/server` / `@kaninabe/runtime/http/paid-entry` |
 * | `node:` の組み込み | `node:crypto` |
 *
 * だけで、それ以外(`#…`・宣言の無いパッケージ名・`node:` の無い組み込み名)は閉包の欠け(fail-closed)にする。配置の別名は閉包の側が先に辿るのでここには来ない。
 * 純粋関数で throw しない(`package.json` の本文は呼び手が読んで渡す)。
 */

/** 依存を宣言する `package.json` の欄(許可表)。 */
export const DEPENDENCY_FIELDS: readonly string[] = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * `package.json` の本文から、依存に宣言したパッケージの名前を集める。
 *
 * @param text `package.json` の本文(読めなければ null)
 * @returns パッケージの名前(本文が無い・JSON として読めない・欄がオブジェクトでなければ空 = どの素の指定子も受けない)
 */
export function dependencyNamesOf(text: string | null): ReadonlySet<string> {
  if (text === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Set();
  }
  if (typeof parsed !== 'object' || parsed === null) return new Set();
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) for (const name of Object.keys(value)) names.add(name);
  }
  return names;
}

/**
 * 素の指定子が許可表の内か(依存のパッケージ名・その下のパス・`node:` の組み込み)。
 *
 * @param specifier import の指定子(相対でも配置の別名でもないもの)
 * @param dependencies 依存に宣言したパッケージの名前
 * @returns 受けるなら true
 */
export function isListedBareSpecifier(specifier: string, dependencies: ReadonlySet<string>): boolean {
  if (/^node:[a-z]/u.test(specifier)) return true;
  for (const name of dependencies) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return true;
  }
  return false;
}
