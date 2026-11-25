/**
 * 遷移 RPC が**状態のほかにどの列へ何を書くか**の引き当て。`rpc-facts.ts` が集める「本文に要る
 * 事実」のうち、遷移の列を持つ(作成と編集の列は `rpc-columns.ts`)。
 *
 * 列の値を決めるのは state_spec の 2 語(`clears` / `records_time`)である。`records_actor` は
 * **値の口(`p_{列}` の引数)**を要求するので、引数の並びを回る側(下の `transitionColumns` の前半)が
 * 拾い、その引数を書き込みの前にイベントで縛る(`actorBind`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { EventDef, FieldDef, StateMachineSpec } from '../model/types.js';
import { sqlLiteral } from './guard-to-sql.js';
import { CLOCK_VAR } from './rpc-parts.js';
import { columnExpression } from './sql-types.js';
import { transitionTargetOf } from './rpc-transition-machine.js';
import type { RpcParam } from './rpc-params.js';
import type { RpcFactsInput, TransitionColumn } from './rpc-facts.js';

/**
 * 1 欄ずつ受ける引数が、その列に入るときの式(`rpc-columns.ts` の `paramValue` と同じ 1 本)。
 *
 * @param param 引数 1 本(名前と宣言された型)
 * @param field 入れる先の欄
 * @returns SQL の式
 */
function paramValue(param: RpcParam, field: FieldDef): string {
  return columnExpression(param.name, param.type, field.type);
}

/** 値の口を持たない列を空にするときの SQL の字面。 */
const EMPTY = 'null';

/**
 * 「いま」を書くときの SQL の字面(`records_time`)。行ロックの後に取った時刻の変数(`v_now`。
 * ガードの `now` と同じ 1 つの時刻。`rpc-body-lock.ts` の `clockCapture`)。
 *
 * **引数は要らない** —— `records_actor` が `p_{列}` を必要としたのに対し、この値は SQL の側に
 * ある。呼び出し側から届く値ではないので、計画も実行器も何も渡さない。
 */
const NOW = CLOCK_VAR;

/**
 * 遷移が状態のほかに書く列(値の意味は**イベントごとの宣言**が決める)。
 *
 * 計画が渡せるのは引数のある列だけであり、しかも渡すのはいつも空である。したがって意味を決めるのは
 * state_spec の 2 語である —— `clears` に並ぶ遷移は「空にする」、`records_time` に並ぶ遷移は
 * 「`v_now` を書く」、どちらにも並ばない遷移は「触れない」(`coalesce`)。同じ列に複数の宣言が
 * 同居する機械は `p_event_id` で分岐する(列単位に潰すと、触れないはずの遷移がその列を静かに
 * 消す。束 ⑰-3b の独立レビュー 3-A)。
 *
 * **母集合は引数だけではない**(束 ㉔ の実測)。`clears` も `records_time` も「この遷移がその列に
 * 何を書くか」の宣言であり、**値の口(引数)を要求しない** —— 空にするのに渡すものは無く、
 * 「いま」は SQL が持っているからである。引数の並びだけを回っていた頃は、引数を持たない列の
 * `clears` が UPDATE 文に一度も現れず、**宣言があるのに何も起こらない**(取り消しの遷移が
 * 「アーカイブ日時」の列を空にする宣言がその実例)。引数のある列はその引数が**ほかのイベントの
 * 値の口**でもあるので従来どおり引数の値を代入し、引数の無い列はここが直に空 / `v_now` を書く。
 */
export function transitionColumns(input: RpcFactsInput, entity: string, params: readonly RpcParam[]): readonly TransitionColumn[] {
  if (input.shape !== 'transition') return [];
  const machine = machineOf(input, entity);
  const events = machine?.events ?? [];
  const columns: TransitionColumn[] = [];
  const bound = new Set<string>();
  for (const param of params) {
    if (param.role.kind !== 'column') continue;
    const name = param.role.field.name;
    bound.add(name);
    const value = paramValue(param, param.role.field);
    const bind = actorBind(input, param, events, machine);
    columns.push({
      name,
      expression: eventfulValue(name, value, `coalesce(${value}, t.${name})`, events, machine),
      ...(bind === null ? {} : { bind }),
    });
  }
  for (const name of writtenColumns(events)) {
    if (bound.has(name)) continue;
    columns.push({ name, expression: eventfulValue(name, EMPTY, `t.${name}`, events, machine) });
  }
  return columns;
}

/**
 * `records_actor` の列の引数を、書き込みの前にイベントで縛る代入文(その列を記録するイベントが無ければ null)。
 *
 * 計画だけが柵だと、遷移の RPC に `p_{列}` があるだけで**どのイベントの呼び手も**その列を任意の値で
 * 書けた(`coalesce(p_列, t.列)` はイベントを見ない。点検 7 回目 A7-1)。DB の側でも閉じる ——
 * 記録するイベントでは実行者そのもの(`p_actor_id`)、その欄を action_spec の input / computes で受ける
 * イベントでは引数、それ以外のイベントでは空(= 下の `coalesce` が触れない / `clears` が空にする)。
 */
function actorBind(input: RpcFactsInput, param: RpcParam, events: readonly EventDef[], machine: StateMachineSpec | null): string | null {
  if (param.role.kind !== 'column' || machine === null) return null;
  return actorBindStatement({ machine, column: param.role.field.name, entity: input.table.entity ?? '', actions: input.actions });
}

