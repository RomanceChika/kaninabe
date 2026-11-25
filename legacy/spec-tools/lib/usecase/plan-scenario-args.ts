/**
 * 場面が RPC に届くと**期待する名前つき引数**(束 ⑰-3b / 独立レビュー 1-B)。
 *
 * それまで成功の場面が RPC について確かめていたのは「呼び出した関数の名前」だけで、**引数を
 * 1 つも見ていなかった**。実行器が値を別の引数に載せても(入力の `a` を `p_b` に渡しても)
 * テストは緑のままだった —— 配線の取り違えを見る場所が操作ごとに 1 つも無かった。
 *
 * ここが組み立てるのは「その引数に載るはずの値」であり、出どころは**場面そのもの**である:
 * 実行者の id・場面が行に載せた状態・場面が作った入力。計画から写すのは**引数の名前と
 * 供給元の種別**だけで、値は写さない(値まで計画から取ると同語反復になる)。
 *
 * 値が決まらない引数(冪等キー・新しい id のような呼び出しごとに変わる値)は持たない。
 * 突合は部分一致(`toMatchObject`)であり、持たない引数は見ない。
 *
 * ファイル I/O はしない純関数(scripts-code-quality.md)。**アプリの語彙は 1 語も持たない。**
 */

import type { ResolvedParam } from './param-source.js';
import type { ScenarioContext, ScenarioRow } from './plan-scenario-rows.js';
import type { ScenarioValue } from './plan-scenario-values.js';

/** 引数に載るはずの値(JSON に落ちる形。配列は effects、オブジェクトは p_values / p_changes)。 */
export type ArgExpect =
  | ScenarioValue
  | readonly string[]
  | Readonly<Record<string, ScenarioValue>>;

/** 期待を組み立てるのに要る、場面の側の事実。 */
export interface ArgFacts {
  readonly rows: readonly ScenarioRow[];
  readonly input: Readonly<Record<string, ScenarioValue>>;
  readonly actorId: string | null;
}

/**
 * その場面で RPC が受け取るはずの引数を並べる。
 *
 * @param ctx 場面の materials(遷移のイベント・読む行の宣言)
 * @param params 計画が解決した引数(名前と供給元の種別)
 * @param facts 場面が作った行・入力・実行者
 * @returns 引数名 → 期待する値(決まらない引数は持たない)
 */
export function expectedArgs(
  ctx: ScenarioContext,
  params: readonly ResolvedParam[],
  facts: ArgFacts,
): Readonly<Record<string, ArgExpect>> {
  const args: Record<string, ArgExpect> = {};
  for (const { name, source } of params) {
    switch (source.kind) {
      case 'actor':
        args[name] = facts.actorId;
        break;
      case 'event_id':
        // 操作 ID そのもの。場面は `ctx.op` としてこれを独立に知っている。
        args[name] = ctx.op;
        break;
      case 'next_state':
        // 遷移先は state_spec のイベント宣言が正である(計画の写しではなく、そちらを読む)。
        args[name] = ctx.event?.to ?? source.state;
        break;
      case 'effects':
        args[name] = [...source.effects];
        break;
      case 'expected_state':
        // 「判断したときの状態」= 場面がその行に載せた値そのもの。
        args[name] = stateOnRow(ctx, facts.rows, source.entity, source.field) ?? source.literal;
        break;
      case 'input_target_id':
        args[name] = facts.input['id'] ?? null;
        break;
      case 'input_field':
        args[name] = facts.input[source.field] ?? null;
        break;
      case 'input_values':
      case 'input_changes':
        args[name] = pick(facts.input, source.fields.map((field) => field.name));
        break;
      case 'not_written':
        // 「この遷移はその列を決めない」= 空が届く(空が何を意味するかは RPC の本文が実現する)。
        args[name] = null;
        break;
      default:
        // 冪等キー・新しい id・計算値・先行手順の結果は、場面から値が決まらない。
        break;
    }
  }
  return args;
}

/**
 * 場面が用意した行から、その集約の状態列の値を拾う(行が無ければ null)。
 *
 * **集約から表を引いてから行を探す。** 列名だけで引くと、親子を同時に読む操作
 * (`p_expected_entry_state` と `p_expected_workshop_state` を両方取る編集)で
 * 先に見つかったほうの `state` が両方に載る。
 */
function stateOnRow(
  ctx: ScenarioContext,
  rows: readonly ScenarioRow[],
  entity: string,
  field: string,
): ScenarioValue | null {
  const table = ctx.reads.find((read) => read.entity === entity)?.table;
  for (const row of rows) {
    if (table !== undefined && row.table !== table) continue;
    const value = row.values[field];
    if (value !== undefined) return value;
  }
  return null;
}

/** 入力から、その引数が運ぶ欄だけを取り出す(入力に無い欄は持たない)。 */
function pick(
  input: Readonly<Record<string, ScenarioValue>>,
  fields: readonly string[],
): Readonly<Record<string, ScenarioValue>> {
  const picked: Record<string, ScenarioValue> = {};
  for (const field of fields) {
    const value = input[field];
    if (value !== undefined) picked[field] = value;
  }
  return picked;
}
