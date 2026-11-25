/**
 * ハンドブックだけを出す入口(`cli/generate-book.ts`)の**書き先**: 引数から「どこへ書くか」を決め、書く前に「その置き場の木を通して
 * 本物のハンドブックを書き換えないか」を全ファイルぶん検査する(純関数。実ファイルへの問い合わせは呼び手が口として渡す)。
 *
 * 製品が実装の木(`app`)を宣言していれば全部入りの `generate` がある製品で、本物のハンドブックはその生成物である。検証を載せない
 * 部分の出力で上書きしないよう、**既定では書かない**(`--out <dir>` で別の置き場を明示したときだけ書く。置き場には製品の木と同じ
 * 相対の並び `<dir>/<book の根>/…` で書く)。実装の木を持たない製品(仕様だけ = 合意の道具の本来の利用者)は従来どおり製品の
 * `book` の根に書く。`--out` の置き場の根が本物の別名でなくても、**置き場の木の中の子**(1 ファイル・途中のディレクトリ)が製品の
 * ファイルへのシンボリックリンクなら書き込みは辿って本物を書き換えるので、書く前に書く予定の全ファイルを先に検査する
 * (`destinationConflicts`)。章を止める判断(`book-entry-plan.ts`)とは使い手も変わる理由も別である。
 *
 * **アプリの語彙は 1 語も持たない**。
 */

import path from 'node:path';
import type { EntryKind } from '../io/paths.js';
import type { ProductRoots } from '../model/product/types.js';

/** `--out` の値の取り出し結果。 */
export type OutOption = { readonly kind: 'absent' } | { readonly kind: 'missing' } | { readonly kind: 'value'; readonly value: string };

/** `--out` の綴り。 */
export const OUT_OPTION = '--out';

/**
 * 引数から `--out` の値を取り出す(`--out <dir>` と `--out=<dir>` の両方。どちらでもない綴りを黙って無視しない)。
 *
 * @param args CLI の引数
 */
export function outOptionOf(args: readonly string[]): OutOption {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg.startsWith(`${OUT_OPTION}=`)) {
      const value = arg.slice(OUT_OPTION.length + 1);
      return value === '' ? { kind: 'missing' } : { kind: 'value', value };
    }
    if (arg === OUT_OPTION) {
      const value = args[index + 1];
      return value === undefined || value.startsWith('--') ? { kind: 'missing' } : { kind: 'value', value };
    }
  }
  return { kind: 'absent' };
}

/** 書き先の決定(書く場合は書き込みの根。相対のファイルはこの根の下に製品と同じ並びで置く)。 */
export type EntryDestination =
  | { readonly ok: true; readonly outRoot: string; readonly explicit: boolean }
  | { readonly ok: false; readonly message: string };

/** `--out` の使い方(拒否のときに添える)。 */
const OUT_USAGE = `${OUT_OPTION} <dir>  書き込み先の置き場(<dir>/<book の根>/… に、製品と同じ並びで書く。相対パスは呼ばれた場所から解く)`;

/**
 * 書き先を決める。
 *
 * - 実装の木(`app`)を宣言している製品: `--out` が無ければ**書かずに止める**(本物のハンドブックを部分の出力で上書きしない)
 * - 実装の木を持たない製品: `--out` が無ければ製品の根(従来どおり `book` の根に書く)
 * - `--out` が指す置き場が製品の根と同じ場所になるなら、止める(`--out` で本物の `book` の根へ書き込まない)
 *
 * @param repoRoot 製品の根の絶対パス
 * @param roots 製品が宣言した根
 * @param out `--out` の取り出し結果
 * @param invocationDir 相対の `--out` を解く基準(呼ばれた場所)
 * @param realpath パスの別名(シンボリックリンクなど)を畳む口(同じ場所かの判定に使う。既定は畳まない)
 */
