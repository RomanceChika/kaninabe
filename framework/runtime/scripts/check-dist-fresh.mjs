/**
 * **仕組み側の配布物(`dist`)の鮮度と、依存の置き場の前置き**(点検 19 回目 C19-1 / C19-2)。
 *
 * `@kaninabe/runtime` と adapters の `exports` は、`test` 条件(vitest)だけがソースを読み、ほかの入口(`tsx` で回す `verify` /
 * `generate`・tsc の型検査・題材のハーネス)は `dist` の JS と `.d.ts` を読む。`dist` はコミットしないので、pull や合流のあとは
 * 古いまま残る。古い評価器の JS で判定と生成物を作ると、生成物も古い評価器で作られているので一致して**誤って緑**になりうる。
 * 依存を入れていない作業木では、Node の解決が親のディレクトリを上へ辿り、**別のチェックアウトの** `node_modules` と `dist` を黙って使う。
 *
 * - `node check-dist-fresh.mjs --write`: `build:framework` の最後に呼ぶ。各パッケージの `dist/.source-hash` に**ソースの hash と dist の中身の hash** を書く。
 * - `node check-dist-fresh.mjs --invalidate`: 各パッケージの `build` の始めに呼ぶ(作業ディレクトリ = パッケージ)。印を消す —— パッケージの `build` だけを回した後・
 *   型エラーで落ちた build(tsc は JS を出す)の後は印が無いので「古い」(点検 20 回目 C20-3: 以前は印がソースだけを証し、別のソースから出た dist でも合った)。
 * - `node check-dist-fresh.mjs`: 照らす。問題があれば 1 行を出して止める。
 *   - 終了コード 1: 配布物が古い・無い(`npm run build:framework` で直る。pre-commit はここで作り直す)
 *   - 終了コード 2: `@kaninabe/runtime` の実体がこのリポジトリの根の外にある・解けない(`npm ci` が要る。作り直しでは直らない)
 *
 * 照らすときは、印のソースの hash と dist の hash の両方が今と同じことを見る(dist を印の後に書き換えた・別の build の JS が残ったのも「古い」)。
 * dist の hash は印のファイルを除く `dist` の下の全部(名前と中身。数百ファイル・数 MB で数十 ms)。
 *
 * hash の対象は、`tsconfig.build.json` が読むソース(`src` の `.ts`。テストと `__tests__` を除く)と `package.json`・`tsconfig.json`・
 * `tsconfig.build.json`。依存を読まない(node の標準だけ。check-node と同じく、どの検査より前に動く)。
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * **前置きを通る入口の表**(点検 21 回目 C の O21-4。前置き `node …/check-dist-fresh.mjs` を手で並べた写しを 1 か所に集めた)。
 * 入口(パッケージ → script の名前)ごとに、`dist` を読む・dist の型を読む命令の前でこの前置きを通る。突合は `entryProblems` で、
 * 表の入口が前置きを持つことと、前置きを持つ script が表に載っていることの**両方向**を見る(写しが増えても漏れない)。
 * `build:gate` だけは前置きが末尾に来る(関所の検査の後で照らす)。表のデータは隣の `freshness-entries.json`(script の名前は npm の名前で、仕組みのコードの
 * 文字列に置かない)。
 */
const FRESHNESS_TABLE = JSON.parse(readFileSync(new URL('./freshness-entries.json', import.meta.url), 'utf-8'));

/** 入口の表(パッケージ → script の名前)。 */
export const FRESHNESS_ENTRIES = FRESHNESS_TABLE.entries;

/**
 * 照らしが**最後の段**に来る入口(パッケージ → script の名前。関所の検査の後で照らす `build:gate`)。ほかの入口は本体の命令より前の段(点検 22 回目 O22-1。
 * 位置の約束も表に持たせ、package.json の字面を写した試験を消した)。
 */
export const FRESHNESS_AT_END = FRESHNESS_TABLE.at_end;

/** 照らしの前置き(`--write` / `--invalidate` の付かない呼び出し)。 */
const FRESHNESS_CALL = /check-dist-fresh\.mjs(?! --(?:write|invalidate))/;

/** 照らしの呼び出しの段(`&&` で割った 1 段がちょうどこの形)。 */
const FRESHNESS_SEGMENT = /^node \S*check-dist-fresh\.mjs$/;

/**
 * script の本文から照らしの段を外した残り(本文を字面で固める試験は、照らしの有無と位置を `entryProblems` に任せる。点検 22 回目 O22-1)。
 *
 * @param {string} command script の本文
 * @returns {string} 照らしの段を外した本文
 */
