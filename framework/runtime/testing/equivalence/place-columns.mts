import type { EqRecordedColumn, EqValue, EqWorld } from './types.mjs';
import type { BuiltEqWorld, EqSelection, EqSubject } from './world.mjs';
import { placementsOf } from './world.mjs';

/**
 * 一致の証明が実行の直前に**置き直す列を決める**部分(`place.mts` から分けた)。
 *
 * どの行のどの列に何を置くか(軸が選んだ値・設計図の値・状態と対で意味を持つ欄・実行者自身の行を戻す列)を
 * 純粋に決めるだけで、DB には触れない。置く側は `place.mts`。**アプリの語彙は 1 語も持たない。**
 */

/** 置き直す行 1 つぶん(集約・行の id・置く列)。 */
export interface EqPlacementTarget {
  readonly entity: string;
  readonly id: string;
  readonly columns: readonly EqPlacementColumn[];
}

/** 置き直す列 1 つ。 */
export interface EqPlacementColumn {
  readonly column: string;
  readonly value: EqValue;
}

/**
 * その状態のときに置き直す「遷移が書き留めた欄」(設計図の `records`)。
 *
 * @param world 設計図
 * @param stateColumn 状態が載る列
 * @param state 置く状態
 * @returns 置き直す列(その状態では空に戻す列も並ぶ)
 */
export function recordedColumns(
  world: EqWorld,
  stateColumn: string,
  state: string,
): readonly EqRecordedColumn[] {
  return (
    world.records.find((entry) => entry.stateColumn === stateColumn && entry.state === state)
      ?.columns ?? []
  );
}

/** 設計図が状態ごとの姿を持つ状態の列(重複なし・宣言順)。 */
function recordedStateColumns(world: EqWorld): readonly string[] {
  return [...new Set(world.records.map((entry) => entry.stateColumn))];
}

/**
 * 書き留める欄 1 つに置く値。
 *
 * 参照の欄(`records_actor`)は**実行者自身の行**の id である —— 遷移が書くのはまさにそれで
 * ある。実行者の集約に行が無い人では雛形の系統から同じ集約の行を引く(置き直しは engine の
 * 判定より前に起きるので、実行できない組み合わせでも行の形は宣言どおりでなければならない)。系統がその集約の行を持たない
 * (対象の集約が実行者の集約を参照しない)ときは、world のその集約の最初の行を引く(`anyRowOf`)。
 */
export function recordedValue(
  recorded: EqRecordedColumn,
  built: BuiltEqWorld,
  selection: EqSelection,
  resolve: (entity: string) => string | null,
): EqValue {
  if (recorded.entity === null) return recorded.value;
  return built.rows.get(selection.actor.row ?? '')?.id ?? resolve(recorded.entity);
}

/**
 * 集約ごとに置き直す列と値(1 集約 1 文)。
 *
 * **どの組み合わせでも同じ列を書く。** この world のどれかの軸が触りうる列は全部、その組み合わせが
 * 選んだ値か、選んでいなければ**world を作ったときの値**に戻す —— 前の組み合わせが置いた値が
 * 残ると、次の組み合わせは「設計図とは違う world」で実行することになる(実測: `claim` の欄を偽にした
 * まま次の操作へ持ち越し、役が立たないまま全部が拒否された)。
 *
 * 1 集約 1 文なのは、日時の欄どうしの順序(行内比較の不変条件)が 1 列ずつ動かすと途中で
 * 崩れるからである。
 */
