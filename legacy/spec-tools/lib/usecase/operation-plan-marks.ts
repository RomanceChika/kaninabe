/**
 * 「**計画だけでは足りない**」と機械が仕様側の宣言から言える印(束 ⑰ / ⑰-3b)。
 *
 * `runner: manual` は「定型では書けない」ことの宣言であって、書けるものを手書きに留める
 * `permit` ではない。A15 はその向きを逆からも見る(導出できてしまったら error)ので、
 * 「導出はできるが計画だけでは走りきれない」を裏づける印がここに要る。
 *
 * **印は仕様側の宣言から機械が読むものだけである** —— 操作名の分岐も、理由文の解釈も無い。
 *
 * 使い手は 3 本 —— 計画を組む `operation-plan.ts`(`incomplete` に写す)と、生成の対象を決める
 * `generate/render/code-structure-expectations.ts` ・`code-operation-app.ts`(`isSystemOnlyOperation`)。
 * 後の 2 本は計画の組み立てを要らず印の読み取りだけを使うので、印は別の部品として置いてある。
 */

import type { SpecModel } from '../model/types.js';
import { systemRoleId } from '../model/role-hierarchy.js';
import type { ActionSpec } from '../model/trace/types.js';
import { groundOperation } from '../semantics/operation-ground.js';
import type { SavePlan } from './step-plan.js';

/**
 * **実行器が返せる結末の値域**。`errors.additional` がこの中の名前を言い直しているだけなら、
 * それは「定型の外で何かを実行している」の根拠にならない。
 */
const RUNNER_OUTCOME_KINDS: ReadonlySet<string> = new Set([
  'invalid_input',
  'forbidden',
  'guard_unsatisfied',
  'invariant_violated',
  'conflict',
  'not_found',
]);

/**
 * **実行器が返せない失敗を契約として宣言している**か(action_spec の `errors.additional`)。
 *
 * 実行器が返せるのは `RUNNER_OUTCOME_KINDS` の 6 つだけである。それ以外の失敗の仕方を契約に
 * している操作は、定型の外で何かを実行している —— 外部連携がその代表であり、実行計画にはそれを
 * 呼ぶ口が無い。**宣言から機械的に分かる「計画だけでは足りない」の印**であり、A15 の逆向きの
 * 検査はこれを見て黙る。
 *
 * **値域の外であることまで見るのは束 ⑰-3b の締め直しである。** それまでは「`additional` が
 * 空でない」だけを見ていたので、実行器が既に返す名前を 1 行書き足すだけで逆向きの検査を
 * 黙らせられた(独立レビュー 4-A)。残る限界: 新しい名前を発明すれば依然として黙らせられる。
 * 根まで閉じるには外部連携カタログから操作への線(DSL の拡張)が要り、実例は 1 件
 * (支払いの操作を持つサンプル 1 件)で 2 実例ルール未達である。
 */
export function hasExtraErrors(action: ActionSpec): boolean {
  return action.errors.additional.some((error) => !RUNNER_OUTCOME_KINDS.has(error.kind));
}

/**
 * この操作が執行を要求されている application 執行の不変条件のうち、**自集約の外を参照する**もの。
 *
 * hooks の型は `(input) => boolean` であり、見えるのはその操作の入力だけである。単発の操作の
 * 入力は「対象の識別子 + 書き換える欄」しかないので、**別の集約の行を数える・見る不変条件は
 * 判定できない**(保存点では話が違う —— 数える相手をその保存点自身がこれから書くので、
 * 入力から数えられる)。
 *
 * 組み立て自体は成功する(引数はすべて決まる)ので、ここは**止めずに印を残す**。印は
 * 「`runner: manual` の宣言が要ることを機械が裏づけられる理由」であり、A15 の逆向きの検査
 * (「計画が導出できるのに manual」)がこの印を見て黙る。
 */
export function crossAggregateHooks(
  plan: SavePlan,
  hooks: readonly string[],
  domain: SpecModel,
): readonly string[] {
  if (!plan.single) return [];
  const own = new Set(plan.steps.map((step) => step.entity));
  const outside: string[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (!hooks.includes(invariant.id)) continue;
      const referenced = [...new Set([...(invariant.entities ?? []), ...(invariant.involves ?? [])])];
      if (referenced.some((entity) => !own.has(entity))) outside.push(invariant.id);
    }
  }
  return outside;
}

/**
 * その操作が**システム専用**か(`by` がシステムのロールだけ)。
 *
 * Server Action は誰でも POST できる公開の入口である。`by` が system だけのイベントに
 * その口を生成すると、**常に forbidden で終わる死んだ口**が仕様の数だけ増える(実行者が
 * system に解決される経路が無いため)。押せないボタンを画面に出さないのと同じ理由で、
 * 実行できない口も作らない。
 *
 * 正典もそう書いている —— action-spec-writing.md §system が起こすイベント /
 * `docs/specs/backend/actions/README.md`(「`by` に `system` を含むイベントは Server Action の
 * 入口を持たない」)。ここはその機械的な執行点である。
 *
 * 判定できるのは**状態遷移だけ**である。予約 ID(`{entity}.create` 等)の `by` は access_spec の
 * 規則の集合であり、「人の入口が要らない」は規則からは読めない(規則が 1 本も無い形と、
 * system だけが書く形が同じ宣言になりうる)ので、ここでは false を返す。
 *
 * ロール ID は仕様が決める語なので `kind: system` のロールを引く(W1。仕組み側のコードに
 * 語を書かない)。宣言の無い体系では判定できないので false を返す。
 *
 * @param domain ドメイン仕様モデル
 * @param op 操作 ID(`{machine}.{event}` または予約 ID)
 * @returns `by` がシステムのロールだけなら true
 */
export function isSystemOnlyOperation(domain: SpecModel, op: string): boolean {
  const systemRole = systemRoleId(domain.roles.roles);
  if (systemRole === undefined) return false;
  const grounding = groundOperation(domain, op);
  if (grounding.kind !== 'transition') return false;
  const by = grounding.entry.event.by;
  return by.length > 0 && by.every((role) => role === systemRole);
}
