/**
 * C23 の検査対象の差分を**どこから取るか**の決定部(基点の決め方)。
 *
 * 何が違反かの判定は `migration-immutability.ts` の純粋関数であり、ここはその手前 ——
 * 「pre-commit ならステージ、merge-check と CI なら呼び手が渡した基点(無い・使えなければ赤)」という
 * **差分の取り方**だけを持つ(基点を選ぶのは呼び手。merge-check では走り手が旧 main との分岐点を渡す)。git の呼び出しは `GitRunner` として注入される
 * (実装は CLI の `execFileSync`、テストは使い捨てリポジトリに向けた本物の git)ので、
 * 基点の決め方そのものを単体で読める。
 *
 * ここが型で分けているのは 3 つの結末である ——
 * - `diff` … 比べられた(中身を判定へ渡す)
 * - `skip` … **検査対象が無い**(ステージの最初のコミット)。理由を報告して通す
 * - `unavailable` … **git が答えなかった**(存在しない ref・壊れたリポジトリ)。検査は
 *   「分からないときは赤」であり、呼び出し側は止める
 *
 * `skip` と `unavailable` を 1 つの `null` で運んでいたのが束 ㉒ の穴だった —— git の失敗が
 * 無出力・exit 0 になり、**本番 DB に触る直前の関門が無言で通る**形が残っていた
 * (`--head 存在しない ref` で実測)。同じ穴を作らないために、以後もこの 3 つを畳まない。
 */

import { migrationDir } from './migration-immutability.js';
import type { ProductRoots } from '../model/product/types.js';

/** git の返事。成功なら標準出力、失敗なら理由(stderr の 1 行目など)。 */
export type GitResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

/**
 * git を回す口。
 *
 * @param args `git` に続く引数(`['diff', …]`)
 * @returns 標準出力、または失敗の理由
 */
export type GitRunner = (args: readonly string[]) => GitResult;

/** 検査対象の差分をどこから取るか決めた結果(3 つの結末)。 */
export type DiffSource =
  /** 比べられた。`raw` は `git diff --name-status -z` の出力そのまま。 */
  | { readonly kind: 'diff'; readonly raw: string; readonly base: string; readonly notes: readonly string[] }
  /** 検査対象が無い(通してよい)。`notes` にその理由を入れて必ず声を出す。 */
  | { readonly kind: 'skip'; readonly notes: readonly string[] }
  /** git が答えなかった(判定できない = 赤)。 */
  | { readonly kind: 'unavailable'; readonly reason: string };

/** そのコミットがこのクローンに存在するか(浅いクローン・force push で欠けることがある)。 */
function commitExists(run: GitRunner, ref: string): boolean {
  return run(['cat-file', '-e', `${ref}^{commit}`]).ok;
}

/**
 * git 自体が答えるかを 1 回だけ探る。
 *
 * これが無いと「ref が無い」と「git が壊れている」を区別できない —— `cat-file -e` は
 * どちらでも失敗するので、壊れた環境では「歴史が無い」になって黙って通ってしまう。
 */
function unavailableIfGitSilent(run: GitRunner): DiffSource | null {
  const probe = run(['rev-parse', '--git-dir']);
  return probe.ok ? null : { kind: 'unavailable', reason: `git が答えませんでした(リポジトリを読めません): ${probe.reason}` };
}

/** 差分を取る。取れなければ `unavailable`(黙って通さない)。 */
function diffOrUnavailable(
  run: GitRunner,
  args: readonly string[],
  base: string,
  notes: readonly string[],
): DiffSource {
  const result = run(args);
  return result.ok
    ? { kind: 'diff', raw: result.stdout, base, notes }
    : { kind: 'unavailable', reason: `git diff が失敗しました(基点 ${base}): ${result.reason}` };
}

/** 基点の表記(未指定・空文字は「(未指定)」)。 */
function baseLabel(given: string | undefined): string {
  return given === undefined || given === '' ? '(未指定)' : given;
}

