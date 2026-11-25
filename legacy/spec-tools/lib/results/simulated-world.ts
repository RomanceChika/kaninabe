/**
 * 一致の証明の world を**DB を使わないシミュレーションで読む**(束 ⑳-5b)。
 *
 * ⑳-5a の証明は world を実 DB に置き、実行する直前に行を置き直して RPC を呼び出す。結果表は同じ world と
 * 同じ組み合わせを使うが、**DB は実行しない** —— 見せたいのは「先読み(engine)がその組み合わせで
 * 何と答えるか」であり、DB が同じ答えを返すことは生成された証明が実測している。
 *
 * ここがするのは、**設計図の宣言を「行の値」として読むこと**だけである —— 系統の畳み方・
 * 置き直しの当て方・実行者自身の行の見つけ方は実 DB 版と**同じ 1 本**(`@kaninabe/runtime/sql/eq-subject`)
 * であり、このファイルが持つのは「行の名前 → 疑似 id と宣言した値」という**読み方**だけである
 * (束 ⑳-5b-b で写しを消した)。
 *
 * **判定も、供給元の読み方も 1 行も無い** —— どちらも実行器の関数であり、`engine-bridge.ts` が
 * 借りてくる。
 *
 * 読み方は実 DB 版(`@kaninabe/runtime/testing/equivalence/world` の `subjectOf`)と同じ順序で
 * ある —— 系統の行 → 置き直し → 状態、の順に上書きする。違いは値の出どころだけで、実 DB 版は
 * 「入れて読み直した行」、ここは「設計図が入れると宣言した値」を使う。DB の既定値・トリガが
 * 決める列はここには無いので、その列を見るガード式は**評価できない**側に寄る(engine の
 * `guard_unknown`)—— 軸はガード式の変数を全部置き直すので、そこに落ちるのは軸が値の候補を
 * 作れなかった変数だけである。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { RlsWorldRow, EqPlacement } from '../world/index.js';
import { eqSubjectValues } from '@kaninabe/runtime/sql/eq-subject';

/** world の行・入力に入れられる値。 */
export type SimulatedValue = string | number | boolean | null;

/** 行の名前 → 疑似 id の接頭(実 DB の uuid の代わり。字面が読めれば足りる)。 */
const ID_PREFIX = 'row:';

/** 行が無い人の id の接頭(world のどの行も指さない)。 */
const ABSENT_PREFIX = 'absent:';

/** 実行する相手(world の行の値を、置き直したあとの姿で持つ)。 */
export interface SimulatedSubject {
  readonly actorId: string;
  /** 集約 → その行の id。 */
  readonly ids: ReadonlyMap<string, string>;
  /** 集約 → 列 → 置き直したあとの値。 */
  readonly values: ReadonlyMap<string, Readonly<Record<string, SimulatedValue>>>;
  /** 実行者自身の行の値(`claim` と `actor.{欄}` の根拠)。行が無い人では空。 */
  readonly actorRow: Readonly<Record<string, SimulatedValue>>;
  /** 手順ごとの入力(単発の操作は 1 つだけ)。 */
  readonly inputs: readonly Readonly<Record<string, SimulatedValue>>[];
  /** 判断時刻(ISO 8601)。 */
  readonly now: string;
}

/** シミュレーション上の world を組み立てるのに要るもの。 */
export interface SimulatedSubjectInput {
  readonly rows: readonly RlsWorldRow[];
  /**
   * 系統の根になる行の名前(単発の操作は 1 本、保存点は集約ごとに 1 本)。
   *
   * 行が無い人は系統を持たないので、呼び側が**他人の系統**を渡す(「ログインはできるが自分の
   * 行が無い人が、他人の行を動かそうとする」という実在の形。実 DB 版と同じ)。
   */
  readonly branches: readonly string[];
  /** 実行者自身の行の名前(行が無い人は null)。 */
  readonly actorRow: string | null;
  /** 実行者の名前(行が無い人の id を決めるのに使う)。 */
  readonly actorKey: string;
  /** 実行者自身の行で引く集約(判断材料が実行者の行を名指しするもの)。 */
  readonly actorEntities?: readonly string[];
  /** 実行する直前に置き直す値(軸が選んだもの)。 */
  readonly placements: readonly EqPlacement[];
  /** 状態の置き直し(状態を持たない形では null)。 */
  readonly state: { readonly entity: string; readonly column: string; readonly value: string } | null;
  /** 手順ごとの入力(置き直しの前。`into: 'input'` の置き直しは先頭の手順に載る)。 */
  readonly inputs: readonly Readonly<Record<string, SimulatedValue>>[];
  /** 判断時刻(ISO 8601)。 */
  readonly now: string;
}

