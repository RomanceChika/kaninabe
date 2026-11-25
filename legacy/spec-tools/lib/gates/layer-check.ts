/**
 * 層の表(`lib-layers.ts`)を import グラフ(`import-graph.ts`)に当てて、違反を数える判定部。
 *
 * 見るのは 9 つ。
 *
 * 1. **未割り付け** … 表のどの行にも当たらないファイル(黙って層の外に置かない)
 * 2. **向き** … 下の層が上の層を(型も含めて)import している辺。同じ順位の別の層(`check` と `emit`)の
 *    相互 import も違反
 * 3. **値の循環** … 実行時の辺だけで作るファイル単位の循環(基線を持たない = 常に 0)
 * 4. **`fs` の入口** … `node:fs` などを、宣言された入口(`IO_ROWS`)でないファイルが import している
 * 5. **木の外・解けない import** … 母集合(`lib/` と `cli/`)の外を読む、または実体の無い相対 import
 * 6. **値の閉包の禁止** … ある置き場の**実行時の依存の閉包**に、入ってはいけない置き場がある(`CLOSURE_BANS`)。
 *    層の向き(下が上を読まない)は同じ層の中や下向きの辺を止めないので、「人向けの本が SQL の生成器を道連れにしない」
 *    のような**部分利用の約束**は向きでは守れない。入ってしまう辺(閉包の外 → 禁止の置き場)を 1 本ずつ違反にする
 * 7. **入口の外からの深い import** … 公開の入口を持つ置き場(`LAYER_ENTRANCES`)の中のファイルを、置き場の**外**から
 *    入口のファイル以外で読んでいる(型だけの import も。置き場の中どうしは自由)。入口のファイルが実在しない置き場も赤
 *
 * 8. **後段への辺** … 差し替えうる後段の置き場(`TARGET_BOUNDARIES` = `lib/targets/<後段>/`)を、組み立ての根以外のファイル
 *    (コアの層・ほかの後段)が import している辺(型だけの import も)。後段の中どうしは見ない。**後段は必ずディレクトリ**で、
 *    置き場の直下に置いたファイルはどの後段にも属さず辺の境界をすり抜けるので、直下のファイルがあれば赤(`looseTargetFiles`)
 *
 * 9. **辺の禁止** … 層の向きが許す辺のうち、置き場の約束として読ませない辺(`EDGE_BANS`。例: 検査の束ね役 → 後段の登録の契約)。
 *    閉包の禁止と違って**直接の辺だけ**を、**型だけの import も含めて**数える
 *
 * 向き・`fs`・木の外・閉包・入口・後段・辺の禁止の違反は `違反の鍵`(`読む側 → 読まれる側`。1 行 1 違反)に畳み、移行中は
 * 基線(テストの隣の JSON)と突き合わせる。判定は純関数で、ファイルシステムは読まない。
 */

import { buildImportGraph, isRuntimeEdge, valueCycles } from '../semantics/import-graph.js';
import type { ImportEdge, ImportGraph } from '../semantics/import-graph.js';
import type { ClosureBan, EdgeBan, IoRow, LayerEntrance, LayerRow, TargetBoundary } from './lib-layers.js';

/** 判定に使う表一式。 */
export interface LayerTable {
  readonly rank: Readonly<Record<string, number>>;
  readonly rows: readonly LayerRow[];
  readonly ioRows: readonly IoRow[];
  readonly ioModules: ReadonlySet<string>;
  /** 母集合の根の綴り(`lib/`。`cli/` も見るなら配列)。 */
  readonly rootPrefix: string | readonly string[];
  /** 値の閉包の禁止(無ければ見ない)。 */
  readonly closureBans?: readonly ClosureBan[];
  /** 公開の入口の宣言(無ければ見ない)。 */
  readonly entrances?: readonly LayerEntrance[];
  /** 後段の置き場の境界(無ければ見ない)。 */
  readonly targets?: readonly TargetBoundary[];
  /** 辺の禁止(無ければ見ない)。 */
  readonly edgeBans?: readonly EdgeBan[];
}

