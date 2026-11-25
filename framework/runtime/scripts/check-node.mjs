/**
 * **検査の入口の Node の版の前置き**(`node framework/runtime/scripts/check-node.mjs [--engines <package.json>]`)。
 *
 * 違う版のまま検査へ進むと、Z3 などの読み込みの失敗が大量の赤に化けて、原因が読めない(実測: Node 22 で 174 件)。
 * 検査の最初で版だけを見て、違えば 1 行で止める。依存を読まない(どの版の Node でも動く構文だけで書く)。
 *
 * - **既定**: 手元の検査の入口。`.nvmrc` のメジャー版と**一致**しなければ止める(pre-commit・`verify`)。
 * - **`--engines <package.json>`**: 製品のビルドの入口(`build:gate`)。呼び手が渡した `package.json` の `engines.node` が許す版なら通す
 *   (仕組みは製品の置き場を知らない。製品のビルドの命令が自分の `package.json` を渡す)。
 *   ホスティングは `engines` を読んで版を選ぶ(`>=24` なら新しいメジャー版を選びうる)ので、`.nvmrc` との一致を求めるとビルドを誤って止める。
 *
 * `engines.node` が読める形は `>=<整数>` だけである。それ以外の宣言は判定できないので止める(推測しない)。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 許す `engines.node` の形。 */
const ENGINES_FORM = /^>=(\d+)$/;

/**
 * 実行中の版のメジャー番号。
 *
 * @param {string} version - `process.versions.node` の形(`24.18.1`)
 * @returns {number} メジャー番号
 */
function majorOf(version) {
  return Number(version.split('.')[0]);
}

/**
 * 手元の検査の判定(メジャー版の一致)。
 *
 * @param {string} version - 実行中の版
 * @param {string} nvmrc - `.nvmrc` の中身
 * @returns {string | null} 止める 1 行(通すなら null)
 */
export function exactVerdict(version, nvmrc) {
  const wanted = nvmrc.trim();
  if (!/^\d+$/.test(wanted)) return `.nvmrc の中身(${wanted})はメジャー版の整数ではありません`;
  if (majorOf(version) === Number(wanted)) return null;
  return `Node ${version} では検査を回せません。このリポジトリは Node ${wanted} です(nvm use で切り替えて流し直してください)`;
}

/**
 * ビルドの入口の判定(`engines.node` が許す版か)。
 *
 * @param {string} version - 実行中の版
 * @param {unknown} engines - 呼び手の `package.json` の `engines.node`
 * @returns {string | null} 止める 1 行(通すなら null)
 */
export function enginesVerdict(version, engines) {
  const matched = typeof engines === 'string' ? ENGINES_FORM.exec(engines) : null;
  if (matched === null) return `package.json の engines.node(${String(engines)})は >=<整数> の形で書いてください`;
  if (majorOf(version) >= Number(matched[1])) return null;
  return `Node ${version} ではビルドできません。package.json の engines.node は ${String(engines)} です`;
}

/** リポジトリの根のファイルを読む。 */
function readRootFile(path) {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
}

/** `--engines` の次の引数(読む `package.json` の場所。省略は止める)。 */
function enginesManifest(argv) {
  const at = argv.indexOf('--engines');
  return at === -1 ? null : (argv[at + 1] ?? '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.versions.node;
  const manifest = enginesManifest(process.argv);
  const verdict =
    manifest === null
      ? exactVerdict(version, readRootFile('.nvmrc'))
      : manifest === ''
        ? '--engines には読む package.json の場所を渡してください'
        : enginesVerdict(version, JSON.parse(readFileSync(manifest, 'utf8')).engines?.node);
  if (verdict !== null) {
    console.error(verdict);
    process.exit(1);
  }
}
