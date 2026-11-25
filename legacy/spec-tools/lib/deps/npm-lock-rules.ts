/**
 * lockfile の**npm と同じ規則**の部品(deps:check と配布の道具の dist:check が同じものを使う。6 回目 C6-1・C6-7)。
 *
 * **import を持たない**(配布の形の道具(dist:check)は依存を持たず `node` で直に読むので、ここから先を辿らせない)。
 *
 * 1. **正しい同梱**(`npm ci` が登録簿から取らず、親の tarball から出すもの)の判定。npm(`@npmcli/arborist`)は同梱かどうかを lockfile の
 *    `inBundle` の自己申告ではなく**木の形**で決める(`Node.getBundler`・`load-virtual.js` の `#assignBundles`)。ここはその写しである:
 *    - 親(キーの最後の `/node_modules/` の手前)が同梱されていれば、子も同じ同梱元に同梱される
 *    - 親の `bundleDependencies` が**配列で**その名前(キーの名前)を含めば、親が同梱元(`true` は数えない — npm は配列しか見ない)
 *    - lockfile の `inBundle: true` で、親が `inBundle` でなく、親がその名前に依存していれば、npm は読み込みで親の表に名前を足す(`#assignBundles`)
 *    - 同じ親の下の**同梱された**部品が、その名前に依存して(解決の結果がこのエントリで)いれば、親が同梱元(`edgesIn` の判定)
 *    - 同梱元が根(`''`)なら同梱ではない(npm は根の `bundleDependencies` の部品も取る — `inDepBundle`)
 *    検査が「取得元を持たない」と許すのは、この判定で同梱で、`inBundle: true`・`resolved` も `integrity` も持たず・版が 1 点の版のものだけ。
 * 2. **許さない lockfile の名前**。照合は大文字小文字を区別しない(大文字小文字を区別しないファイルシステムでは、npm が
 *    `npm-shrinkwrap.json` を開くと `NPM-Shrinkwrap.json` が開く)。
 */

/** lockfile の `packages` の 1 エントリ(読む欄だけ。値は信頼しない)。 */
export interface NpmLockEntry {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly resolved?: unknown;
  readonly integrity?: unknown;
  readonly inBundle?: unknown;
  readonly bundleDependencies?: unknown;
  readonly dependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

/** lockfile の `packages`(キー → エントリ。エントリは何でもありうる)。 */
export type NpmLockPackages = Readonly<Record<string, unknown>>;

/**
 * 依存を張る欄(根でも workspace でもないエントリの `edgesOut`。`devDependencies` は根と workspace にしか張られない)。
 */
const EDGE_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** 1 点の版(semver 2.0 の完全な版。範囲・タグ・`x` は外れる)。 */
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 区切り(親のキーとの境目)。 */
const NESTED = '/node_modules/';

/** 根の直下のキーの接頭辞。 */
const TOP = 'node_modules/';

function entryAt(packages: NpmLockPackages, key: string): NpmLockEntry | undefined {
  const value = Object.prototype.hasOwnProperty.call(packages, key) ? packages[key] : undefined;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as NpmLockEntry) : undefined;
}

/** `node_modules/a/node_modules/@s/b` → `@s/b`(npm の `node.name` = 置き場の名前)。 */
export function lockKeyName(key: string): string {
  const at = key.lastIndexOf(TOP);
  return at === -1 ? key : key.slice(at + TOP.length);
}

/**
 * 親のキー(`node_modules/a/node_modules/b` → `node_modules/a`、`node_modules/a` → 根の `''`、`w/node_modules/x` → `w`)。
 * `node_modules/` の下でないキー(根・workspace の置き場)は親を持たない(null)。
 */
export function lockParentKey(key: string): string | null {
  const at = key.lastIndexOf(NESTED);
  if (at > 0) return key.slice(0, at);
  return key.startsWith(TOP) ? '' : null;
}

