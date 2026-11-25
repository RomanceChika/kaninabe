/**
 * レビューの手引きの「警告の区分(仕組みの拡張候補と未分類)」の節。
 *
 * 検証器の警告は 2 つに分けて管理する。ユーザーの言葉(2026-10-03 午後)は「警告の中にも管理の仕方を分けた方がいい。
 * 仕組みを拡張すれば吸収すべき問題か、仕組みは変えるべきでないが警告になる例外か。同じ扱いだと後々ややこしい」。
 * 前者は**仕組みの宿題**で、台帳(`legacy/spec-tools/extension-candidates.md`)に候補として載る。仕様を読む人は
 * 読まなくてよいので、章の「受け入れ」にも必読の数にも足さない(`finding-placement.ts` の `pendingFindings`)。
 * この節が、候補ごとの言い分・件数・場所を 1 か所に出す。どの候補にも当たらない警告は**未分類**で、
 * まだ通していない受け入れとして章に配られる。
 *
 * 純粋関数だけ。場所はファイルまで(位置は生成物に入れない。`finding-placement.ts` の `pendingLine` と同じ線)。
 */

import type { CandidateHits } from '../../../extension/bucket.js';
import { SCOPES } from '../../../extension/scope.js';
import type { ExtensionCandidate } from '../../../model/extension/types.js';
import type { Finding } from '../../../kernel/finding.js';
import type { ProductRoots } from '../../../model/product/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { cell, markdownTable } from '../../../gen-kit/state-machine-table.js';
import { extensionHits, pendingFindings, pendingLine } from './finding-placement.js';

/** 場所の言い方(検査 ID と仕様の木からの相対パス。同じ組は件数にまとめる。1 組が 1 項目)。 */
export function placesOf(hits: readonly Finding[], roots: ProductRoots): readonly string[] {
  const counts = new Map<string, number>();
  for (const finding of hits) {
    const line = pendingLine(finding, roots);
    const key = `\`${line.id}\` ${line.where}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => (count === 1 ? cell(key) : `${cell(key)}(${count} 件)`));
}

/** 当たる検査の言い方(絞りの鍵があれば、何に絞っているかを添える)。 */
function rulesOf(candidate: ExtensionCandidate): string {
  const rules = candidate.rules.map((rule) => `\`${rule}\``).join('・');
  return candidate.scope === undefined ? rules : `${rules}(${SCOPES[candidate.scope].meaning})`;
}

/** 節の題と小見出し。 */
export const EXTENSION_HEADING = '警告の区分(仕組みの拡張候補と未分類)';
export const EXTENSION_CANDIDATES_HEADING = '仕組みの拡張候補';
export const EXTENSION_UNCLASSIFIED_HEADING = '未分類の警告';

/** 拡張候補の表の見出し。 */
export const CANDIDATE_HEADERS = ['候補', '何が書けない・組めないか', '状態', '当たる検査', '警告', '警告の場所'] as const;

/** 拡張候補の表の 1 行(文は `` `識別子` `` を含む)。 */
export interface CandidateRow {
  readonly id: string;
  readonly statement: string;
  readonly status: string;
  readonly rules: string;
  readonly count: string;
  readonly places: readonly string[];
}

/** 拡張候補の表の行(候補ごとに 1 行)。 */
export function candidateRows(rows: readonly CandidateHits[], roots: ProductRoots): readonly CandidateRow[] {
  return rows.map(({ candidate, hits }) => ({
    id: candidate.id,
    statement: cell(candidate.statement),
    status: candidate.status,
    rules: rulesOf(candidate),
    count: String(hits.length),
    places: placesOf(hits, roots),
  }));
}

/** 拡張候補の表(候補ごとに 1 行)。 */
function candidateTable(rows: readonly CandidateHits[], roots: ProductRoots): string {
  return markdownTable(
    [...CANDIDATE_HEADERS],
    candidateRows(rows, roots).map((row) => [
      `\`${row.id}\``,
      row.statement,
      row.status,
      row.rules,
      row.count,
      row.places.length === 0 ? '—' : row.places.join('<br>'),
    ]),
  );
}

