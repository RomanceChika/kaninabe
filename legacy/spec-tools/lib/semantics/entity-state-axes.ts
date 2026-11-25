/**
 * U 群がドメイン仕様に問い合わせる 2 つのこと(状態の空間・条件つき規則がその状態で効くか)をまとめた
 * 純粋モジュール。確認が要る操作は意味解析の層の導出を読む(`confirm.ts`)。
 *
 * `lib/semantics/action-ground.ts` が「書かれた操作 ID が何に接地するか」を引くのに対し、
 * ここが引くのは**その操作・その規則が状態にどう依存するか**である。
 * U4 / U5 が「状態ごとに」数えられるのは、この 2 つが宣言から決まるからにほかならない。
 *
 * **ドメインの状態の軸の照会**で、画面にも UX 経験則にもユースケースにも属さない共有の事実である
 * (読み手: `state-admit`・`ux/actions`・`ux/verifiers/u5`・`usecase/verifiers/y1`。かつては
 * `lib/ux/lookup.ts` にいて、画面の検査が UX の置き場を読んでいた。設計メモ framework-modules §13)。
 */

import type { SpecModel, StateMachineSpec } from '../model/types.js';
import type { DomainEnv, GuardServices } from '../guard/ast.js';
import { buildAggregateEnv } from '../semantics/domain-env.js';

/** エンティティの状態の軸 1 本(直交する状態フィールドは複数ありうる)。 */
export interface EntityStateAxis {
  /** 状態フィールドの名前(`when: state == draft` の左辺)。 */
  readonly stateField: string;
  /** そのフィールドが指す状態機械。 */
  readonly machine: StateMachineSpec;
}

/** エンティティを状態の側から見たもの(U4 / U5 が状態ごとに数えるために使う)。 */
export interface EntityStateView {
  /** SpecModel.aggregates のキー(ガード式の環境を作るのに要る)。 */
  readonly aggregate: string;
  /**
   * 状態の軸(宣言順)。空なら状態を持たないエンティティ(member / program_item)。
   *
   * **直交する軸は複数ある**(催しは進行 `state` と掲載 `publication_state` の 2 本)。
   * 1 本目だけを見ると、別の軸の条件をその軸の状態に対して評価することになり、
   * 「どの状態でも規則が効く」という誤った上界が出る(E5 で実測した穴)。
   */
  readonly axes: readonly EntityStateAxis[];
}

/**
 * エンティティ名(または集約名)から状態の空間を引く。
 *
 * 状態フィールドは entity_spec の `state(...)` 型のフィールドから決まる。フィールド名を
 * `state` に決め打たないのは、直交する状態フィールドを持つ集約があるためである。
 *
 * @param domain ドメイン仕様全体
 * @param entity エンティティ名または集約名
 * @returns 状態の空間。そのエンティティ自体が無ければ null
 */
export function entityStateView(domain: SpecModel, entity: string): EntityStateView | null {
  for (const [aggregate, specs] of domain.aggregates) {
    const name = specs.access?.entity ?? specs.entity?.entity;
    if (name !== entity && aggregate !== entity) continue;
    const axes: EntityStateAxis[] = [];
    for (const field of specs.entity?.fields ?? []) {
      const type = field.type;
      if (type.kind !== 'state') continue;
      const machine = specs.stateMachines.find((candidate) => candidate.machine === type.machine);
      if (machine === undefined) continue;
      axes.push({ stateField: field.name, machine });
    }
    return { aggregate, axes };
  }
  return null;
}

/**
 * 条件群がどの状態の軸を参照しているかを決める。
 *
 * **参照していない軸で数えない**のがこの関数の役目である。`when: state in [draft, accepting]`
 * を掲載の軸(`publication_state`)の状態に対して評価すると、変数が食い違うので
 * 「どの状態でも成立する」になり、U 群の状態ごとの絞り込みが効かなくなる。
 *
 * @param view 対象エンティティの状態の空間
 * @param whens 規則の条件(省略された条件は軸を参照しない)
 * @param guards ガード式の共有サービス
 * @returns 参照されている軸。どの軸にも触れていなければ null
 */
export function axisReferencedBy(
  view: EntityStateView,
  whens: readonly (string | undefined)[],
  guards: GuardServices,
): EntityStateAxis | null {
  const referenced = new Set<string>();
  for (const when of whens) {
    if (when === undefined) continue;
    const parsed = guards.parse(when);
    if (!parsed.ok) continue;
    for (const path of guards.collectPaths(parsed.expr)) {
      const last = path.segments[path.segments.length - 1];
      if (last !== undefined) referenced.add(last);
    }
  }
  return view.axes.find((axis) => referenced.has(axis.stateField)) ?? null;
}

/** 状態を固定したうえで `when` 条件を評価する器(集約ごとに 1 つ作って使い回す)。 */
export interface StateScope {
  /**
   * その `when` 条件が、指定した状態と両立し得るか。
   *
   * 条件が無ければ常に true。**判定できない条件も true** にする — U 群は
   * 「同時に並びうる最大数」を数える上界の評価であり、迷ったら数える側に倒す
   * (数え落とすと警告が出ず、経験則の検査そのものが無かったことになる)。
   *
   * @param when access_spec の規則の条件(省略可)
   * @param state 固定する状態 ID
   */
  appliesIn(when: string | undefined, state: string): boolean;
}

/**
 * 集約 1 つ分の条件評価器を作る。
 *
 * `state == draft` のような条件は「その状態のときだけ規則が効く」という宣言であり、
 * ガード式の共存判定(V8 が決定性に使うのと同じ判定)をそのまま流用できる。
 * 自前で `state == X` を読み取る小さなパーサーを書くと、文法の正が 2 つになる。
 *
 * @param domain ドメイン仕様全体
 * @param guards ガード式の共有サービス
 * @param aggregate 対象エンティティが属する集約名
 * @param stateField 固定する状態の軸(entity_spec の `state(...)` 型フィールド名)
 * @returns 条件評価器
 */
export function createStateScope(
  domain: SpecModel,
  guards: GuardServices,
  aggregate: string,
  stateField: string,
): StateScope {
  const env: DomainEnv = buildAggregateEnv(domain, aggregate);

  return {
    appliesIn(when: string | undefined, state: string): boolean {
      if (when === undefined) return true;
      const parsed = guards.parse(when);
      // 壊れた条件は V 群がエラーにする。ここで数え落とすと指摘が静かに消える。
      if (!parsed.ok) return true;
      const fixed = guards.parse(`${stateField} == ${state}`);
      if (!fixed.ok) return true;
      return guards.canCoexist(parsed.expr, fixed.expr, env).coexists;
    },
  };
}