/** 縛りの代入文を決める材料(遷移 RPC の本文と、rpc-parity の期待の両方が同じ 1 本を読む)。 */
export interface ActorBindSource {
  /** その遷移 RPC の状態機械。 */
  readonly machine: StateMachineSpec;
  /** `records_actor` の列(引数は `p_{列}`)。 */
  readonly column: string;
  /** 自集約のエンティティ名。 */
  readonly entity: string;
  /** action_spec(その列を input / computes で受けるイベントを引く)。 */
  readonly actions: RpcFactsInput['actions'];
}

/**
 * `records_actor` の列の縛りの代入文そのもの(その列を記録するイベントが無ければ null)。
 *
 * 生成する本文の字面と rpc-parity の期待(`actorBound`)が**同じ字面**を持つための 1 本(点検 8 回目 A8-2 ——
 * 以前の期待はイベントの並びだけで、`else` の枝・文の位置・受けるイベントの枝を見なかった)。
 *
 * @param source 機械・列・自集約・action_spec
 * @returns `p_{列} := case … else null end`(末尾の `;` は持たない)
 */
export function actorBindStatement(source: ActorBindSource): string | null {
  const { machine, column, entity } = source;
  const events = machine.events;
  const recording = events.filter((event) => (event.recordsActor ?? []).includes(column));
  if (recording.length === 0) return null;
  const supplied = events.filter((event) => {
    if (recording.includes(event)) return false;
    const action = source.actions?.actions.find((candidate) => candidate.handles.raw === `${machine.machine}.${event.id}`);
    if (action === undefined) return false;
    const inInput = action.input.some((ref) => ref.entity === entity && ref.field === column);
    return inInput || action.computes.some((decl) => decl.entity === entity && decl.field === column);
  });
  const param = `p_${column}`;
  const ids = (list: readonly EventDef[]): string => list.map((event) => sqlLiteral(`${machine.machine}.${event.id}`)).join(', ');
  const whens = [
    `when p_event_id in (${ids(recording)}) then p_actor_id`,
    ...(supplied.length === 0 ? [] : [`when p_event_id in (${ids(supplied)}) then ${param}`]),
  ];
  return `${param} := case ${whens.join(' ')} else null end`;
}

/** その機械のどれかのイベントが空にする / 「いま」を書くと宣言した列(宣言順・重複なし)。 */
function writtenColumns(events: readonly EventDef[]): readonly string[] {
  return [...new Set(events.flatMap((event) => [...(event.clears ?? []), ...(event.recordsTime ?? [])]))];
}

/**
 * そのイベントがその列に書く値(何も書かない = 触れないなら null)。
 *
 * `records_time` が先である —— 同じイベントが同じ列を 2 語に並べることは V19 が error で
 * 止めるので、ここで順序が意味を持つ場面は通らない(型の網羅のために順序を決めてある)。
 *
 * @param event イベント定義
 * @param name 列名
 * @param cleared 空にするときに代入する式(引数の値、または直の空)
 * @returns SQL の式、または null
 */
function eventfulWrite(event: EventDef, name: string, cleared: string): string | null {
  if ((event.recordsTime ?? []).includes(name)) return NOW;
  return (event.clears ?? []).includes(name) ? cleared : null;
}

/**
 * 1 列ぶんの式(書くと宣言したイベントだけ分岐し、それ以外は `keep`)。
 *
 * 同じ値を書くイベントは 1 つの `when` にまとめる(`p_event_id in (…)`)。値の種類が 1 つで、
 * しかもその機械の全イベントが書くなら分岐そのものが要らない。
 *
 * @param name 列名
 * @param cleared 空にするイベントで代入する式(引数の値、または直の空)
 * @param keep 何も書かないイベントで残す式
 * @param events その機械の全イベント
 * @param machine その機械(イベント ID の前置に要る)
 * @returns SQL の式
 */
function eventfulValue(
  name: string,
  cleared: string,
  keep: string,
  events: readonly EventDef[],
  machine: StateMachineSpec | null,
): string {
  const branches = new Map<string, EventDef[]>();
  for (const event of events) {
    const value = eventfulWrite(event, name, cleared);
    if (value === null) continue;
    const list = branches.get(value) ?? [];
    list.push(event);
    branches.set(value, list);
  }
  const written = [...branches.values()].reduce((count, list) => count + list.length, 0);
  if (written === 0) return keep;
  const single = branches.size === 1 ? [...branches.keys()][0] : undefined;
  if (single !== undefined && written === events.length) return single;
  const whens = [...branches].map(([value, list]) => {
    const ids = list.map((event) => sqlLiteral(`${machine?.machine ?? ''}.${event.id}`));
    return `when p_event_id in (${ids.join(', ')}) then ${value}`;
  });
  return `case ${whens.join(' ')} else ${keep} end`;
}

/**
 * 遷移 RPC が動かす状態機械(`transitionTargetOf` が関数名と表の集約から決める。決まらなければ null)。
 *
 * 決まらない宣言は事実の収集(`collectRpcFacts`)が先に理由つきで止める(T6)ので、ここに来るのは決まる宣言だけである。
 * 別の機械に倒す既定は持たない。
 */
export function machineOf(input: RpcFactsInput, entity: string): StateMachineSpec | null {
  const resolved = transitionTargetOf(input.name, entity, input.domain);
  return resolved.ok ? resolved.target.machine : null;
}