/**
 * ステージ(pre-commit)の差分を取る。基点は HEAD。
 *
 * @param run git を回す口
 * @returns 3 つの結末のいずれか(HEAD が無い = 最初のコミットは `skip`)
 */
export function stagedDiff(run: GitRunner, roots: ProductRoots): DiffSource {
  const silent = unavailableIfGitSilent(run);
  if (silent !== null) return silent;
  if (!commitExists(run, 'HEAD')) {
    return { kind: 'skip', notes: ['HEAD がありません(最初のコミット)。検査対象なしとして通します'] };
  }
  return diffOrUnavailable(
    run,
    ['diff', '--cached', '--name-status', '-M', '-z', 'HEAD', '--', migrationDir(roots)],
    'HEAD',
    [],
  );
}

/**
 * コミット間(merge-check・CI)の差分を取る。**基点は呼び手が渡す**(merge-check は走り手が旧 main との分岐点を、CI は振り分けの段が決めた基点を渡す)。
 *
 * 基点が使えない 4 つ —— 欠落・空文字・40 桁ゼロ(GitHub が「親が無い」をこう書く)・このクローンに無い(浅いクローン・force push)—— は
 * **`unavailable`(赤)**。以前はここで HEAD~1 に倒していたので、引数なしで呼ぶ段(merge-check の check:migrations)が先端の 1 コミット
 * (いつも台帳のコミット)しか見ず、pre-commit を通らないコミットで適用済みの migration を書き換えても緑だった(fix27 差分点検 6 回目 A6-1・A6-4)。
 *
 * @param run git を回す口
 * @param base 基点の ref
 * @param head 比較先の ref
 * @returns 3 つの結末のいずれか(基点が使えなければ `unavailable`)
 */
export function rangeDiff(
  run: GitRunner,
  base: string | undefined,
  head: string,
  roots: ProductRoots,
): DiffSource {
  const silent = unavailableIfGitSilent(run);
  if (silent !== null) return silent;
  if (base === undefined || base === '' || /^0{40}$/.test(base) || !commitExists(run, base)) {
    return { kind: 'unavailable', reason: `基点 ${baseLabel(base)} が使えません(未指定・空・40 桁の 0・このクローンに無い)。既定の基点(HEAD~1)には倒しません` };
  }
  // 三点(`...`)= 分岐点との差分。PR でも push でも「この変更が持ち込んだ分」だけを見る
  // (ci.yml の changes フィルタと同じ取り方)。
  return diffOrUnavailable(
    run,
    ['diff', '--name-status', '-M', '-z', `${base}...${head}`, '--', migrationDir(roots)],
    base,
    [],
  );
}

/**
 * 引数から差分の取り方を決める(CLI の口。`--staged` か `--base <ref> [--head <ref>]` のどちらかが要る)。
 *
 * どちらも無い呼び出しは `unavailable`(赤)。道具が自分で基点を選ぶ道(引数なしで HEAD~1)を残さない(A6-1)。
 *
 * @param args CLI の引数
 * @param run git を回す口
 * @param roots 製品の根
 */
export function diffSourceOf(args: readonly string[], run: GitRunner, roots: ProductRoots): DiffSource {
  if (args.includes('--staged')) return stagedDiff(run, roots);
  const at = args.indexOf('--base');
  if (at === -1) return { kind: 'unavailable', reason: '基点の指定がありません(--staged か --base <ref> が要る。既定の基点は選びません)' };
  const value = args[at + 1];
  const headAt = args.indexOf('--head');
  const head = headAt === -1 ? 'HEAD' : args[headAt + 1];
  if (head === undefined || head === '' || head.startsWith('--')) return { kind: 'unavailable', reason: '--head の値がありません' };
  return rangeDiff(run, value === undefined || value.startsWith('--') ? undefined : value, head, roots);
}
