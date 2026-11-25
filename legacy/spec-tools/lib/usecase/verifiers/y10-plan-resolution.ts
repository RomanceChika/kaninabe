/**
 * Y10: 保存点の**実行計画**が仕様から決まる(`permit` が要る事実の供給元が全部決まる)。
 *
 * Y8 が「複合 RPC の引数」を見るのに対し、Y10 は「実行前の `permit`(canCreate / canFire)が
 * 要る値」を見る —— ガード式に現れる変数・文脈ロールの binding・保存点の外から読む行の
 * 絞り込みである。決まらないものがあると、実装は**実行時に推測する**しかなくなる
 * (推測した env は `guard_unknown` を生み、拒否の理由が仕様から説明できなくなる)。
 *
 * 生成器(`code-usecase-plans.ts` 他)は同じ組み立てを使い、決まらなければ生成時エラーで
 * 止まる。Y10 はそれを verify の段で、反例つきで先に見せる役である。
 */

import { buildSavePlans, type BuiltSave } from '../plan-build.js';
import { inputValue } from '../../kernel/input-state.js';
import type { UsecaseInput } from '../derive.js';
import { acceptedInvariant } from '../derive.js';
import { saveEntities } from '../plan-facts-parts.js';
import type { InvariantDef, SpecModel } from '../../model/types.js';
import type { UsecaseContext, UsecaseVerifier } from '../verifier.js';
import { usecaseFinding, type Finding } from '../verifier.js';

/** Y10 の実装。 */
export const planResolutionVerifier: UsecaseVerifier = {
  id: 'Y10',
  title: '保存点の実行計画(`permit` が要る事実の供給元)が仕様から決まる',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    // data_table が使えない(未選択・阻害)環境では何も見ない(接地そのものができない)。見ていないことは実行ログが言う。
    const dataTables = inputValue(ctx.dataTables);
    if (dataTables === undefined) return [];
    if (ctx.actions.state === 'blocked') return []; // action_spec が分からない(実行計画が入力欄を引く。行は呼び手が言う)
    const built = buildSavePlans({
      domain: input.domain,
      guards: ctx.guards,
      actions: input.actions,
      dataTables,
      usecases: input.usecases,
    });
    const problems = built.problems
      // 接地(Y1)・引数の解決(Y8)の失敗は同じ反例で既に報告されているので、ここでは重ねない。
      .filter((entry) => entry.stage === 'facts')
      .map((entry) =>
        usecaseFinding('Y10', {
          message: entry.problem.message,
          location: entry.usecase.location,
          suggestion: entry.problem.suggestion,
          counterexample: entry.problem.counterexample,
        }),
      );
    return [...problems, ...built.saves.flatMap((save) => uncoveredInvariants(save, input.domain))];
  },
};

/**
 * この保存点が触る集約の不変条件のうち、**application 執行なのに実行されない**もの(warning)。
 *
 * 保存点が実行する hooks の母集合は「`enforced_by: application` を宣言し、かつ**この保存点の手順**を
 * `guard` の執行点として名指しした不変条件」である(`invariantHooksOf`)。この条件から漏れるもの
 * —— 集約は交わるのに手順を名指ししていない application 執行の不変条件 —— は、**複合 RPC の
 * 経路では誰も評価しない**(個別の操作を通れば、その operation の `persist` が評価する)。
 * 狭めた母集合はそれ自体が判断であり、黙って通す形にはしない(ADR-0012 の当座の手当て)。
 *
 * **error にしないのは意図である。** 交わることは「この保存点が壊しうる」ことを意味しない
 * (例: 行を足すだけの保存点と、削除の側で守る不変条件)。判断は人がするので、受け入れるなら
 * 理由つきで宣言する(`accept: [{ invariant: {id}, reason: ... }]`)—— 免除リストは作らない。
 */
function uncoveredInvariants(save: BuiltSave, domain: SpecModel): Finding[] {
  const entities = saveEntities(save.plan.steps);
  const hooks = new Set(save.facts.invariantHooks);
  const findings: Finding[] = [];
  for (const invariant of applicationInvariants(domain)) {
    if (hooks.has(invariant.id)) continue;
    const touched = [...new Set([...invariant.entities, ...(invariant.involves ?? [])])].filter((entity) =>
      entities.has(entity),
    );
    if (touched.length === 0) continue;
    if (acceptedInvariant(save.usecase, invariant.id) !== undefined) continue;
    findings.push(
      usecaseFinding('Y10', {
        severity: 'warning',
        message:
          `保存点 ${save.plan.save.id} は ${invariant.id}(application 執行)が関わる集約 ` +
          `${touched.join(' / ')} を触りますが、この保存点はその不変条件を実行しません`,
        location: save.usecase.location,
        suggestion:
          `この保存点で守るなら invariant_spec の ${invariant.id} の enforced_by に ` +
          `"- kind: guard / ref: {この保存点の手順の操作 ID}" を足す(実行計画が hooks を要求し、` +
          '型が実行し忘れを許さなくなる)。この保存点では守らなくてよいなら、usecase_spec に ' +
          `"accept: [{ invariant: ${invariant.id}, reason: {なぜ壊れないか} }]" を足して受け入れる`,
        counterexample: {
          usecase: save.usecase.name,
          save: save.plan.save.id,
          invariant: invariant.id,
          entities: touched.join(' / '),
          statement: invariant.statement,
        },
      }),
    );
  }
  return findings;
}

/** `application` の執行点を宣言した不変条件の全数(宣言順・id 順)。 */
function applicationInvariants(domain: SpecModel): readonly InvariantDef[] {
  const found: InvariantDef[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (invariant.enforcedBy.some((enforcement) => enforcement.kind === 'application')) found.push(invariant);
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
