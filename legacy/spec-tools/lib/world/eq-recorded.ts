/**
 * 状態ごとの「**遷移が書き留めた欄**の姿」(`records_actor` / `records_time`)。
 *
 * ## なぜ設計図がこれを運ぶのか
 *
 * 一致の証明は組み合わせを 1 つ実行するたびに**対象の行を置き直す** —— 状態の欄をその組み合わせの
 * 値にして、ガード変数の境界値を置く(`@kaninabe/runtime/testing/equivalence/place`)。置き直しは行の値を**宣言から**作るので、
 * 「状態 ⇔ 欄の有無」を結びつける不変条件を守れなかった —— 状態だけを `archived` に動かして、
 * その状態が要求する時刻の欄を空のままにする、という行を作っていた(実測: 執行点を生やした
 * 瞬間に置き直しそのものが制約違反で落ちた。docs/design/check-generation.md §4-b の ①)。
 *
 * 守れる範囲はここで決まる —— **`records_actor` / `records_time` が「その状態に入る遷移が
 * この欄を書く」と宣言している**のだから、その状態の行にはその欄がある。逆に、その状態へ入る
 * 遷移が `clears` でその欄を空にすると宣言していれば空である。どちらも宣言に書いてあることの
 * 写しであり、ここが新しい判断をすることは無い。
 *
 * ## 空に戻す列も並べる
 *
 * 「その状態では空」も**明示して並べる**。置き直しは前の組み合わせが置いた値の上に重なるので、
 * 並べないと `archived` を実行した後の `drafting` に時刻が残る(同じ行を使い回すのが置き直しの
 * 前提である)。
 *
 * ## 残差
 *
 * 時刻に置く値は固定である(`RECORDED_AT`)—— **world が置くどの日時よりも後**にしてあるのは
 * 「遷移は行が生まれたあとに起きる」からだが、`{その欄} < {別の欄}` を要求する行内比較の
 * 不変条件があると満たせない。欄どうしの順序を値の側で作るのは `fieldOrder`
 * (`rls-world-values.ts`)の仕事であり、そこへ「状態ごとの欄」を合流させるのは別の仕事である
 * (BACKLOG ⑳-5a (c) と同じ家族)。いまは実例が無い。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { EventDef, SpecModel, StateMachineSpec } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';

/**
 * 遷移が書き留める時刻に置く値。
 *
 * world が置く日時(`rls-world-values.ts` の基準は 2030-01-01 から日数を刻む)より**後**である
 * —— 遷移は行が生まれたあとに起きる。
 */
export const RECORDED_AT = '2040-01-01T00:00:00.000Z';

/** 状態ごとに置き直す列 1 つ。 */
export interface EqRecordedColumn {
  readonly column: string;
  /** 置く値(その状態では空なら `null`)。 */
  readonly value: string | null;
  /**
   * 参照の欄なら、その参照先の集約の名前(`records_actor`)。
   *
   * 値は world の中のその集約の行の id に解決する(実行する側が実行者自身の行から引く)ので、
   * `value` は使わない。時刻の欄では `null` である。
   */
  readonly entity: string | null;
}

/** 状態 1 つぶんの姿。 */
export interface EqRecorded {
  /** その状態が載る列。 */
  readonly stateColumn: string;
  /** 状態の値。 */
  readonly state: string;
  /** その状態のときに置き直す列(空に戻す列も並ぶ)。宣言順。 */
  readonly columns: readonly EqRecordedColumn[];
}

/**
 * その集約の状態ごとの姿を組み立てる。
 *
 * @param domain ドメイン仕様
 * @param aggregate 対象の集約
 * @returns 状態ごとの姿(書き留める欄を 1 つも持たない集約では空)
 */
export function recordedStatesOf(domain: SpecModel, aggregate: string): readonly EqRecorded[] {
  const entity = findEntitySpec(domain, aggregate);
  if (entity === null) return [];
  const recorded: EqRecorded[] = [];
  for (const machine of domain.aggregates.get(aggregate)?.stateMachines ?? []) {
    const column = entity.fields.find(
      (field) => field.type.kind === 'state' && field.type.machine === machine.machine,
    );
    if (column === undefined) continue;
    const columns = recordedColumnsOf(machine);
    if (columns.length === 0) continue;
    for (const state of machine.states) {
      recorded.push({
        stateColumn: column.name,
        state,
        columns: columns.map((name) => shapeOf(name, state, machine, domain, aggregate)),
      });
    }
  }
  return recorded;
}

/** その機械のどれかのイベントが書き留めると宣言した列(宣言順・重複なし)。 */
function recordedColumnsOf(machine: StateMachineSpec): readonly string[] {
  return [
    ...new Set(
      machine.events.flatMap((event) => [...(event.recordsActor ?? []), ...(event.recordsTime ?? [])]),
    ),
  ];
}

/**
 * 1 列ぶんの姿(その状態の行に必ず値があるなら値、そうでなければ空)。
 *
 * 「必ずある」は、その状態へ入る**全部の**遷移について「その遷移が書く」か「空にせず、遷移元の状態のどれでも必ずある」で
 * ある(`carriedStatesOf`)。以前は入る遷移が全部書くときだけを数えたので、書かずに**持ち越す**遷移(対応を再開する・対応を
 * 終える)で入る状態を空に倒し、「その状態なら対応者がいる」という行内比較の不変条件の CHECK に置き直しが当たった
 * (点検 20 回目 B20-1 の残り 3 で、world を作れるようになった集約の一致の証明が実測した)。片方の経路だけが書いて、
 * 別の経路が書かずに空の状態から入れる場合は従来どおり空に倒す。
 */
function shapeOf(
  column: string,
  state: string,
  machine: StateMachineSpec,
  domain: SpecModel,
  aggregate: string,
): EqRecordedColumn {
  if (!carriedStatesOf(machine, column).has(state)) return { column, value: null, entity: null };
  const timed = machine.events.some((event) => (event.recordsTime ?? []).includes(column));
  if (timed) return { column, value: RECORDED_AT, entity: null };
  const field = findEntitySpec(domain, aggregate)?.fields.find((candidate) => candidate.name === column);
  const ref = field?.type.kind === 'ref' ? field.type.entity : null;
  return { column, value: null, entity: ref };
}

/**
 * その列が**必ず値を持つ**状態の集合(最大の不動点)。
 *
 * 初期状態は行が生まれた直後なので持たない(作成はこの列を書き留めない)。ほかの状態は「持つ」から始め、入る遷移のどれかが
 * 「書かず、かつ(空にする、または持たない遷移元がある)」なら外す、を変わらなくなるまで繰り返す。入る遷移の無い状態は持たない。
 *
 * @param machine 状態機械
 * @param column 列
 * @returns 必ず値を持つ状態
 */
export function carriedStatesOf(machine: StateMachineSpec, column: string): ReadonlySet<string> {
  const carried = new Set(machine.states.filter((state) => state !== machine.initial));
  for (let changed = true; changed; ) {
    changed = false;
    for (const state of [...carried]) {
      const entering = machine.events.filter((event) => event.to === state);
      const keeps = entering.length > 0 && entering.every((event) =>
        writesColumn(event, column) || (!(event.clears ?? []).includes(column) && event.from.every((from) => carried.has(from))),
      );
      if (keeps) continue;
      carried.delete(state);
      changed = true;
    }
  }
  return carried;
}

/** そのイベントがその列を書き留めるか。 */
function writesColumn(event: EventDef, column: string): boolean {
  return (
    (event.recordsActor ?? []).includes(column) || (event.recordsTime ?? []).includes(column)
  );
}