export function columnsToPlace(
  world: EqWorld,
  built: BuiltEqWorld,
  selection: EqSelection,
  subject: EqSubject,
): readonly EqPlacementTarget[] {
  const chosen = new Map<string, EqValue>();
  for (const placement of placementsOf(selection)) {
    if (placement.into === 'row') chosen.set(`${placement.entity}.${placement.column}`, placement.value);
  }
  // 対象の状態はこの組み合わせが選んだものであり、雛形の復元(`restoreRow`)が既に置いている。
  // ここで戻すと、world を作ったときの状態(DB の既定値)に上書きしてしまう。
  const owned =
    selection.state === null ? '' : `${world.aggregate}.${selection.operation.stateColumn ?? ''}`;
  const targets: EqPlacementTarget[] = [];
  for (const [entity, columns] of placeableColumns(world)) {
    const id = subject.ids.get(entity);
    if (id === undefined) continue;
    const original = [...built.rows.values()].find((row) => row.id === id)?.values ?? {};
    const list = new Map<string, EqValue>();
    for (const column of columns) {
      if (`${entity}.${column}` === owned) continue;
      list.set(column, chosen.get(`${entity}.${column}`) ?? asEqValue(original[column]));
    }
    // **状態が決まる組み合わせでは、その状態が要求する欄を同じ 1 文で置く。** 状態はこの
    // 組み合わせが選んだもの(遷移)か、軸が置いたもの(ガードが状態を見る編集・削除)である。
    // 書き留める欄そのものが軸の連れ(日時の順序を作る `fieldOrder` の連れ placement)で
    // 置かれることもあるので、**後から入れて上書きする** —— 状態と対で意味を持つ欄を
    // 状態と食い違わせないほうが先である(実測: 到達状態の行に、対の時刻の欄が空のまま残って落ちた)。
    if (entity === world.aggregate) {
      for (const column of recordedStateColumns(world)) {
        const placed =
          column === selection.operation.stateColumn && selection.state !== null
            ? selection.state
            : list.get(column);
        if (typeof placed !== 'string') continue;
        for (const recorded of recordedColumns(world, column, placed)) {
          list.set(
            recorded.column,
            recordedValue(recorded, built, selection, (name) => subject.ids.get(name) ?? anyRowOf(world, built, name)),
          );
        }
      }
    }
    targets.push({ entity, id, columns: [...list].map(([column, value]) => ({ column, value })) });
    targets.push(...actorRowReset(built, selection, entity, id, columns));
  }
  return targets;
}

/**
 * 実行者自身の行が系統の的と別の行のとき、その行の触りうる列を**設計図の値に戻す**。
 *
 * 軸が実行者自身の行の欄を動かす操作(実行者の在籍状態がガードに現れる形)の後に、動かした値が実行者の行に
 * 残ると、次の組み合わせが「設計図とは違う world」で始まる。系統の的が実行者の行と別の行(束縛の列のために
 * 分けた別人の行を指す集約)のときは、的の行を戻すだけでは実行者の行が戻らない。
 */
function actorRowReset(
  built: BuiltEqWorld,
  selection: EqSelection,
  entity: string,
  targetId: string,
  columns: readonly string[],
): readonly EqPlacementTarget[] {
  const actorKey = selection.actor.row;
  const actorRow = actorKey === null ? undefined : built.rows.get(actorKey);
  if (actorRow === undefined || actorRow.entity !== entity || actorRow.id === targetId) return [];
  return [
    {
      entity,
      id: actorRow.id,
      columns: columns.map((column) => ({ column, value: asEqValue(actorRow.values[column]) })),
    },
  ];
}

/** この world のどれかの軸が触りうる列(集約 → 列名。宣言順・重複なし)。 */
function placeableColumns(world: EqWorld): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const operation of world.operations) {
    for (const axis of operation.axes) {
      for (const value of axis.values) collect(found, value.placements);
    }
  }
  return found;
}

/** 置き直しの並びから、集約ごとの列を積む。 */
function collect(
  found: Map<string, string[]>,
  placements: readonly { readonly entity: string; readonly column: string; readonly into: string }[],
): void {
  for (const placement of placements) {
    if (placement.into !== 'row') continue;
    const list = found.get(placement.entity) ?? [];
    if (!list.includes(placement.column)) list.push(placement.column);
    found.set(placement.entity, list);
  }
}

/** 読み直した値を置き直せる形に写す(置けない形は null = 空に戻す)。 */
function asEqValue(value: unknown): EqValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

/**
 * world のその集約の最初の行の id(設計図の挿入順。無ければ null)。
 *
 * 書き留める参照の欄(対応者など)を、実行者の行も系統の祖先も持たない組み合わせで埋める受け皿である —— 「その状態なら
 * 値がある」行内比較の不変条件があると、空のままでは置き直しそのものが落ちる(点検 20 回目 B20-1 の残り 3。実行者の集約に
 * 行が無い人が、実行者を参照しない集約の対応中の行を動かす組み合わせで実測)。置き直し(`columnsToPlace`)と雛形の復元
 * (`place.mts` の `restoreRow`)が同じこの 1 本を使う。
 *
 * @param world 設計図
 * @param built 実 DB に作った world
 * @param entity 集約
 * @returns 行の id
 */
export function anyRowOf(world: EqWorld, built: BuiltEqWorld, entity: string): string | null {
  const row = world.rows.find((candidate) => candidate.entity === entity);
  return row === undefined ? null : (built.rows.get(row.key)?.id ?? null);
}
