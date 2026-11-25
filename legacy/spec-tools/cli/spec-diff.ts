/**
 * 仕様の意味の差分(semantic diff)の CLI。
 *
 * 使い方:
 *   npm run spec:diff -- --base <ref>                  # 基点 ⇔ 作業ツリー
 *   npm run spec:diff -- --base <ref> --head <ref>     # 2 つのコミットを比べる
 *   npm run spec:diff -- --base <ref> --out <path>     # Markdown をファイルにも出す
 *   `--root` の説明は `ROOT_OPTION_HELP`(`lib/io/messages.ts`)
 *
 * 終了コード: 0(差分の有無にかかわらず出力できた)、1(**判定できなかった** ——
 * git が答えない・比較先の生成物が読めない)。これは**検査ではなく読み物の生成**であり、
 * 差分があること自体は赤ではない(人が読むためのものである)。
 *
 * **この CLI が持つのは引数の読み取りと I/O と印字だけ**である。何が意味の差かの判定は
 * lib/diff/** の純粋関数にあり、git の読み取りは lib/diff/git-io.ts だけが行う。
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { semanticDiffWithAxioms } from '../lib/diff/with-axioms.js';
import { commitExists, gitSide, gitSilentReason } from '../lib/diff/git-io.js';
import { NOTICES } from '../lib/diff/messages.js';
import { renderDiff } from '../lib/diff/render.js';
import { axiomSources } from '../lib/diff/axiom-sources.js';
import { diffSources, labelSources } from '../lib/diff/sources.js';
import { gitIn, pathsOf, snapshotOf, worktreeSide } from './diff-io.js';
import { PRODUCT_DECL_FILE } from '../lib/io/paths.js';
import { symlinkOnPath, writeFileNoFollow } from '../lib/io/scratch.js';
import { repoRootOrExit } from './repo-root.js';
import { loadProductRoots } from '../lib/model/product/loader.js';

/** リポジトリルート(作業ディレクトリから製品の根の宣言を上へ探す。`--root <path>` で上書き)。 */
const REPO_ROOT = repoRootOrExit('spec:diff', process.argv.slice(2));

/** git を回す口。 */
const gitRunner = gitIn(REPO_ROOT);

/** 引数から `--key value` を 1 つ読む。無ければ undefined。 */
function option(args: readonly string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/** 基点を決める(使えなければ HEAD~1 に倒し、そのことを出力に残す)。 */
function resolveBase(given: string | undefined): { ref: string | null; notes: readonly string[] } {
  const usable = given !== undefined && given !== '' && !/^0{40}$/.test(given) && commitExists(gitRunner, given);
  if (usable && given !== undefined) return { ref: given, notes: [] };
  if (!commitExists(gitRunner, 'HEAD~1')) return { ref: null, notes: [NOTICES.noHistory] };
  return { ref: 'HEAD~1', notes: [NOTICES.fellBack(given === undefined || given === '' ? '(未指定)' : given)] };
}

/** 判定できなかったことを報告して止める。 */
function unavailable(reason: string): number {
  console.error(NOTICES.unavailable(reason));
  console.error(`  ${NOTICES.remedy}`);
  return 1;
}

/** Markdown を出す(標準出力と、指定があればファイル)。 */
function emit(markdown: string, out: string | undefined): void {
  process.stdout.write(markdown);
  if (out === undefined) return;
  const target = path.isAbsolute(out) ? out : path.join(REPO_ROOT, out);
  // 根の下に書くなら、途中の要素(`tmp` 自体を含む)がリンクでないこと。最後の要素は O_NOFOLLOW で開く。
  const inside = path.relative(REPO_ROOT, target);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    const link = symlinkOnPath(REPO_ROOT, inside.split(path.sep).join('/'));
    if (link !== null) throw new Error(`--out の途中の ${link} はシンボリックリンクです(書き込みが辿って別の場所を書き換える)。リンクを外してください`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileNoFollow(target, markdown);
}

function main(): number {
  const roots = loadProductRoots(REPO_ROOT).model.roots;
  if (roots === null) return unavailable(`製品の根の宣言(${PRODUCT_DECL_FILE})を読めません`);
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(NOTICES.usage);
    return 0;
  }
  const silent = gitSilentReason(gitRunner);
  if (silent !== null) return unavailable(silent);

  const base = resolveBase(option(args, '--base'));
  if (base.ref === null) {
    for (const note of base.notes) console.log(`spec:diff: ${note}`);
    return 0;
  }
  const headRef = option(args, '--head');
  if (headRef !== undefined && !commitExists(gitRunner, headRef)) {
    return unavailable(`比較先 ${headRef} がこのクローンにありません`);
  }
  const baseSide = gitSide(gitRunner, base.ref);
  const headSide = headRef === undefined ? worktreeSide(REPO_ROOT) : gitSide(gitRunner, headRef);

  const sources = [...diffSources(roots), ...labelSources(roots), ...axiomSources(roots)];
  const paths = pathsOf(sources, [headSide, baseSide]);
  const baseSnapshot = snapshotOf(baseSide, paths);
  if (baseSnapshot.reason !== null) return unavailable(baseSnapshot.reason);
  const headSnapshot = snapshotOf(headSide, paths);
  if (headSnapshot.reason !== null) return unavailable(headSnapshot.reason);

  const { outcome, axiom } = semanticDiffWithAxioms(baseSnapshot.snapshot, headSnapshot.snapshot, roots);
  emit(renderDiff(outcome, base.ref, base.notes, axiom), option(args, '--out'));
  // **どちらの版が読めなくても赤**である(公理の側の源も同じ) —— 片側が読めないとその軸は判定を諦めており、
  // 「差分なし」として緑で通ると、黙って見ていないことになる(裁定: 走れなかった・
  // 読めなかったは赤、差分の有無では落とさない)。
  if (outcome.problems.some((problem) => problem.kind === 'unreadable')) {
    console.error(NOTICES.unreadable);
    return 1;
  }
  return 0;
}

process.exit(main());
