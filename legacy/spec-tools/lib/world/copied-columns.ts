/**
 * **祖先の列の写し**(トリガが埋める列)を宣言から解く、ただ 1 本の判定。
 *
 * `{自集約}.{列} == {別の集約}.{列}` は形式としては行内比較(`formal.type: check`)だが、
 * 意味は「この列はあちらの列の写しである」という宣言である。この読み方は 2 か所で要る:
 *
 * | 誰が | 何のために |
 * |---|---|
 * | world の組み立て(`rls-world-derivable.ts`) | 「この列には値を置かない —— トリガが埋めるから」と決める |
 * | 表の DDL(`ddl-copy-triggers.ts`) | 「この列をこう埋める」トリガ関数の本文を出す |
 *
 * **2 つが別々の判定を持つと、置かないのに埋めない列ができる。** それが束 ③-2 の実測で、
 * world は写しの列(親の集約の欄を写す列)に値を置かずに挿入し、埋めるはずのトリガ関数は
 * (`kind: trigger` の本文が生成物でないので)空の DB のどこにも存在しなかった。
 * だから判定はここ 1 本に置き、両方がこれを呼ぶ(PRIN-0007)。
 *
 * **写し元までの道は参照列の連鎖で解く。** 1 段(`child --parent_id--> parent`)が大半だが、
 * 2 段(`leaf --mid_id--> mid --root_id--> root`)もあるので段数は固定
 * しない。道が見つからない・**2 本以上ある**ときは導出できないとして扱う —— どちらの祖先から
 * 写すかは宣言から決まらないので、そこで黙って 1 本を選ばない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { InvariantFormal, SpecModel } from '../model/types.js';
import { findEntityFields } from '../semantics/domain-index.js';
import type { Comparison } from './rls-world-values.js';
import { comparisonsOf } from './rls-world-values.js';

/** 写し元へ向かう 1 段(自分の側の参照列と、その先の集約)。 */
export interface CopyHop {
  /** この段でたどる参照列(1 段目は自表の列、2 段目以降は前の段の集約の列)。 */
  readonly refColumn: string;
  /** たどった先の集約。 */
  readonly entity: string;
}

/** 道が解けなかった理由(値域)。 */
export type CopyPathFailure =
  /** 参照列をたどっても届かない(上限の段数まで探した)。 */
  | 'unreachable'
  /** 同じ長さの道が 2 本以上ある(どちらの祖先から写すか宣言から決まらない)。 */
  | 'ambiguous';

/** 写しとして**宣言されている**が、道が解けなかった列。 */
export interface UnresolvedCopy {
  readonly column: string;
  readonly fromEntity: string;
  readonly fromColumn: string;
  readonly reason: CopyPathFailure;
}

/** 不変条件が宣言した写しの全部(解けたものと、解けなかったもの)。 */
export interface CopyDeclarations {
  readonly resolved: readonly CopiedColumn[];
  /**
   * 写しと**書いてあるのに**道が決まらない列。
   *
   * 黙って落とすと、検査は「機構が宣言されていない」と言い、**書いた人がもう一度
   * 書けと言われる**(独立レビュー ③-3 F-5)。理由つきで返して T15 に別の文言を出させる。
   */
  readonly unresolved: readonly UnresolvedCopy[];
}

/** 写しの列 1 つ(どの列が、どこを辿った、どの列の写しか)。 */
export interface CopiedColumn {
  /** 自集約の側の列(トリガが埋める列)。 */
  readonly column: string;
  /** 写し元の集約。 */
  readonly fromEntity: string;
  /** 写し元の列。 */
  readonly fromColumn: string;
  /** 自集約から写し元までの道(1 段以上)。 */
  readonly path: readonly CopyHop[];
}

/**
 * その不変条件が「祖先の列の写し」と宣言している列を、**解けたものと解けなかったものに分けて**返す。
 *
 * @param domain ドメイン仕様(不変条件の形式定義と参照列の連鎖を引く)
 * @param entity 自集約(**その列を `supplies` に載せた表の集約**であり、これが写し先である)
 * @param invariant トリガが宣言する不変条件 ID(無ければ写しは 1 つも無い)
 * @returns 解けた写しと、宣言はあるが道が決まらない列(どちらも宣言順)
 */
export function copyDeclarationsOf(
  domain: SpecModel,
  entity: string,
  invariant: string | undefined,
): CopyDeclarations {
  const formal = invariant === undefined ? null : formalOf(domain, invariant);
  if (formal?.kind !== 'check') return { resolved: [], unresolved: [] };
  const resolved: CopiedColumn[] = [];
  const unresolved: UnresolvedCopy[] = [];
  for (const node of comparisonsOf(formal.expr)) {
    const pair = copyPair(node, entity);
    if (pair === null || [...resolved, ...unresolved].some((seen) => seen.column === pair.column)) continue;
    const path = pathTo(domain, entity, pair.fromEntity);
    if (path.ok) resolved.push({ ...pair, path: path.path });
    else unresolved.push({ ...pair, reason: path.reason });
  }
  return { resolved, unresolved };
}