/** エントリが依存を張る名前(`dependencies` / `optionalDependencies` / `peerDependencies` のキー)。 */
function edgeNames(entry: NpmLockEntry | undefined): ReadonlySet<string> {
  const names = new Set<string>();
  for (const field of EDGE_FIELDS) {
    const value = entry?.[field];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) for (const name of Object.keys(value)) names.add(name);
  }
  return names;
}

/** `from` から名前 `name` を解決したエントリのキー(`from/node_modules/name` から根へ上る。npm の解決の順)。見つからなければ null。 */
function resolveFrom(packages: NpmLockPackages, from: string, name: string): string | null {
  let at: string | null = from;
  while (at !== null) {
    const candidate = at === '' ? `${TOP}${name}` : `${at}${NESTED}${name}`;
    if (entryAt(packages, candidate) !== undefined) return candidate;
    at = lockParentKey(at);
  }
  return null;
}

/** 親の `bundleDependencies` の表(npm が読み込みで足す名前を含む)にその名前があるか。 */
function listedByParent(packages: NpmLockPackages, key: string, parentKey: string): boolean {
  const parent = entryAt(packages, parentKey);
  const name = lockKeyName(key);
  const declared = parent?.bundleDependencies;
  if (Array.isArray(declared) && declared.includes(name)) return true;
  // `#assignBundles`: 子の inBundle の自己申告 + 親が inBundle でない + 親がその名前に依存 → 親の表に足される(`true` の表には足せない)。
  const assignable = declared === undefined || Array.isArray(declared);
  return assignable && entryAt(packages, key)?.inBundle === true && parent?.inBundle !== true && edgeNames(parent).has(name);
}

/**
 * npm がそのエントリの同梱元とみなすエントリのキー(`Node.getBundler` の写し)。同梱でなければ null、根の表の同梱なら `''`。
 *
 * @param packages lockfile の `packages`
 * @param key 見るエントリのキー
 * @param path 辿った道(循環を止める。npm と同じく 1 回の問い合わせで共有する)
 */
function bundlerOf(packages: NpmLockPackages, key: string, path: Set<string>): string | null {
  if (path.has(key)) return null;
  path.add(key);
  const parentKey = lockParentKey(key);
  if (parentKey === null || (parentKey !== '' && entryAt(packages, parentKey) === undefined)) return null;
  const parentBundler = parentKey === '' ? null : bundlerOf(packages, parentKey, path);
  if (parentBundler !== null) return parentBundler;
  if (listedByParent(packages, key, parentKey)) return parentKey;
  const name = lockKeyName(key);
  for (const from of Object.keys(packages)) {
    if (from === key || !edgeNames(entryAt(packages, from)).has(name) || resolveFrom(packages, from, name) !== key) continue;
    if (bundlerOf(packages, from, path) === parentKey) return parentKey;
  }
  return null;
}

/**
 * npm がそのエントリを**依存の同梱**(親の tarball から出す。登録簿から取らない)として扱うか。根の表の同梱は数えない(npm は取る)。
 *
 * @param packages lockfile の `packages`
 * @param key 見るエントリのキー
 * @returns 同梱元のキー(依存の同梱でなければ null)
 */
export function npmDepBundler(packages: NpmLockPackages, key: string): string | null {
  const bundler = bundlerOf(packages, key, new Set());
  // 根(`''`)と workspace の置き場(`node_modules/` の外)は依存の同梱元に数えない(根の表の部品は npm が取る・workspace は厳しい側)。
  return bundler === null || !bundler.includes(TOP) ? null : bundler;
}

/**
 * `inBundle: true` のエントリが**取得元を持たなくてよい正しい同梱**か。外れれば理由(正しければ null)。
 *
 * 正しい同梱 = npm がそのエントリを依存の同梱とみなし(`npmDepBundler`)、エントリが `resolved` も `integrity` も持たず、版が 1 点の版。
 *
 * @param packages lockfile の `packages`
 * @param key 見るエントリのキー
 */