/** 違反 1 件。 */
export interface LayerViolation {
  /** 基線に載る 1 行(`読む側 → 読まれる側`)。 */
  readonly key: string;
  readonly category: 'layer' | 'fs' | 'outside' | 'closure' | 'entrance' | 'target' | 'edge';
  /** 人が読む説明(どの層からどの層へ・何行目・どの種類の import か)。 */
  readonly detail: string;
  /** 辺のうち 1 本でも実行時に効くか(`type` だけなら false)。 */
  readonly runtime: boolean;
}

/** 判定の結果。 */
export interface LayerReport {
  readonly graph: ImportGraph;
  /** 層の表に当たらないファイル。 */
  readonly unassigned: readonly string[];
  /** 違反(鍵の昇順。同じ鍵の辺は 1 件に畳む)。 */
  readonly violations: readonly LayerViolation[];
  /** 値の循環(ファイルの昇順の一覧)。 */
  readonly cycles: readonly (readonly string[])[];
  /** 実体の無い相対 import(`読む側 → 指定子`)。 */
  readonly unresolved: readonly string[];
  /** 入口のファイルが実在しない置き場(`置き場 → 入口`。空でなければ入口を作る)。 */
  readonly missingEntrances: readonly string[];
  /** 後段の置き場の直下に置かれたファイル(後段は必ずディレクトリ。空でなければディレクトリの下へ移す)。 */
  readonly looseTargetFiles: readonly string[];
}

/** 表そのものの不備(順位の無い層を宣言する行)。空でなければ表が壊れている。 */
export function tableProblems(table: LayerTable): readonly string[] {
  return table.rows
    .filter((row) => table.rank[row.layer] === undefined)
    .map((row) => `${String(row.pattern)} が順位の無い層 "${row.layer}" を宣言しています`);
}

/** ファイルが当たる層(当たらなければ null)。 */
export function layerOf(file: string, table: LayerTable): string | null {
  return table.rows.find((row) => row.pattern.test(file))?.layer ?? null;
}

/** ファイルが `fs` の入口として宣言されているか。 */
function isIoEntrance(file: string, table: LayerTable): boolean {
  return table.ioRows.some((row) => row.pattern.test(file));
}

/** `node:fs` → `fs`(`node:` の有無を揃える)。 */
function bareModule(specifier: string): string {
  return specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
}

/** 辺 1 本ぶんの違反(同じ鍵の辺はあとで畳む)。 */
interface RawViolation {
  readonly key: string;
  readonly category: LayerViolation['category'];
  readonly edge: ImportEdge;
  readonly note: string;
}

/**
 * 値の閉包の禁止を辺に落とす。
 *
 * 起点(`from` に当たるファイル)から**実行時の辺**だけをたどり、禁止の置き場(`banned`)へ**入る辺**を
 * 1 本ずつ違反にする。禁止の置き場の先はたどらない(入った時点で違反なので、先まで数えると同じ原因が
 * 何十本にも増える)。辺ごとに違反にするのは、直す場所(その辺を切る・読まれる側を動かす)が辺だからである。
 */
function closureEntries(graph: ImportGraph, bans: readonly ClosureBan[]): readonly RawViolation[] {
  const next = new Map<string, ImportEdge[]>();
  for (const edge of graph.edges) if (isRuntimeEdge(edge)) next.set(edge.from, [...(next.get(edge.from) ?? []), edge]);
  return bans.flatMap((ban) => {
    const parent = new Map<string, string | null>(graph.files.filter((file) => ban.from.test(file)).map((file) => [file, null]));
    const queue = [...parent.keys()];
    const found: RawViolation[] = [];
    for (let at = 0; at < queue.length; at += 1) {
      const file = queue[at] ?? '';
      for (const edge of next.get(file) ?? []) {
        if (ban.banned.test(edge.to)) {
          found.push({ key: `${edge.from} → ${edge.to}`, category: 'closure', edge, note: `${ban.reason}(経路: ${routeOf(parent, file)})` });
        } else if (!parent.has(edge.to)) {
          parent.set(edge.to, file);
          queue.push(edge.to);
        }
      }
    }
    return found;
  });
}