export function withoutFreshness(command) {
  return command
    .split(' && ')
    .filter((segment) => !FRESHNESS_SEGMENT.test(segment))
    .join(' && ');
}

/**
 * 入口の表と package.json の script の食い違い(両方向)。
 *
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} scriptsOf パッケージ(表の鍵) → その package.json の scripts
 * @param {Readonly<Record<string, readonly string[]>>} [entries] 入口の表
 * @param {Readonly<Record<string, readonly string[]>>} [atEnd] 照らしが末尾に来る入口
 * @returns {string[]} 食い違い(無ければ空)
 */
export function entryProblems(scriptsOf, entries = FRESHNESS_ENTRIES, atEnd = FRESHNESS_AT_END) {
  const problems = [];
  for (const [pkg, names] of Object.entries(entries)) {
    const scripts = scriptsOf[pkg] ?? {};
    for (const name of names) {
      const command = scripts[name] ?? '';
      if (!FRESHNESS_CALL.test(command)) {
        problems.push(`${pkg} の ${name} が前置きを通りません`);
        continue;
      }
      // 位置: 末尾の入口(関所の後で照らす)は最後の段、ほかは本体の命令(最後の段)より前の段。
      const segments = command.split(' && ');
      const at = segments.findIndex((segment) => FRESHNESS_SEGMENT.test(segment));
      const tail = (atEnd[pkg] ?? []).includes(name);
      if (tail ? at !== segments.length - 1 : at < 0 || at === segments.length - 1) problems.push(`${pkg} の ${name} の照らしが${tail ? '最後の段' : '本体の命令より前の段'}にありません`);
    }
    for (const [name, command] of Object.entries(scripts)) {
      if (FRESHNESS_CALL.test(command) && !names.includes(name)) problems.push(`${pkg} の ${name} は前置きを通りますが、入口の表(FRESHNESS_ENTRIES)に載っていません`);
    }
  }
  return problems;
}

/** `build:framework` が作るパッケージ(リポジトリの根から。突合は check-dist-fresh.test.ts がルートの `build:framework` と見る)。 */
export const FRAMEWORK_PACKAGES = ['framework/runtime', 'framework/adapters/postgrest', 'framework/adapters/supabase-session', 'framework/adapters/log-axiom'];

/** `@kaninabe/runtime` を解く入口(リポジトリの根から。実在するものだけ見る)。 */
export const CONSUMERS = ['.', 'app', 'legacy/spec-tools'];

/** 印のファイル(各パッケージの `dist` の下)。 */
export const HASH_FILE = '.source-hash';

/** hash に入れる設定のファイル(パッケージから)。 */
const CONFIG_FILES = ['package.json', 'tsconfig.json', 'tsconfig.build.json'];

/**
 * ソースのうち配布物に入るもの(`tsconfig.build.json` の include / exclude と同じ線)。
 *
 * @param {string} file - パッケージからの相対パス(`/` 区切り)
 * @returns {boolean} 入るなら true
 */
export function isBuiltSource(file) {
  if (!file.startsWith('src/') || !file.endsWith('.ts')) return false;
  if (file.endsWith('.test.ts')) return false;
  return !file.split('/').includes('__tests__');
}

/**
 * ディレクトリの下のファイル(相対パス・`/` 区切り)。
 *
 * @param {string} dir - 探す場所
 * @param {string} base - 相対パスの基点
 * @returns {string[]} ファイル
 */
function filesUnder(dir, base) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full, base));
    else if (entry.isFile()) found.push(relative(base, full).split(sep).join('/'));
  }
  return found;
}

/**
 * パッケージのソースの hash(ファイル名と中身。並びは名前の順)。
 *
 * @param {string} packageDir - パッケージの場所
 * @returns {string} sha256 の 16 進
 */
