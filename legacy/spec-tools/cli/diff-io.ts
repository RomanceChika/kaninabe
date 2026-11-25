/**
 * 差分の入口の I/O(git の呼び出し・作業ツリーの読み取り・版の写しの組み立て)。
 *
 * `spec:diff`(`spec-diff.ts`)と、基点つきの `generate`(`generate-docs.ts`。章の「今回変わった」)が
 * **同じ口**を使う。ここが持つのは I/O だけで、何が意味の差かの判定は `lib/diff/**` の純粋関数にある。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { axiomReading } from '../lib/diff/axioms.js';
import { readableFacts, readAxiomFacts } from '../lib/diff/axiom-read.js';
import type { FactTable } from '../lib/diff/facts.js';
import type { GitResult, ReadOutcome, SideReader } from '../lib/diff/git-io.js';
import { commitExists, gitSide, gitSilentReason } from '../lib/diff/git-io.js';
import { axiomSources } from '../lib/diff/axiom-sources.js';
import { labelSources } from '../lib/diff/sources.js';
import type { DiffSource } from '../lib/diff/sources.js';
import type { SideSnapshot } from '../lib/diff/types.js';
import { isDirectory, listEntries } from '../lib/io/paths.js';
import { childEnvOutsideRoot } from '../lib/io/safe-path.js';
import type { ProductRoots } from '../lib/model/product/types.js';
import type { ReadingBase } from '../lib/semantics/reading-change.js';

/** git を回す口(リポジトリルートで実行する)。 */
export type Git = (args: readonly string[]) => GitResult;

/** 失敗の理由を 1 行にする(git の stderr があればその 1 行目)。 */
function failureReason(args: readonly string[], error: unknown): string {
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { readonly stderr?: unknown }).stderr ?? '')
      : '';
  const first = stderr
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (first !== undefined) return first;
  return error instanceof Error ? error.message : `git ${args.join(' ')} が失敗しました`;
}

/** git を回して標準出力を返す口を作る。失敗は理由つきで返す(黙って null にしない)。 */
export function gitIn(repoRoot: string): Git {
  return (args: readonly string[]): GitResult => {
    try {
      const stdout = execFileSync('git', [...args], {
        cwd: repoRoot,
        // PATH から根の中と node_modules を落とす(依存の偽の git を拾わない。9 回目 C9-5)。
        env: childEnvOutsideRoot(process.env, repoRoot),
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, stdout };
    } catch (error) {
      return { ok: false, reason: failureReason(args, error) };
    }
  };
}

/** ファイルが無いことを表す errno(それ以外の失敗は「読めない」であって「無い」ではない)。 */
const MISSING_ERRNO: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/** 例外の errno(取れなければ空文字)。 */
function errnoOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code ?? '')
    : '';
}

/**
 * 作業ツリーを読む口(比較先の既定)。
 *
 * 読めなかった理由を**捨てない** —— `ENOENT`(無い)だけが「その版に無かった」であり、
 * 権限が無い・壊れている・ディレクトリだった等は「判定できない」である。ひとまとめに
 * `absent` へ倒すと、読めないファイルが「消えた」として差分に化ける。
 */
export function worktreeSide(repoRoot: string): SideReader {
  return {
    read: (relative: string): ReadOutcome => {
      try {
        return { kind: 'found', content: readFileSync(path.join(repoRoot, relative), 'utf-8') };
      } catch (error) {
        const errno = errnoOf(error);
        if (MISSING_ERRNO.has(errno)) return { kind: 'absent' };
        return { kind: 'unavailable', reason: `${relative} を読めませんでした: ${errno || String(error)}` };
      }
    },
    list: (dir: string, suffix: string): readonly string[] => {
      const absolute = path.join(repoRoot, dir);
      if (!isDirectory(absolute)) return [];
      return listEntries(absolute)
        .filter((entry) => entry.endsWith(suffix))
        .map((entry) => `${dir}/${entry}`);
    },
  };
}