export function bundleProblem(packages: NpmLockPackages, key: string): string | null {
  const entry = entryAt(packages, key);
  if (entry === undefined) return 'エントリが読めない';
  if (entry.resolved !== undefined) return '同梱(inBundle)なのに resolved を持つ(同梱物は親の tarball から出るので取得元を持たない。npm ci はこの resolved から取る)';
  if (entry.integrity !== undefined) return '同梱(inBundle)なのに integrity を持つ(同梱物は親の tarball の integrity で守られる。取得元を持つ形と見分けられない)';
  if (typeof entry.version !== 'string' || !EXACT_VERSION.test(entry.version)) {
    return `同梱(inBundle)の版が 1 点の版でない(${JSON.stringify(entry.version ?? null)})`;
  }
  if (npmDepBundler(packages, key) === null) {
    return '同梱(inBundle)なのに、npm が同梱とみなさない(親の bundleDependencies の配列に名前が無く、親も同梱された部品も依存していない。npm ci は普通の依存として登録簿から取る)';
  }
  return null;
}

/**
 * 依存の解決を固定するファイルとして道具が読む名前のうち、**許さないもの**(小文字。5 回目 C5-2)。
 * `npm-shrinkwrap.json` は同じ場所の `package-lock.json` より優先され(`npm ci` はそちらで入れる)、ほかは別の道具の lockfile。
 */
export const FOREIGN_LOCKFILE_NAMES: readonly string[] = ['npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'deno.lock', '.npmrc', '.yarnrc', '.yarnrc.yml'];

/** 許す lockfile の名前(この綴りだけ。7 回目 C7-2)。 */
export const ALLOWED_LOCKFILE_NAME = 'package-lock.json';

/**
 * ファイル名を、大文字小文字を区別しないファイルシステム(macOS の APFS・Windows の NTFS)が同じ名前とみなす形に畳む
 * (7 回目 C7-2)。NFKC で互換文字を畳み(`ſ` U+017F → `s`・`K` U+212A → `K`・合字 `ﬆ` → `st`・全角 → 半角・NFD の濁点を合成)、
 * 小文字にし、小文字にして生まれた合成の揺れをもう一度 NFKC で畳む。**FS が同一視するより広く畳む**(広い側は拒む側に寄る)。
 *
 * @param name ファイル名
 */
export function foldFileName(name: string): string {
  return name.normalize('NFKC').toLowerCase().normalize('NFKC');
}

/**
 * 畳んだ名前が lockfile らしい形か(道具の名前を表で列挙せずに形で拾う。`*.lock` / `*.lockb` / `*-lock.json` / `*-lock.yaml` /
 * `*-lock.yml` / `*shrinkwrap.json`。名前の末尾で見る)。`db-lock.mts`・`npm-shrinkwrap.json.bak` のような「lock を含むだけ」の名前は当たらない
 * (道具が lockfile として読まない)。
 */
const LOCK_LIKE = /(\.lockb?|-lock\.(json|ya?ml)|shrinkwrap\.json)$/;

/**
 * ファイル名が**許さない** lockfile の名前か(許可表で閉じる。7 回目 C7-2)。
 *
 * 許すのは綴りがちょうど `package-lock.json` のものだけ。それ以外で、畳んだ名前(`foldFileName`)が
 * - 許さない表(`FOREIGN_LOCKFILE_NAMES`)に当たる、
 * - lockfile らしい形(`LOCK_LIKE`)に当たる(綴りの違う `Package-Lock.json` もここで当たる。FS は `package-lock.json` として開くが、
 *   検査は読まない)、
 * ものは許さない。照合は大文字小文字・互換文字を区別しない(`npm-ſhrinkwrap.json` は APFS で `npm-shrinkwrap.json` として開く)。
 *
 * @param name ファイル名(パスの末尾)
 */
export function isForeignLockfileName(name: string): boolean {
  if (name === ALLOWED_LOCKFILE_NAME) return false;
  const folded = foldFileName(name);
  return FOREIGN_LOCKFILE_NAMES.includes(folded) || LOCK_LIKE.test(folded);
}
