/**
 * 配布物の**公開の口**を宣言と突き合わせる 1 秒のスモーク(`npm run check:exports`)。
 *
 * 見るのは 6 つである。
 *   1. `exports` の各エントリが `require()` で読めること(emit の破れ)
 *   2. 同じエントリが `import()` でも読めること
 *   3. **`require()` の口と `import()` の名前つき輸出が一致すること**(interop の破れ)
 *   4. **口の名前が宣言(`exports-manifest.json`)と両方向で一致すること**(口が増えた / 消えた)
 *   5. **`exports` のキーにワイルドカード(`*`)が 1 本も無いこと**(内部ファイルが黙って公開されない)
 *   6. 配布物を指さないエントリ(`./testing/*` の `.mts`)の**実体がディスクに在ること**
 *
 * **なぜ要るのか。** 配り方が `tsc` → `dist` になったので、型検査が通っても**配布物が壊れて
 * いる**ことがありうる(ADR-0013 の配り方 A)。実際に 1 度踏んだ破れは interop の側である ——
 * `.ts` を素のまま配っていたとき、利用側(`tsx`)から名前つきで値を import できなかった
 * (`SyntaxError: does not provide an export named 'eqSubjectValues'`)。
 *
 * **3 だけでは「口が 1 本消えた」は捕らない**(両方の口から同じように消えるので食い違わない。
 * 実測: `dist` から `exports.err = err;` の 1 行を消しても、数が 95 → 94 に減るだけで緑だった)。
 * だから 4 の**閉世界**を置く —— 口の名前の一覧を宣言に持ち、増減のどちらも赤にする。
 * 宣言を更新するのは公開の口を変えたときだけで、**ルートの** `npm run check:exports:write` が書き出す
 * (生成物の鮮度を `generate:check` が見るのと同じ形。差分がレビューに出ることが目的である)。
 *
 * **`test` 条件は実行しない。** `exports` の各エントリは 3 つの条件を持つ(`test` = ソース /
 * `types` = `.d.ts` / `default` = 配布物)が、ここが読むのは `default` だけである ——
 * ソースを実行するのは `test:unit`(vitest の設定が SSR 側の条件で選ぶ)の仕事であり、
 * ここは**配布物が読めること**だけを見る。両方を 1 つの検査に混ぜると、どちらが壊れたのか
 * 分からない失敗になる。
 *
 * **入口は名指しである(5)。** `exports` にワイルドカードを書くと、ディレクトリに足したファイルが
 * 何の審査も無く公開の口になる(実測: `./template/*` が `run-plan-decide-core` のような内部補助まで
 * 外から引ける形だった)。口を増やす = `package.json` と `exports-manifest.json` の両方に差分が出る
 * = レビューに出る、という線をここで機械にする。**テスト基盤(`./testing/*`)も同じく名指し**にして
 * あるので例外は無い(本数は 22 行で、ワイルドカード 6 行からの増分は 16 行にとどまる)。
 *
 * **閉世界の範囲は「`./dist/` を指すエントリ」である。** `exports` の中で配布物を指していない
 * エントリ(`./testing/*` = テストランナーの入口である `.mts`)は対象外で、**その本数を必ず出力に
 * 出す** —— 黙って飛ばすと「全エントリを見た」と誤読される。ただし**実体の在ること(6)だけは見る**
 * (名指しにしたぶん、ファイルの改名で宣言だけが残る破れが起こりうる)。ランナーの外で評価しても意味が無い
 * ものを読みに行かないための線引きであり、`setup-env.mts` は `inject` を即座に呼ぶ。
 *
 * **特別な実行条件は要らない。** 仕組み側のパッケージ(`@kaninabe/runtime`・adapter)は `import 'server-only'` を
 * 持たない(サーバー専用の印は製品の配線と生成した組み立ての根が持つ)ので、素の Node でそのまま評価できる。
 * 以前は `--conditions=react-server`(`server-only` 自身の空実装を選ぶ条件)で実行していたが、印を持つ
 * ファイルが無くなったので外した —— **条件を足さずに読めること自体が、配布物にサーバー専用の印が無いことの証拠**である。
 *
 * **複数のパッケージが共有する。** 検査の対象は**呼ばれた場所(`process.cwd()`)のパッケージ**であり、
 * `npm run check:exports --workspace <名前>` が作業ディレクトリをそのパッケージの根にする。宣言
 * (`exports-manifest.json`)はそのパッケージの根に置く。adapter も同じ 1 本を呼ぶ(写しを持たない)。
 *
 * 純粋な走査であり、落ちるときは何がどう食い違ったかを言い切って終える。
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 検査するパッケージの根(呼ばれた場所。`npm run … --workspace` が作業ディレクトリをパッケージの根にする)。 */
const PKG_DIR = process.cwd();

/** 公開の口の宣言(このファイルと同じ根に置く)。 */
const MANIFEST_FILE = join(PKG_DIR, 'exports-manifest.json');

/** このファイルからの CJS 解決器。 */
const require_ = createRequire(import.meta.url);

/**
 * `exports` 全体を「読む指定子」と「飛ばしたエントリ」に分ける。
 *
 * ワイルドカードのキーは開かない(5 で弾くので、ここへ来るのは名指しのキーだけである)。
 *
 * @param {Record<string, unknown>} exportsMap `package.json` の `exports`
 * @param {string} name パッケージ名
 * @returns {{ specifiers: readonly string[], skipped: readonly { key: string, target: string }[] }} 読む口と、配布物を指さないエントリ
 */