/**
 * その不変条件が「祖先の列の写し」と宣言している列のうち、**道まで解けたもの**。
 *
 * @param domain ドメイン仕様
 * @param entity 自集約
 * @param invariant トリガが宣言する不変条件 ID
 * @returns 写しの列(宣言順)。道が解けなかった列は含まれない(理由つきで欲しければ
 *   `copyDeclarationsOf`)
 */
export function copiedColumnsOf(
  domain: SpecModel,
  entity: string,
  invariant: string | undefined,
): readonly CopiedColumn[] {
  return copyDeclarationsOf(domain, entity, invariant).resolved;
}

/** その不変条件の形式定義(集約をまたいで引く)。 */
export function formalOf(domain: SpecModel, id: string): InvariantFormal | null {
  for (const specs of domain.aggregates.values()) {
    const found = specs.invariants?.invariants.find((candidate) => candidate.id === id);
    if (found !== undefined) return found.formal ?? null;
  }
  return null;
}

/** その比較が「自集約の列 == 別の集約の列」なら、両側の列名と相手の集約。 */
function copyPair(
  node: Comparison,
  entity: string,
): { readonly column: string; readonly fromEntity: string; readonly fromColumn: string } | null {
  if (node.op !== '==') return null;
  const sides = [
    { own: ownColumn(node.left, entity), path: node.right },
    { own: ownColumn(node.right, entity), path: node.left },
  ];
  for (const side of sides) {
    const other = pathParts(side.path);
    if (side.own === null || other === null || other.entity === entity) continue;
    return { column: side.own, fromEntity: other.entity, fromColumn: other.column };
  }
  return null;
}

/** そのパスが `{自集約}.{列}` なら列名(そうでなければ null)。 */
function ownColumn(path: Comparison['right'], entity: string): string | null {
  const parts = pathParts(path);
  return parts === null || parts.entity !== entity ? null : parts.column;
}

/** `{集約}.{列}` の 2 段のパスを割る(2 段でなければ null)。 */
function pathParts(path: Comparison['right']): { readonly entity: string; readonly column: string } | null {
  if (path === null || path.segments.length !== 2) return null;
  const [entity, column] = path.segments;
  return entity === undefined || column === undefined ? null : { entity, column };
}

/** 道の探索の結果(解けたか、解けなかった理由か)。 */
type PathResult =
  | { readonly ok: true; readonly path: readonly CopyHop[] }
  | { readonly ok: false; readonly reason: CopyPathFailure };

/**
 * 自集約から目的の集約まで、参照列をたどる**ただ 1 本**の最短路。
 *
 * 同じ長さの道が 2 本以上あれば解かない —— どちらの祖先から写すかは宣言から決まらない。
 * 途中の集約に 2 通りで届く場合も、その先へは進まない(同じ理由である)。
 *
 * @param domain ドメイン仕様
 * @param from 自集約
 * @param to 写し元の集約
 * @returns 道(1 段以上)、または解けなかった理由
 */
function pathTo(domain: SpecModel, from: string, to: string): PathResult {
  let frontier: readonly (readonly CopyHop[])[] = [[]];
  const seen = new Set<string>([from]);
  for (let depth = 0; depth < MAX_COPY_DEPTH && frontier.length > 0; depth += 1) {
    const next = expand(domain, frontier, from, seen);
    const arrived = next.filter((path) => endOf(path) === to);
    if (arrived.length > 1) return { ok: false, reason: 'ambiguous' };
    const only = arrived[0];
    if (only !== undefined) return { ok: true, path: only };
    frontier = unambiguous(next, seen);
  }
  return { ok: false, reason: 'unreachable' };
}

/** いまの道の先から、参照列 1 本ぶん伸ばした道(まだ通っていない集約だけ)。 */
function expand(
  domain: SpecModel,
  frontier: readonly (readonly CopyHop[])[],
  from: string,
  seen: ReadonlySet<string>,
): readonly (readonly CopyHop[])[] {
  const next: (readonly CopyHop[])[] = [];
  for (const path of frontier) {
    for (const field of findEntityFields(domain, endOf(path) ?? from) ?? []) {
      if (field.type.kind !== 'ref' || seen.has(field.type.entity)) continue;
      next.push([...path, { refColumn: field.name, entity: field.type.entity }]);
    }
  }
  return next;
}

/** 1 通りでしか届かなかった道だけを残す(通った集約は `seen` に積む)。 */
function unambiguous(
  next: readonly (readonly CopyHop[])[],
  seen: Set<string>,
): readonly (readonly CopyHop[])[] {
  const counts = new Map<string, number>();
  for (const path of next) {
    const entity = endOf(path);
    if (entity !== undefined) counts.set(entity, (counts.get(entity) ?? 0) + 1);
  }
  for (const entity of counts.keys()) seen.add(entity);
  return next.filter((path) => counts.get(endOf(path) ?? '') === 1);
}

/** その道が届いている集約。 */
function endOf(path: readonly CopyHop[]): string | undefined {
  return path[path.length - 1]?.entity;
}

/** 参照をたどる段数の上限(これ以上深い写しは宣言が読みにくく、実例も無い)。 */
export const MAX_COPY_DEPTH = 4;