/** 入口の宣言のうち、ファイルが当たるもの(置き場の接頭辞と、解いた入口のパス)。当たらなければ null。 */
function entranceOf(file: string, entrances: readonly LayerEntrance[]): { readonly entrance: LayerEntrance; readonly prefix: string; readonly entries: readonly string[] } | null {
  for (const entrance of entrances) {
    const match = entrance.inside.exec(file);
    if (match !== null) return { entrance, prefix: match[0], entries: entrance.entries.map((entry) => entry.replace('$1', match[1] ?? '')) };
  }
  return null;
}

/**
 * 入口の外からの深い import を辺に落とす。置き場の**外**のファイルが、置き場の中の入口でないファイルを読む辺を
 * 1 本ずつ違反にする(型だけの import・`export … from`・動的 import も同じ。置き場の中どうしは見ない)。
 */
function entranceEntries(graph: ImportGraph, entrances: readonly LayerEntrance[]): readonly RawViolation[] {
  return graph.edges.flatMap((edge): RawViolation[] => {
    const hit = entranceOf(edge.to, entrances);
    if (hit === null || edge.from.startsWith(hit.prefix) || hit.entries.includes(edge.to)) return [];
    return [{ key: `${edge.from} → ${edge.to}`, category: 'entrance', edge, note: `${hit.entrance.reason}(入口は ${hit.entries.join(' か ')})` }];
  });
}

/**
 * 後段への辺を違反にする。後段の置き場(`inside`)の**外**のファイルが、根(`roots`)でないのに後段を読む辺を
 * 1 本ずつ違反にする(型だけの import・`export … from`・動的 import も同じ。同じ後段の中どうしは見ない)。
 */
function targetEntries(graph: ImportGraph, boundaries: readonly TargetBoundary[]): readonly RawViolation[] {
  return graph.edges.flatMap((edge): RawViolation[] =>
    boundaries.flatMap((boundary): RawViolation[] => {
      const to = boundary.inside.exec(edge.to);
      if (to === null || edge.from.startsWith(to[0]) || boundary.roots.test(edge.from)) return [];
      return [{ key: `${edge.from} → ${edge.to}`, category: 'target', edge, note: boundary.reason }];
    }),
  );
}

/** 辺の禁止を違反にする。読む側(`from`)から行き先(`banned`)への直接の辺を、型だけの import も含めて 1 本ずつ違反にする。 */
function edgeBanEntries(graph: ImportGraph, bans: readonly EdgeBan[]): readonly RawViolation[] {
  return graph.edges.flatMap((edge): RawViolation[] =>
    bans.filter((ban) => ban.from.test(edge.from) && ban.banned.test(edge.to)).map((ban) => ({ key: `${edge.from} → ${edge.to}`, category: 'edge', edge, note: ban.reason })),
  );
}

/** 入口のファイルが実在しない置き場(`置き場 → 入口`。置き場ごとに 1 行)。 */
function missingEntrances(graph: ImportGraph, entrances: readonly LayerEntrance[]): readonly string[] {
  const missing = new Set<string>();
  const files = new Set(graph.files);
  for (const file of graph.files) {
    const hit = entranceOf(file, entrances);
    if (hit === null) continue;
    for (const entry of hit.entries) if (!files.has(entry)) missing.add(`${hit.prefix} → ${entry}`);
  }
  return [...missing].sort();
}

/** 起点から `file` までの経路(`起点 → … → file`)。 */
function routeOf(parent: ReadonlyMap<string, string | null>, file: string): string {
  const chain: string[] = [];
  for (let cursor: string | null | undefined = file; cursor !== null && cursor !== undefined; cursor = parent.get(cursor)) chain.unshift(cursor);
  return chain.join(' → ');
}

