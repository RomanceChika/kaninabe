/**
 * V18 の下位検査: 作成の規則の**代理の欄**(access_spec の `creates[].delegate: [{ field, reason }]`)の接地。
 *
 * `delegate` は「この規則は、作成の入力に出したこの実行者への参照の欄を実行者に縛らない」の明示の宣言で、解けるのは
 * 名指した欄だけである(点検 10 回目 A10-2。以前は規則単位の 1 文字列で、承認者の欄のために書いた理由が、後から入力に
 * 足した別の欄の縛りも黙って外した)。名指しが当たらない要素は**何も解かない**ので、書いた人の意図(この欄は代理で選ぶ)と
 * 生成物(縛ったまま)がずれる —— それを腐った宣言として止める。
 *
 * ここが見るのは宣言の形の正しさだけである(欄が作る集約のものであることは読み込みが閉じる):
 *   (a) その集約の作成の action_spec(`handles: {集約}.create`)の `input` に名指した欄がある
 *       (入力に無い欄は人が選ばない —— 持ち主は `owner`、計算値は `computes` で、どちらも代理の対象ではない)
 *   (b) entity_spec に実在し、**`ref(実行者の集約)`** 型である(縛りの母集合は実行者への参照の欄だけ)
 *   (c) 規則がもともと全ての縛りを解く形(`by` が内部実行のロール)ではない
 *
 * action_spec を読めないとき(未選択・読み込みの失敗)は (a) を判定できないので何も出さない(読めない材料は
 * 実行計画の側の注記が名指す)。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { CreateRule, DelegateDecl, SpecModel } from '../../model/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { actorEntity } from '../../usecase/param-source-facts.js';
import { isSystemRule } from '../../usecase/actor-bound.js';
import type { Finding } from '../../kernel/finding.js';

/** この検証器の ID(owner と同じ、作成の値の出どころの宣言の接地)。 */
const VERIFIER_ID = 'V18';

/** 指摘を組み立てる。 */
function finding(entity: string, index: number, rule: CreateRule, decl: DelegateDecl, message: string, suggestion: string): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${entity} の creates[${index}](by: ${rule.by})の delegate ${decl.entity}.${decl.field} は${message}`,
    location: decl.location,
    suggestion,
    counterexample: { entity, rule: `creates[${index}]`, by: rule.by, field: `${decl.entity}.${decl.field}` },
  };
}

/** 要素 1 つの違反(当たっていれば null)。 */
function declFinding(model: SpecModel, actions: ActionSpecModel, entity: string, index: number, rule: CreateRule, decl: DelegateDecl): Finding | null {
  const at = (message: string, suggestion: string): Finding => finding(entity, index, rule, decl, message, suggestion);
  if (isSystemRule(rule, model.roles.roles)) {
    return at(
      '何も解きません(この規則のロールは内部実行で、実行者への参照の欄をもともと縛らない)',
      'この規則の delegate を消す(書いても縛りは変わらない)',
    );
  }
  const field = findEntitySpec(model, entity)?.fields.find((candidate) => candidate.name === decl.field);
  if (field === undefined) return at(' entity_spec に実在しません', `${entity} の entity.md に ${decl.field} を足すか、delegate の綴りを直す`);
  const actor = actorEntity(model);
  if (field.type.kind !== 'ref' || actor === null || field.type.entity !== actor) {
    return at(` ref(${actor ?? '実行者の集約'}) 型ではありません(実行者への参照の欄でなければ縛りは無く、解くものも無い)`, 'この要素を消す');
  }
  const create = actions.actions.find((candidate) => candidate.handles.raw === `${entity}.create`);
  if (create?.input.some((ref) => ref.entity === entity && ref.field === decl.field) !== true) {
    return at(
      ` ${entity}.create の action_spec の input にありません(人が選ばない欄は代理の対象にならず、縛りは解けない)`,
      `代理で人を選ぶ欄なら ${entity}.create の input に ${entity}.${decl.field} を足す。作成者で埋める欄なら delegate から外して owner に書く`,
    );
  }
  return null;
}

/**
 * 全ての作成の規則の `delegate` を見る。
 *
 * @param model ドメイン仕様
 * @param actions action_spec(読めなければ undefined = 判定しない)
 * @returns 違反
 */
export function delegateFindings(model: SpecModel, actions: ActionSpecModel | undefined): Finding[] {
  if (actions === undefined) return [];
  const findings: Finding[] = [];
  for (const specs of model.aggregates.values()) {
    const access = specs.access;
    if (access === undefined) continue;
    access.creates.forEach((rule, index) => {
      for (const decl of rule.delegate ?? []) {
        const found = declFinding(model, actions, access.entity, index, rule, decl);
        if (found !== null) findings.push(found);
      }
    });
  }
  return findings;
}
