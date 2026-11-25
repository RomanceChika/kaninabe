/**
 * パッケージの候補の表(`package-candidates.ts`)を import グラフに当てて、候補間の向きの逆流を数える判定部。
 *
 * 見るのは 4 つ。
 *
 * 1. **未割り付け** … 表のどの行にも当たらないファイル
 * 2. **逆流** … 下の候補のファイルが、上の候補のファイルを import している辺(`import type` も数える。型で借りても配布の依存になる)
 * 3. **同順位の相互参照** … 同じ順位の別の候補どうしの辺(いまの住人は `targets` 1 つだけなので空振りだが、順位を足した日に効く)
 *
 * 4. **SQL を書き出す生成器の名指しの腐り**(`dbGeneratorProblems`) … 名指し(`DB_GENERATOR_FILES`)に載っているのに、`lib/sql/**` を値で読まず、
 *    しかも `lib/sql/**` を値で読む名指しの生成器にも読まれていないファイル。名指しの**登録漏れ**(新しい SQL の生成器を足したのに載せない)は、
 *    候補をまたぐ辺 `gen → db` を名指しで固定する構造テストが見る(載せ忘れると `gen` に数えられ、`lib/sql/**` を読む辺が増えて赤になる)
 *
 * 違反は辺 1 本ずつで、**基線を持たない**。判定は純関数で、ファイルシステムは読まない。
 */

import { buildImportGraph, isRuntimeEdge } from '../semantics/import-graph.js';
import type { ImportEdge } from '../semantics/import-graph.js';
import type { CandidateRow } from './package-candidates.js';

/** 判定に使う表一式。 */
export interface CandidateTable {
  readonly rank: Readonly<Record<string, number>>;
  readonly rows: readonly CandidateRow[];
  /** 母集合の根の綴り(`['lib/', 'cli/']`)。 */
  readonly rootPrefix: string | readonly string[];
}

/** 違反 1 件(辺 1 本)。 */
export interface CandidateViolation {
  /** `読む側 → 読まれる側`。 */
  readonly key: string;
  readonly fromCandidate: string;
  readonly toCandidate: string;
  readonly edge: ImportEdge;
  /** 人が読む説明。 */
  readonly detail: string;
}

/** 判定の結果。 */
export interface CandidateReport {
  /** 表に当たらないファイル。 */
  readonly unassigned: readonly string[];
  /** 逆流・同順位の相互参照(鍵の昇順)。 */
  readonly violations: readonly CandidateViolation[];
  /** 候補をまたぐ辺の本数(`読む側の候補 → 読まれる側の候補`)。表の見え方を測る材料。 */
  readonly crossings: ReadonlyMap<string, number>;
  /** 候補をまたぐ辺の `読む側のファイル → 読まれる側のファイル`(`crossings` と同じ鍵。ファイルの組で畳む。昇順)。 */
  readonly crossingFiles: ReadonlyMap<string, readonly string[]>;
  /** 候補ごとのファイル数。 */
  readonly sizes: ReadonlyMap<string, number>;
}

/** 表そのものの不備(順位の無い候補を宣言する行)。 */
export function candidateTableProblems(table: CandidateTable): readonly string[] {
  return table.rows.filter((row) => table.rank[row.candidate] === undefined).map((row) => `${String(row.pattern)} が順位の無い候補 "${row.candidate}" を宣言しています`);
}

/** ファイルが当たる候補(当たらなければ null)。 */
export function candidateOf(file: string, table: CandidateTable): string | null {
  return table.rows.find((row) => row.pattern.test(file))?.candidate ?? null;
}

/**
 * 写しの全ファイルに候補の表を当てる。
 *
 * @param sources `lib/` / `cli/` 始まりの相対パス → 本文
 * @param table 候補の表一式
 */
export function checkCandidates(sources: ReadonlyMap<string, string>, table: CandidateTable): CandidateReport {
  const graph = buildImportGraph(sources, table.rootPrefix);
  const unassigned = graph.files.filter((file) => candidateOf(file, table) === null);
  const sizes = new Map<string, number>();
  for (const file of graph.files) {
    const candidate = candidateOf(file, table);
    if (candidate !== null) sizes.set(candidate, (sizes.get(candidate) ?? 0) + 1);
  }
  const crossings = new Map<string, number>();
  const crossingFiles = new Map<string, Set<string>>();
  const found: CandidateViolation[] = [];
  for (const edge of graph.edges) {
    const from = candidateOf(edge.from, table);
    const to = candidateOf(edge.to, table);
    if (from === null || to === null || from === to) continue;
    const pair = `${from} → ${to}`;
    crossings.set(pair, (crossings.get(pair) ?? 0) + 1);
    crossingFiles.set(pair, (crossingFiles.get(pair) ?? new Set<string>()).add(`${edge.from} → ${edge.to}`));
    const fromRank = table.rank[from] ?? 0;
    const toRank = table.rank[to] ?? 0;
    if (fromRank > toRank) continue;
    found.push({
      key: `${edge.from} → ${edge.to}`,
      fromCandidate: from,
      toCandidate: to,
      edge,
      detail: `${from} → ${to}(${fromRank === toRank ? '同じ順位の別の候補は互いを読まない' : '下の候補が上の候補を読んでいる'}) ${edge.line}行目(${edge.kind})`,
    });
  }
  const folded = new Map([...crossingFiles].map(([pair, set]) => [pair, [...set].sort()]));
  return { unassigned, violations: found.sort((left, right) => left.key.localeCompare(right.key)), crossings, crossingFiles: folded, sizes };
}

/**
 * SQL を書き出す生成器の名指し(`DB_GENERATOR_FILES`)の腐りを数える。名指しの各ファイルは次のどちらかでなければならない。
 *
 * - `lib/sql/**` を**値で**(型だけの import を除く)読む(SQL を書き出す本体)
 * - `lib/sql/**` を値で読む名指しのファイルに**値で読まれる**(本体の字面を分けた補助。例: 期待表の型の字面)
 *
 * どちらでもないものは、SQL を書き出す側の持ち物ではなくなっている(`gen` に戻す・名指しから消す)。
 *
 * @param sources `lib/` / `cli/` 始まりの相対パス → 本文
 * @param names 名指しの生成器(`lib/generate/render/` の下のファイル名。拡張子なし)
 * @param rootPrefix 母集合の根の綴り
 * @returns 名指しのうち、どちらでもないファイル(昇順)
 */
export function dbGeneratorProblems(sources: ReadonlyMap<string, string>, names: readonly string[], rootPrefix: string | readonly string[]): readonly string[] {
  const listed = new Set(names.map((name) => `lib/generate/render/${name}.ts`));
  const edges = buildImportGraph(sources, rootPrefix).edges.filter(isRuntimeEdge);
  const readsSql = new Set(edges.filter((edge) => listed.has(edge.from) && edge.to.startsWith('lib/sql/')).map((edge) => edge.from));
  const helpers = new Set(edges.filter((edge) => readsSql.has(edge.from) && listed.has(edge.to)).map((edge) => edge.to));
  return [...listed].filter((file) => !readsSql.has(file) && !helpers.has(file)).sort();
}