function openExports(exportsMap, name) {
  /** @type {string[]} */
  const specifiers = [];
  /** @type {{ key: string, target: string }[]} */
  const skipped = [];
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key.includes('*')) continue;
    const target = typeof value === 'object' && value !== null ? value.default : value;
    if (typeof target !== 'string' || !target.startsWith('./dist/')) {
      skipped.push({ key, target: typeof target === 'string' ? target : '' });
      continue;
    }
    specifiers.push(`${name}${key.slice(1)}`);
  }
  return { specifiers: [...new Set(specifiers)].sort(), skipped };
}

/**
 * `exports` のキーにワイルドカードが無いことを見る(5)。
 *
 * @param {Record<string, unknown>} exportsMap `package.json` の `exports`
 * @returns {readonly string[]} 破れの説明(空なら名指しだけ)
 */
function wildcardProblems(exportsMap) {
  return Object.keys(exportsMap)
    .filter((key) => key.includes('*'))
    .map((key) => `exports のキー「${key}」がワイルドカードです(内部ファイルまで公開される。入口は 1 本ずつ名指しにする)`);
}

/**
 * 配布物を指さないエントリの実体がディスクに在ることを見る(6)。
 *
 * @param {readonly { key: string, target: string }[]} skipped 配布物を指さないエントリ
 * @returns {readonly string[]} 破れの説明(空なら全部在る)
 */
function missingTargetProblems(skipped) {
  return skipped
    .filter(({ target }) => target === '' || !existsSync(join(PKG_DIR, target)))
    .map(({ key, target }) => `${key}: 指す先(${target === '' ? '未指定' : target})がありません(ファイルを改名・削除したら exports も直す)`);
}

/**
 * 1 つの指定子を両方の口で読み、名前つき輸出の集合を取る。
 *
 * @param {string} specifier 読む指定子
 * @returns {Promise<{ names: readonly string[], problem: string | null }>} 口の名前と、読めなかった理由
 */
async function probe(specifier) {
  let cjsKeys;
  try {
    cjsKeys = Object.keys(require_(specifier)).sort();
  } catch (error) {
    return { names: [], problem: `require() で読めません: ${String(error)}` };
  }
  let esmKeys;
  try {
    const namespace = await import(specifier);
    esmKeys = Object.keys(namespace)
      .filter((key) => key !== 'default')
      .sort();
  } catch (error) {
    return { names: cjsKeys, problem: `import() で読めません: ${String(error)}` };
  }
  const missing = cjsKeys.filter((key) => !esmKeys.includes(key));
  if (missing.length > 0) {
    return {
      names: cjsKeys,
      problem: `import() から見えない口があります(${missing.join(' / ')})—— CommonJS の名前つき輸出の検出に失敗しています`,
    };
  }
  return { names: cjsKeys, problem: null };
}

/**
 * 実測の口と宣言を両方向で突き合わせる。
 *
 * @param {Record<string, readonly string[]>} declared 宣言(指定子 → 口の名前)
 * @param {Record<string, readonly string[]>} actual 実測(同じ形)
 * @returns {readonly string[]} 食い違いの説明(空なら一致)
 */
function manifestProblems(declared, actual) {
  /** @type {string[]} */
  const problems = [];
  for (const specifier of Object.keys(actual)) {
    if (!(specifier in declared)) {
      problems.push(`${specifier}: 宣言にありません(口を増やしたら exports-manifest.json も更新する)`);
    }
  }
  for (const specifier of Object.keys(declared)) {
    if (!(specifier in actual)) {
      problems.push(`${specifier}: 宣言にあるのに配布物にありません(口を消したら宣言も消す)`);
    }
  }
  for (const [specifier, names] of Object.entries(actual)) {
    const expected = declared[specifier];
    if (expected === undefined) continue;
    const lost = expected.filter((name) => !names.includes(name));
    const added = names.filter((name) => !expected.includes(name));
    if (lost.length > 0) problems.push(`${specifier}: 宣言にある口が配布物にありません(${lost.join(' / ')})`);
    if (added.length > 0) problems.push(`${specifier}: 宣言に無い口があります(${added.join(' / ')})`);
  }
  return problems;
}

const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const distDir = join(PKG_DIR, 'dist');
try {
  statSync(distDir);
} catch {
  console.error(`配布物がありません(${distDir})。先に npm run build:framework を実行してください。`);
  process.exit(1);
}

const shapeProblems = [...wildcardProblems(manifest.exports)];
const { specifiers, skipped } = openExports(manifest.exports, manifest.name);
shapeProblems.push(...missingTargetProblems(skipped));
const probed = await Promise.all(specifiers.map(async (specifier) => ({ specifier, ...(await probe(specifier)) })));
const loadProblems = probed.filter((entry) => entry.problem !== null).map((entry) => `${entry.specifier}: ${String(entry.problem)}`);

/** 実測した口の一覧(指定子 → 名前)。 */
const actual = Object.fromEntries(probed.map((entry) => [entry.specifier, entry.names]));

if (process.argv.includes('--write')) {
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
  console.log(`公開の口の宣言を書き出しました(${String(specifiers.length)} 本)。差分をレビューしてください: ${MANIFEST_FILE}`);
  process.exit(0);
}

const declared = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
const problems = [...shapeProblems, ...loadProblems, ...(loadProblems.length > 0 ? [] : manifestProblems(declared, actual))];

if (problems.length > 0) {
  console.error(`配布物のスモーク: ${String(problems.length)} 件の破れ`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('  公開の口を変えたのなら、ルートで `npm run check:exports:write` を実行して宣言を書き出し、差分をレビューしてください。');
  process.exit(1);
}

const names = Object.values(actual).reduce((sum, list) => sum + list.length, 0);
console.log(
  `配布物のスモーク: ${String(specifiers.length)} 本の口を require() と import() で読み、` +
    `名前つき輸出 ${String(names)} 個が宣言どおりでした(配布物を指さないエントリ ${String(skipped.length)} 件は対象外)`,
);