/** 違反の鍵ごとに辺を畳んで説明を作る。 */
function fold(entries: readonly RawViolation[]): readonly LayerViolation[] {
  const byKey = new Map<string, readonly RawViolation[]>();
  for (const entry of entries) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  return [...byKey.keys()].sort().map((key) => {
    const group = byKey.get(key) ?? [];
    // 同じ辺が後段への辺でもあるときは、そちらを主にする(層の向きの違反と同じ鍵に畳まれて隠れないように)。
    const first = group.find((entry) => entry.category === 'target') ?? group[0];
    const places = group.map((entry) => `${entry.edge.line}行目(${entry.edge.kind})`).join('・');
    return {
      key,
      category: first?.category ?? 'layer',
      detail: `${first?.note ?? ''} ${places}`.trim(),
      runtime: group.some((entry) => isRuntimeEdge(entry.edge)),
    };
  });
}

/**
 * 写しの全ファイルに層の表を当てる。
 *
 * @param sources `lib/` 始まりの相対パス → 本文
 * @param table 層の表一式
 * @returns 未割り付け・違反・値の循環・解けない import
 */
export function checkLayering(sources: ReadonlyMap<string, string>, table: LayerTable): LayerReport {
  const graph = buildImportGraph(sources, table.rootPrefix);
  const unassigned = graph.files.filter((file) => layerOf(file, table) === null);
  const entries: RawViolation[] = [];
  for (const edge of graph.edges) {
    const from = layerOf(edge.from, table);
    const to = layerOf(edge.to, table);
    if (from === null || to === null || from === to) continue;
    const fromRank = table.rank[from] ?? 0;
    const toRank = table.rank[to] ?? 0;
    if (fromRank > toRank) continue;
    const sameRank = fromRank === toRank;
    entries.push({
      key: `${edge.from} → ${edge.to}`,
      category: 'layer',
      edge,
      note: `${from} → ${to}(${sameRank ? '同じ順位の別の層は互いを読まない' : '下の層が上の層を読んでいる'})`,
    });
  }
  for (const edge of graph.external) {
    if (edge.kind === 'type' || !table.ioModules.has(bareModule(edge.to)) || isIoEntrance(edge.from, table)) continue;
    entries.push({ key: `${edge.from} → ${edge.to}`, category: 'fs', edge, note: '`fs` の入口として宣言されていないファイルが I/O を import している' });
  }
  for (const edge of graph.outside) {
    entries.push({ key: `${edge.from} → ${edge.to}`, category: 'outside', edge, note: '母集合(`lib/` と `cli/`)の外(テストなど)を読んでいる' });
  }
  entries.push(...closureEntries(graph, table.closureBans ?? []));
  entries.push(...entranceEntries(graph, table.entrances ?? []));
  entries.push(...targetEntries(graph, table.targets ?? []));
  entries.push(...edgeBanEntries(graph, table.edgeBans ?? []));
  return {
    graph,
    unassigned,
    violations: fold(entries),
    cycles: valueCycles(graph),
    unresolved: graph.unresolved.map((edge) => `${edge.from} → ${edge.to}`),
    missingEntrances: missingEntrances(graph, table.entrances ?? []),
    looseTargetFiles: graph.files.filter((file) => (table.targets ?? []).some((boundary) => boundary.loose.test(file))),
  };
}

/** 基線との突き合わせの結果。 */
export interface BaselineDiff {
  /** 基線に無いのに現物にある違反(増えた)。 */
  readonly added: readonly string[];
  /** 基線にあるのに現物に無い違反(減らし忘れ。基線を更新する)。 */
  readonly removed: readonly string[];
}

/**
 * 違反の鍵を基線と突き合わせる。
 *
 * @param keys 現物の違反の鍵
 * @param baseline 基線(1 行 1 違反)
 * @returns 増えたもの・減ったもの(どちらも昇順)
 */
export function diffBaseline(keys: readonly string[], baseline: readonly string[]): BaselineDiff {
  const current = new Set(keys);
  const fixed = new Set(baseline);
  return {
    added: [...current].filter((key) => !fixed.has(key)).sort(),
    removed: [...fixed].filter((key) => !current.has(key)).sort(),
  };
}