/**
 * 行 1 つの疑似 id(world の外から同じ字面を作れるようにする)。
 *
 * @param key 行の名前
 * @returns 疑似 id
 */
export function simulatedRowId(key: string): string {
  return `${ID_PREFIX}${key}`;
}

/**
 * 行の名前 → 疑似 id。
 *
 * @param rows world の行
 * @returns 行の名前 → id
 */
export function simulatedIds(rows: readonly RlsWorldRow[]): ReadonlyMap<string, string> {
  return new Map(rows.map((row) => [row.key, simulatedRowId(row.key)]));
}

/**
 * その組み合わせで実行する相手をシミュレーションで決める。
 *
 * @param input world の行・系統・実行者・置き直し・入力
 * @returns 置き直したあとの値と id
 */
export function simulatedSubjectOf(input: SimulatedSubjectInput): SimulatedSubject {
  const ids = simulatedIds(input.rows);
  const inputs = input.inputs.map((row) => ({ ...row }));
  for (const placement of input.placements) {
    if (placement.into === 'input') assignInput(inputs[0], placement.column, placement.value);
  }
  const subject = eqSubjectValues({
    targets: targetsOf(input),
    rowOf: (key) => {
      const row = input.rows.find((candidate) => candidate.key === key);
      return row === undefined ? undefined : { id: ids.get(key) ?? '', values: rowValues(row, ids) };
    },
    actorRow: input.actorRow,
    ...(input.actorEntities === undefined ? {} : { actorEntities: input.actorEntities }),
    placements: input.placements,
    state: input.state,
  });
  return {
    actorId: actorIdOf(input, ids),
    ids: subject.ids,
    values: subject.values as ReadonlyMap<string, Readonly<Record<string, SimulatedValue>>>,
    actorRow: subject.actorRow as Readonly<Record<string, SimulatedValue>>,
    inputs,
    now: input.now,
  };
}

/**
 * その実行者の系統の的(集約 → 行の名前)。
 *
 * 単発の操作は系統の根を 1 本、保存点は集約ごとに 1 本ずつ渡してくる —— どちらも「根の
 * `ancestry` を畳んだもの」であり、先に出たものが勝つ。
 */
function targetsOf(input: SimulatedSubjectInput): Readonly<Record<string, string>> {
  const targets: Record<string, string> = {};
  for (const branch of input.branches) {
    const root = input.rows.find((row) => row.key === branch);
    for (const [entity, key] of Object.entries(root?.ancestry ?? {})) {
      if (targets[entity] === undefined) targets[entity] = key;
    }
  }
  return targets;
}

/** 行 1 つの列の値(参照の列は指す行の id)。 */
function rowValues(row: RlsWorldRow, ids: ReadonlyMap<string, string>): Record<string, SimulatedValue> {
  const values: Record<string, SimulatedValue> = { id: ids.get(row.key) ?? '', ...row.values };
  for (const [column, key] of Object.entries(row.refs)) values[column] = ids.get(key) ?? null;
  return values;
}

/** 実行者の id(行が無い人には world のどの行も指さない id を振る)。 */
function actorIdOf(input: SimulatedSubjectInput, ids: ReadonlyMap<string, string>): string {
  if (input.actorRow === null) return `${ABSENT_PREFIX}${input.actorKey}`;
  return ids.get(input.actorRow) ?? `${ABSENT_PREFIX}${input.actorKey}`;
}

/** 入力の 1 欄を置き直す(先頭の手順の入力が無ければ何もしない)。 */
function assignInput(
  into: Record<string, SimulatedValue> | undefined,
  column: string,
  value: SimulatedValue,
): void {
  if (into === undefined) return;
  into[column] = value;
}
