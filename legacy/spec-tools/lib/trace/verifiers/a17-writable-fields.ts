/**
 * A17 `writes` に並んでいるのに**どの操作からも動かせない欄**(束 ⑳-5a-b)。
 *
 * `access_spec` の `writes[].fields` は「この欄はこのロールが書き換えてよい」という宣言である。
 * ところが**書き換える口が 1 つも無い欄**をそこに並べても、宣言は何も執行しない —— 実行器が
 * `canWrite` を回すのも RPC が `p_changes` から取り出すのも、その操作が**受け取った欄**だけ
 * だからである(`run-plan-decide.ts` の `changedFields`)。
 *
 * 実測ではその形が仕様の中に実在した(題材の製品の `entry.slot_fee_amount`)。そこは「遷移が
 * 書き換える欄」を書く欄が DSL に無いので `writes` で近似した箇所であり、**仕様が自分で
 * 「既知の穴」とコメントしている** —— にもかかわらず機械は何も言わなかった。近似は近似として
 * 残ってよいが、**近似であることが verify の出力に出る**必要がある(そうでないと、次に読む人は
 * 「この欄は誰かが動かせる」と読む)。
 *
 * ## 由来と認める 5 つ
 *
 * | 由来 | 宣言 | 意味 |
 * |---|---|---|
 * | 操作の入力 | action_spec の `input` | その操作が受け取る欄(編集の軸そのもの) |
 * | 実行者の書き留め | state_spec の `records_actor` | その遷移が「実行した人」を書く列 |
 * | 時刻の書き留め | state_spec の `records_time` | その遷移が「いま」を書く列 |
 * | 空にする | state_spec の `clears` | その遷移が空にする列 |
 * | 計算値 | action_spec の `computes` | 入力にも DB にも無く、実行時の純関数が決める値 |
 *
 * `computes` は**別の集約の欄も指せる**(1 つの業務イベントが複数の集約を同時に動かす形)ので、
 * 母集合は操作の集約ではなく `computes` が名指しした集約で数える。
 *
 * どれにも当たらない欄は「宣言はあるが誰も動かせない」である。
 *
 * ## `personal_placeholder` は由来にしない
 *
 * 「消去(anonymize)が書く列だから動かせる」と数えたくなるが、**`personal: true` の欄は
 * `personal_placeholder` が必須**(V1 が欠落を error にする)なので、その条件は
 * 「`personal: true` なら動かせる」と同値になる。個人データの欄でありながら消去が書くとは
 * 限らない列(再導出される表示用の写しなど)まで黙ることになり、この検査が見ている
 * 「宣言はあるが誰も動かせない」を報告できなくなる。**消去が何を書くかは消去の宣言であって、
 * 誰かがその列を動かせることの宣言ではない。**
 *
 * **消去が書く列の正式な出どころは効果カタログの `anonymizes`(匿名化する効果。F-erase)である。**
 * 遷移が書いてよい列の期待表(`transition-writes.ts`)とウォーカーのオラクルはそこから導くので、
 * `access_spec.writes` に `by: system` の近似行を置く必要は無い(置けば、この検査が誰も動かせない列として
 * 鳴らす)。
 *
 * ## severity は warning である
 *
 * 仕様の誤りではない —— DSL に「遷移が書き換える欄」の軸が無いことの帰結であり、その軸を買うか
 * どうかは別の判断である(dsl-extension-triage.md)。ここがするのは**近似の所在を報告すること**
 * だけである。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { TraceInput } from '../input.js';
import type { AccessSpec, StateMachineSpec } from '../../model/types.js';

/** A17: `writes` の欄がどこかの操作から動かせることを検証する。 */
export const writableFieldsVerifier: TraceVerifier = {
  id: 'A17',
  title: 'writes の欄 — 宣言はあるが誰も動かせない欄を報告する',

  verify(input: TraceInput): Finding[] {
    const findings: Finding[] = [];
    for (const specs of input.domain.aggregates.values()) {
      const access = specs.access;
      if (access === undefined) continue;
      const movable = movableFieldsOf(input, access.entity, specs.stateMachines);
      for (const field of declaredFields(access)) {
        if (movable.has(field)) continue;
        findings.push(finding(access, field));
      }
    }
    return findings;
  },
};

/** `writes` に並ぶ欄(宣言順・重複なし)。 */
function declaredFields(access: AccessSpec): readonly string[] {
  const found: string[] = [];
  for (const rule of access.writes) {
    for (const field of rule.fields) if (!found.includes(field)) found.push(field);
  }
  return found;
}

/**
 * その集約の欄のうち、**どこかの操作が実際に動かせる**もの。
 *
 * 母集合は仕様側の宣言だけである(実装は 1 行も読まない)。
 */
function movableFieldsOf(
  input: TraceInput,
  entity: string,
  machines: readonly StateMachineSpec[],
): ReadonlySet<string> {
  const movable = new Set<string>();
  for (const action of input.actions.actions) {
    for (const ref of action.input) if (ref.entity === entity) movable.add(ref.field);
    for (const compute of action.computes) if (compute.entity === entity) movable.add(compute.field);
  }
  for (const machine of machines) {
    for (const event of machine.events) {
      for (const field of event.recordsActor ?? []) movable.add(field);
      for (const field of event.recordsTime ?? []) movable.add(field);
      for (const field of event.clears ?? []) movable.add(field);
    }
  }
  return movable;
}

/** 動かせない欄 1 つぶんの指摘。 */
function finding(access: AccessSpec, field: string): Finding {
  return traceFinding('A17', {
    severity: 'warning',
    message: `${access.entity}.${field} は writes に並んでいますが、どの操作からも動かせません`,
    location: { ...access.location, pointer: 'writes' },
    suggestion:
      'その欄を動かす操作の action_spec の input に足すか、遷移が書く値なら state_spec の ' +
      'records_actor / records_time / clears、実行時の純関数が決める値なら action_spec の computes に' +
      '宣言する' +
      '(computes は別の集約の欄も指せる —— 1 つの業務イベントが複数の集約を同時に動かす形)。' +
      '「遷移が書き換える欄」を writes で近似しているだけなら、その近似はここに出たままでよい ' +
      '(近似であることが verify の出力に残る)',
    counterexample: { entity: access.entity, field },
  });
}