/** 2 つの版から、読むべきパスの全数を集める(片側にしか無いものも含む)。 */
export function pathsOf(sources: readonly DiffSource[], sides: readonly SideReader[]): readonly string[] {
  const paths = new Set<string>();
  for (const source of sources) {
    if (source.kind === 'file') {
      paths.add(source.path);
      continue;
    }
    for (const side of sides) for (const found of side.list(source.path, source.suffix ?? '')) paths.add(found);
  }
  return [...paths].sort();
}

/** 片側の写しを作る(読めなかったら理由つきで止める)。 */
export function snapshotOf(
  side: SideReader,
  paths: readonly string[],
): { snapshot: Map<string, string | null>; reason: string | null } {
  const snapshot = new Map<string, string | null>();
  for (const relative of paths) {
    const outcome = side.read(relative);
    if (outcome.kind === 'unavailable') return { snapshot, reason: outcome.reason };
    snapshot.set(relative, outcome.kind === 'found' ? outcome.content : null);
  }
  return { snapshot, reason: null };
}

/** 基点つきの読みの結末(読めた / 判定できなかった理由)。 */
export type BaseOutcome =
  | { readonly ok: true; readonly base: ReadingBase; readonly notRead: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * 基点から作業ツリー(の公理の事実)までの、公理の側の差分を出す。
 *
 * 基点側は git の生成物から、比較先は呼び出し側が渡す事実の表(生成の入力の仕様モデルから作ったもの)
 * から読む。比較先を作業ツリーの生成物にしないのは、`generate` の途中では生成物が**まだ古い**から
 * である(仕様を変えたあとの 1 回目の生成で、変えた分が見えなくなる)。
 *
 * @param repoRoot リポジトリルート
 * @param roots 製品が宣言した根
 * @param ref 基点(コミットの参照)
 * @param head 比較先の公理の事実の表
 * @param headRead 比較先で読めた要素(action_spec を読めなかったら、計算の例は比べず `notRead` で報告する)
 * @param headRead.actions action_spec を読めたか
 */
export function readingBaseFrom(
  repoRoot: string,
  roots: ProductRoots,
  ref: string,
  head: FactTable,
  headRead: { readonly actions: boolean },
): BaseOutcome {
  const git = gitIn(repoRoot);
  const silent = gitSilentReason(git);
  if (silent !== null) return { ok: false, reason: silent };
  if (!commitExists(git, ref)) return { ok: false, reason: `基点 ${ref} がこのクローンにありません` };
  const sources = [...axiomSources(roots), ...labelSources(roots)];
  const baseSide = gitSide(git, ref);
  const paths = pathsOf(sources, [baseSide, worktreeSide(repoRoot)]);
  const read = snapshotOf(baseSide, paths);
  if (read.reason !== null) return { ok: false, reason: read.reason };
  const base: SideSnapshot = read.snapshot;
  // 基点側の源が壊れていても「消えた」と数えない(読めなかったことは notRead に分けて返す)。比較先は仕様モデルから作るので読めている。
  const reading = axiomReading(readAxiomFacts(base, roots, 'base'), readableFacts(head), headRead);
  return { ok: true, base: { ref, changes: reading.changes }, notRead: reading.notRead };
}

/** 値の無い `--base` を基点なしと読んだときの警告(「今回変わった」が — のままの理由を残す)。 */
export const BASE_WITHOUT_VALUE_WARNING = '基点なし: --base に値が無いので、今回変わった分は数えません(例: --base HEAD~1)';

/**
 * 基点つきの生成で出す警告の行(標準エラーに 1 行ずつ出す)。
 *
 * 読めなかった・比べなかったものを先に、最後に「この生成物はコミットしない」を添える。
 *
 * @param baseRef 基点
 * @param notRead 比べられなかったもの(`readingBaseFrom` の結果)
 */
export function baseWarnings(baseRef: string, notRead: readonly string[]): readonly string[] {
  return [
    ...notRead.map((line) => `警告: ${line}`),
    `警告: 基点 ${baseRef} つきの生成物はコミットしない(基点なしの npm run generate で元に戻る)`,
  ];
}