export function entryDestination(
  repoRoot: string,
  roots: ProductRoots,
  out: OutOption,
  invocationDir: string,
  realpath: (file: string) => string = (file) => file,
): EntryDestination {
  if (out.kind === 'missing') return { ok: false, message: `${OUT_OPTION} には値(書き込み先の置き場)が要ります\n  ${OUT_USAGE}` };
  if (out.kind === 'absent') {
    if (roots.app === null) return { ok: true, outRoot: repoRoot, explicit: false };
    return {
      ok: false,
      message:
        `この製品は実装の木(${roots.app})を持つので、本物のハンドブック(${roots.book})は全部入りの generate の生成物です。` +
        `この入口は検証を載せない部分の出力なので、既定では書きません。別の置き場を指定してください\n  ${OUT_USAGE}`,
    };
  }
  const outRoot = path.resolve(invocationDir, out.value);
  if (realpath(path.join(outRoot, roots.book)) === realpath(path.join(repoRoot, roots.book))) {
    return {
      ok: false,
      message: `${OUT_OPTION} が指す置き場 \`${outRoot}\` は製品の根と同じ場所で、本物のハンドブック(${roots.book})に書いてしまいます。別の置き場を指定してください\n  ${OUT_USAGE}`,
    };
  }
  return { ok: true, outRoot, explicit: true };
}

/** 出力先の木の中を調べる口(実ファイルへの問い合わせ。呼び手が `io/paths.ts` の小道具を渡す)。 */
export interface DestinationProbe {
  /** パスそのものの種類(別名を辿らない)。 */
  readonly kindOf: (file: string) => EntryKind;
  /** 実在しない場所も含めて、別名を畳んだパス。 */
  readonly realpath: (file: string) => string;
}

/**
 * `--out` の置き場の木を通して、製品の本物のハンドブックを書き換えてしまう書き込みを、**書く前に全ファイルぶん**探す。
 *
 * 置き場の根(`entryDestination`)が製品のハンドブックの別名でなくても、**置き場の木の中の子**(1 ファイル・途中のディレクトリ)が
 * 製品のファイルへのシンボリックリンクなら、書き込みは辿って本物を書き換える。そこで書く予定の全ファイルについて、置き場の根から
 * ファイルまで**在る祖先とファイル自身**を順に見て、次のどちらかなら問題にする(途中で見つけて一部だけ書く、を作らないために、
 * 呼び手は 1 件でもあれば何も書かない)。
 *
 *   - **置き場の木の中に在るシンボリックリンク**(ファイル・ディレクトリとも。宙ぶらりんのものも)。辿った先が本物のハンドブックかを
 *     調べず、一律に拒否する(単純な方を採る。置き場は専用の木を前提にする)
 *   - **実体が製品のハンドブックの根の中に解決される**書き込み先(置き場の根そのものがその中にある・根が製品の根の別名、を含む)
 *
 * **ハードリンクは対象外**である(同じ実体を指す別名はパスから見えない。inode は比べない)。
 *
 * @param files 書く予定のファイル(置き場の根からの相対パス)
 * @param outRoot 置き場の根(絶対パス)
 * @param repoRoot 製品の根の絶対パス
 * @param roots 製品が宣言した根
 * @param probe 実ファイルへの問い合わせ
 * @returns 問題の説明(0 件なら書いてよい。昇順・重複なし)
 */
export function destinationConflicts(
  files: readonly string[],
  outRoot: string,
  repoRoot: string,
  roots: ProductRoots,
  probe: DestinationProbe,
): readonly string[] {
  const realBook = probe.realpath(path.join(repoRoot, roots.book));
  const insideBook = (real: string): boolean => real === realBook || real.startsWith(`${realBook}${path.sep}`);
  if (insideBook(probe.realpath(outRoot))) {
    return [`置き場 ${outRoot} は製品の本物のハンドブック(${roots.book})の中に解決されます`];
  }
  const problems = new Set<string>();
  for (const file of files) {
    let current = outRoot;
    const walked: string[] = [];
    let linked = false;
    for (const segment of file.split('/')) {
      current = path.join(current, segment);
      walked.push(segment);
      const kind = probe.kindOf(current);
      if (kind === 'absent') break;
      if (kind === 'symlink') {
        problems.add(`${walked.join('/')} は置き場の木の中の既存のシンボリックリンクです(書き込みが辿って別のファイルを書き換えます)`);
        linked = true;
        break;
      }
    }
    if (!linked && insideBook(probe.realpath(path.join(outRoot, file)))) {
      problems.add(`${file} の書き込み先は製品の本物のハンドブック(${roots.book})の中に解決されます`);
    }
  }
  return [...problems].sort();
}