/** 導入の箇条。 */
export const EXTENSION_INTRO: readonly string[] = [
  '- 警告は 2 つに分けて管理する。ユーザーの言葉は「警告の中にも管理の仕方を分けた方がいい。仕組みを拡張すれば吸収すべき問題か、仕組みは変えるべきでないが警告になる例外か。同じ扱いだと後々ややこしい」',
  '- **仕組みの拡張候補** … 仕組みを拡張すれば吸収すべき問題。**仕組みの宿題なので、読まなくてよい**。台帳は `legacy/spec-tools/extension-candidates.md` で、`npm run verify` は警告の行ごとに候補の ID を出す',
  '- **未分類の警告** … どの拡張候補にも当たらない警告。**まだ通していない受け入れ**として数え、各章の「受け入れ」に出る',
  '- **必読に数える受け入れは、既存の宣言で理由をつけて通したものと、未分類の警告**。拡張候補の警告は数えない(読む量の数にも足さない)',
  '- 仕組みは変えるべきでない例外として警告になるものの口は、いまは作らない。作るなら検査ごとの既存の受け入れの形に揃える(1 本の汎用の理由欄は免除リストになる)',
];

/** 候補の節の文言(台帳が読めない・候補が無い・件数)。 */
export const CANDIDATES_UNREADABLE = '台帳が読めなかったので、警告はすべて未分類として数えている';
export const CANDIDATES_NONE = '台帳に拡張候補は載っていない';
export const candidatesLead = (count: number, hits: number): string => `台帳の候補 ${count} 件、当たる警告は合わせて ${hits} 件`;

/** 未分類の節の文言(未集計・無い・件数)。 */
export const UNCLASSIFIED_UNCOUNTED = '未集計(検証の結果が渡されていない)';
export const UNCLASSIFIED_NONE = '未分類の警告は無い';
export const unclassifiedLead = (count: number): string => `未分類の警告は ${count} 件。台帳に候補として載せるか、検査ごとの受け入れの形を作るかを判断する`;

/** 未分類の警告の 1 行(検査 ID・何が・どこで)。 */
export function unclassifiedLines(pending: readonly Finding[], roots: ProductRoots): readonly { readonly id: string; readonly what: string; readonly where: string }[] {
  return pending.map((finding) => {
    const line = pendingLine(finding, roots);
    return { id: line.id, what: line.what, where: line.where };
  });
}

/**
 * 「警告の区分」の節を組み立てる。
 *
 * 台帳が渡されていない文脈(`ctx.extensionLedger` が無い)では節ごと出さない(区分できない = 全部「まだ通して
 * いない受け入れ」として数えているので、別に言うことが無い)。台帳が読めなかった構成は、警告がすべて未分類だと言う。
 *
 * @param ctx 生成コンテキスト
 * @returns 節の行(出さないときは空)
 */
export function extensionSection(ctx: GenerateContext): string[] {
  if (ctx.extensionLedger === undefined) return [];
  const pending = pendingFindings(ctx);
  const rows = extensionHits(ctx);
  const total = rows === null ? 0 : rows.reduce((sum, row) => sum + row.hits.length, 0);
  const candidates =
    rows === null
      ? CANDIDATES_UNREADABLE
      : rows.length === 0
        ? CANDIDATES_NONE
        : [candidatesLead(rows.length, total), candidateTable(rows, ctx.roots)].join('\n\n');
  const unclassified =
    pending === null
      ? UNCLASSIFIED_UNCOUNTED
      : pending.length === 0
        ? UNCLASSIFIED_NONE
        : [
            unclassifiedLead(pending.length),
            unclassifiedLines(pending, ctx.roots)
              .map((line) => `- \`${line.id}\` ${cell(line.what)}(${line.where})`)
              .join('\n'),
          ].join('\n\n');
  return [
    `## ${EXTENSION_HEADING}`,
    EXTENSION_INTRO.join('\n'),
    `### ${EXTENSION_CANDIDATES_HEADING}`,
    candidates,
    `### ${EXTENSION_UNCLASSIFIED_HEADING}`,
    unclassified,
  ];
}