export function sourceHash(packageDir) {
  const files = [...CONFIG_FILES.filter((file) => existsSync(join(packageDir, file))), ...filesUnder(join(packageDir, 'src'), packageDir).filter(isBuiltSource)].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(packageDir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * パッケージの dist の中身の hash(印のファイルを除く全部の名前と中身。並びは名前の順)。
 *
 * @param {string} packageDir - パッケージの場所
 * @returns {string} sha256 の 16 進(dist が無ければ空文字)
 */
export function distHash(packageDir) {
  const dist = join(packageDir, 'dist');
  if (!existsSync(dist)) return '';
  const hash = createHash('sha256');
  for (const file of filesUnder(dist, dist).filter((name) => name !== HASH_FILE).sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(dist, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * 印の本文(1 行目 = ソースの hash・2 行目 = dist の hash)。
 *
 * @param {string} packageDir - パッケージの場所
 * @returns {string} 本文
 */
export function markText(packageDir) {
  return `${sourceHash(packageDir)}\n${distHash(packageDir)}\n`;
}

/**
 * 古い・無い配布物のパッケージ(リポジトリの根からのパス)。
 *
 * @param {string} root - リポジトリの根
 * @param {readonly string[]} [packages] - 見るパッケージ
 * @returns {string[]} 古いパッケージ
 */
export function stalePackages(root, packages = FRAMEWORK_PACKAGES) {
  return packages.filter((pkg) => {
    const mark = join(root, pkg, 'dist', HASH_FILE);
    return !existsSync(mark) || readFileSync(mark, 'utf8') !== markText(join(root, pkg));
  });
}

/**
 * 各パッケージの印を書く(`build:framework` の最後)。
 *
 * @param {string} root - リポジトリの根
 * @param {readonly string[]} [packages] - 書くパッケージ
 * @returns {void}
 */
export function writeMarks(root, packages = FRAMEWORK_PACKAGES) {
  for (const pkg of packages) {
    const dist = join(root, pkg, 'dist');
    if (!existsSync(dist)) throw new Error(`${pkg}/dist がありません(tsc の出力の後に呼んでください)`);
    writeFileSync(join(dist, HASH_FILE), markText(join(root, pkg)));
  }
}

/**
 * パッケージの印を消す(パッケージの `build` の始め。作業ディレクトリがパッケージ)。
 *
 * @param {string} root - リポジトリの根
 * @param {string} cwd - 作業ディレクトリ(パッケージ)
 * @returns {string | null} 消したパッケージ(表に無い場所なら null)
 */
export function invalidateMark(root, cwd) {
  const pkg = relative(root, cwd).split(sep).join('/');
  if (!FRAMEWORK_PACKAGES.includes(pkg)) return null;
  rmSync(join(root, pkg, 'dist', HASH_FILE), { force: true });
  return pkg;
}

/**
 * Node の解決と同じ向き(入口から親へ)で、最初に見つかる `node_modules/@kaninabe/runtime` の場所。
 *
 * @param {string} from - 入口の場所
 * @returns {string | null} 見つかった場所(無ければ null)
 */
export function nearestRuntime(from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', '@kaninabe', 'runtime');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * `@kaninabe/runtime` の実体がリポジトリの根の中か(入口ごと)。問題が無ければ null。
 *
 * @param {string} root - リポジトリの根
 * @param {readonly string[]} [consumers] - 解く入口
 * @returns {string | null} 止める 1 行
 */
export function locationProblem(root, consumers = CONSUMERS) {
  const realRoot = realpathSync(root);
  for (const consumer of consumers) {
    const from = join(root, consumer);
    if (!existsSync(join(from, 'package.json'))) continue;
    const found = nearestRuntime(from);
    if (found === null) return `@kaninabe/runtime が ${consumer} から解けません。この作業木に依存が入っていません(npm ci)`;
    const real = realpathSync(found);
    const inside = relative(realRoot, real);
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      return `@kaninabe/runtime が ${consumer} からリポジトリの外(${real})に解かれます。この作業木に依存が入っていません(npm ci)`;
    }
  }
  return null;
}

/**
 * 照らした結果(終了コードと 1 行)。
 *
 * @param {string} root - リポジトリの根
 * @returns {{ code: 0 | 1 | 2, line: string | null }} 結果
 */
export function verdict(root) {
  const location = locationProblem(root);
  if (location !== null) return { code: 2, line: location };
  const stale = stalePackages(root);
  if (stale.length > 0) return { code: 1, line: `仕組み側の配布物(dist)がソースより古い・無い: ${stale.join(', ')}(npm run build:framework)` };
  return { code: 0, line: null };
}

/** このファイルから見たリポジトリの根。 */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    writeMarks(REPO_ROOT);
  } else if (process.argv.includes('--invalidate')) {
    if (invalidateMark(REPO_ROOT, process.cwd()) === null) {
      console.error(`check-dist-fresh: --invalidate はパッケージ(${FRAMEWORK_PACKAGES.join(', ')})の中で回す(今の場所: ${process.cwd()})`);
      process.exit(2);
    }
  } else {
    const result = verdict(REPO_ROOT);
    if (result.line !== null) {
      console.error(result.line);
      process.exit(result.code);
    }
  }
}
