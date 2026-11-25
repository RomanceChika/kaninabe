/**
 * 検証器の警告(`ctx.findings`)を、章のブロックに配る。
 *
 * 警告のうち**未分類**は、まだ通していない受け入れである(機械が疑い、人がまだ理由をつけていない)。
 * 拡張候補に当たるものは仕組みの宿題で、受け入れには数えない(`pendingFindings`)。
 * 検証を先に回して結果を渡すのは `cli/generate-docs.ts` の仕事で(層の表: 生成器は検証器を読まない)、
 * ここは渡された一覧を `場所:` のファイルで配るだけである。配り方は標識と同じ `blockOf`(章 × 節)で、
 * 章の範囲(催しの章のように従属を畳む章)は、範囲の仕様ファイルの集合で引く。
 *
 * 純粋関数だけ。**全文は検証器の出力に任せる** —— 章に出すのは ID・場所(ファイルまで)・対処の 1 行で、
 * 場所が仕様の木の外の警告は ID と件数だけである。
 */

import { bucketOf, hitsByCandidate, type CandidateHits } from '../../../extension/bucket.js';
import type { Finding } from '../../../kernel/finding.js';
import type { SpecModel } from '../../../model/types.js';
import { specPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { blockOf } from './chapter-files.js';
import type { BookLayout } from './face-scope.js';

/**
 * 「まだ通していない受け入れ」に数える警告。検証の結果が渡されていなければ null(0 件とは別)。
 *
 * **警告のうち、拡張候補に当たらないもの(未分類)だけ**を数える。拡張候補は仕組みを拡張すれば吸収される
 * 仕組みの宿題で、仕様を読む人が通す・読む対象ではない(手引きの「仕組みの拡張候補」の節が別に出す)。
 * 台帳が渡されていなければ区分できないので、警告はすべて数える。
 */
export function pendingFindings(ctx: GenerateContext): readonly Finding[] | null {
  if (ctx.findings === undefined) return null;
  const ledger = ctx.extensionLedger === undefined ? undefined : ctx.extensionLedger.ledger;
  return ctx.findings.filter(
    (finding) => finding.severity === 'warning' && (ledger === undefined || bucketOf(finding, ledger)?.kind === 'unclassified'),
  );
}

/**
 * 拡張候補ごとの、当たる警告(台帳の宣言順)。検証の結果か台帳が渡されていなければ null。
 *
 * @param ctx 生成コンテキスト
 */
export function extensionHits(ctx: GenerateContext): readonly CandidateHits[] | null {
  const ledger = ctx.extensionLedger?.ledger;
  if (ctx.findings === undefined || ledger === undefined || ledger === null) return null;
  return hitsByCandidate(ctx.findings, ledger);
}

/** ファイルの集合に属する警告。 */
export function pendingInFiles(findings: readonly Finding[], files: ReadonlySet<string>): readonly Finding[] {
  return findings.filter((finding) => files.has(finding.location.file));
}

/** ある章のブロックに配られる警告(`blockOf` が章を引けたもの)。 */
export function pendingOfChapter(
  findings: readonly Finding[],
  model: SpecModel,
  roots: ProductRoots,
  chapterFile: string,
  layout?: BookLayout,
): readonly Finding[] {
  return findings.filter((finding) => blockOf(finding.location.file, model, roots, layout)?.chapter === chapterFile);
}

/** どの章のブロックにも配れない警告(場所が仕様の木の外・割り付けの無いファイル)。 */
export function unplacedFindings(
  findings: readonly Finding[],
  model: SpecModel,
  roots: ProductRoots,
  layout?: BookLayout,
): readonly Finding[] {
  return findings.filter((finding) => blockOf(finding.location.file, model, roots, layout) === null);
}

/** 文字列を `max` 字で切る(切ったら省略の印)。 */
export function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`;
}

/** 文の最初の 1 文(句点まで。無ければ全体)。 */
function firstSentence(text: string): string {
  const end = text.indexOf('。');
  return end === -1 ? text : text.slice(0, end);
}

/** 警告 1 件を章に出す 3 つの部品(何を・どこで・対処)。 */
export interface PendingLine {
  /** 検証器 ID。 */
  readonly id: string;
  /** 何が(メッセージの頭)。 */
  readonly what: string;
  /** どこで(仕様の木からの相対パス。ファイルの名指しまでで、行や論理位置は載せない)。 */
  readonly where: string;
  /** どう直すか(対処の最初の 1 文)。 */
  readonly fix: string;
}

/**
 * 警告 1 件を 1 行の部品にする。全文は検証器の出力に任せるので、ここでは切る。
 *
 * **場所はファイルの名指しまで**で、行や論理位置(`finding.location.pointer`)は載せない。位置は
 * コードやファイルの 1 行の変更で動くので、生成物に入れると、検証の対象を直しただけで
 * `generate:check` が赤になる(位置は `npm run verify` の出力が持つ)。
 *
 * @param finding 警告
 * @param roots 製品が宣言した根(仕様の木からの相対パスにする)
 */
export function pendingLine(finding: Finding, roots: ProductRoots): PendingLine {
  const prefix = `${specPath(roots)}/`;
  const file = finding.location.file.startsWith(prefix) ? finding.location.file.slice(prefix.length) : finding.location.file;
  return {
    id: finding.verifier,
    what: clip(finding.message, 80),
    where: file,
    fix: clip(firstSentence(finding.suggestion), 80),
  };
}

/** 配れない警告の ID ごとの件数(ID の昇順)。文面も場所も載せない。 */
export function unplacedCounts(findings: readonly Finding[]): ReadonlyArray<{ readonly id: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.verifier, (counts.get(finding.verifier) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({ id, count }));
}
