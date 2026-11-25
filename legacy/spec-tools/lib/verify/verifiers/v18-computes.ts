/**
 * V18 計算値(`computes`)の接地。
 *
 * action-spec-writing.md §computes の要求: `computes` に並ぶ欄は
 *   (a) **その操作の `input` に無い**(入力で受け取るなら計算ではない)
 *   (b) 対象の entity_spec に**実在する**
 *   (c) **どの `writes` の規則にも並ばない**(ロールを問わない。判定は `computes` が名指しした集約
 *       —— `{entity}.{field}` の左 —— の access_spec で引く。裸の欄名で照合すると別の集約の同名の欄で外れる)。
 *       **計算で決まる値は入力として受け付けない**(2026-10-20 オーケストレーターの裁定)。書くのは computes を宣言した
 *       操作の RPC(または計画)だけで、書いてよい根拠は computes の宣言そのものである。生成する編集の RPC は
 *       計算値を変更集合(`p_changes`)の外の引数 `p_{欄}` で受け、変更集合の母集合とロールの門は `writes` から作る
 *       ので、`writes` に並ばなければ編集の経路は生まれない。人の行に並べば人が計算値を直に書ける形、
 *       内部実行(`by: system`)の行に並べば内部実行が編集の RPC で計算値を直に書ける形になる。
 *       以前は逆に「遷移・別の集約の計算値は `by: system` の行で許す」ことを求めていた。その行が内部実行の
 *       編集の経路を作り、確定額を誰の指示でも書き換えられたので、要求を裏返した
 *   (d) `supplied_by: db` **ではない**(DB が決める値を実装が計算し直さない)
 *
 * 例の表(`computes[].examples`)の接地は下位検査として `v18-compute-examples.ts` が、作成の持ち主の欄(`owner`)の接地は
 * `v18-owner.ts` が、作成の規則の代理の欄(`delegate`)の接地は `v18-delegate.ts` が見る(新しい規則 ID は増やさない)。
 *
 * ## なぜこの検査が要るのか
 *
 * 「入力にも実行者にも DB にも無いが、書き込みの時に決まる値」(料金の確定額・遅れ確定の席)は、
 * 宣言の場所が無かったあいだ **TS の operation が計算して RPC に渡す**形で実装の中にだけ
 * 住んでいた。`computes` はそれを宣言の側に出す欄だが、宣言できるようにしただけでは
 * 「計算値を入力でも受け付ける」という**別の抜け道**が開く —— 計算値の列を `writes` にも並べると、
 * 編集の RPC が変更集合でその列を受け、純関数の決めた値を呼び手が上書きできてしまう。V18 はその口を閉じる。
 * 計算値の列が「どの操作が書くか」は `computes` の宣言が名指しし、ハンドブックと計画に現れる(誰も宣言していない
 * 列は書かれない)。
 *
 * `supplied_by: db` にできるものは DB へ寄せる(V17)。ここに残るのは、集計とポリシーの
 * 組み合わせで SQL 化の判断が済んでいない計算だけである(束 ⑰ 設計 §3-2)。
 */

import type { EntitySpec, FieldDef, SpecModel, WriteRule } from '../../model/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import type { ActionComputeDecl, ActionSpec } from '../../model/trace/types.js';
import { findAccessSpec, findEntitySpec } from '../../semantics/domain-lookup.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import { inputValue } from '../../kernel/input-state.js';
import { computeExampleFindings } from './v18-compute-examples.js';
import { ownerFindings } from './v18-owner.js';
import { delegateFindings } from './v18-delegate.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V18';

/** V18 の指摘を組み立てる。 */
function finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * その集約の `writes` の規則のうち、その欄を並べているもの(宣言順)。
 *
 * **ロールを問わない** —— 人の行なら人が計算値を直に書ける形、内部実行の行なら内部実行が編集の RPC で
 * 計算値を直に書ける形であり、どちらも「計算で決まる値を入力として受け付ける」経路になる。
 */
function writesListing(model: SpecModel, entity: string, field: string): readonly WriteRule[] {
  return (findAccessSpec(model, entity)?.writes ?? []).filter((rule) => rule.fields.includes(field));
}

/** 計算値を編集の規則に並べた形の指摘(人の行と内部実行の行で攻撃の一文が違う)。 */
function writesFinding(model: SpecModel, op: string, decl: ActionComputeDecl, rule: WriteRule): Finding {
  const system = rule.by === systemRoleId(model.roles.roles);
  return finding({
    message: system
      ? `${op} の computes が指す ${decl.raw} が、${decl.entity} の access.md の writes(by: ${rule.by})にも並んでいます` +
        '(内部実行が編集の RPC で計算値を直に書ける形です)'
      : `${op} の computes が指す ${decl.raw} が、${decl.entity} の access.md の writes(by: ${rule.by})にも並んでいます` +
        '(人が計算で決まる値を直に書ける形です)',
    location: rule.location,
    suggestion:
      `${decl.entity} の access.md の writes の by: ${rule.by} の行から ${decl.field} を外す。` +
      '計算で決まる値は入力として受け付けない —— 書くのは computes を宣言した操作の RPC(または計画)だけで、' +
      '書いてよい根拠は computes の宣言そのものである。人が直す値なら computes から外して input に置く',
    counterexample: { action: op, field: decl.raw, writer: rule.by },
  });
}

/** 1 件の `computes` 宣言を見る。 */
function checkCompute(
  model: SpecModel,
  action: ActionSpec,
  decl: ActionComputeDecl,
): Finding[] {
  const op = action.handles.raw;
  const entity: EntitySpec | undefined = findEntitySpec(model, decl.entity) ?? undefined;
  const field: FieldDef | undefined = entity?.fields.find((candidate) => candidate.name === decl.field);
  if (entity === undefined || field === undefined) {
    return [
      finding({
        message: `${op} の computes が指す ${decl.raw} は entity_spec に実在しません`,
        location: decl.location,
        suggestion: `${decl.entity} の entity.md に ${decl.field} を足すか、computes の綴りを直す`,
        counterexample: { action: op, field: decl.raw },
      }),
    ];
  }
  if (action.input.some((ref) => ref.entity === decl.entity && ref.field === decl.field)) {
    return [
      finding({
        message: `${op} の computes が指す ${decl.raw} は同じ操作の input にも現れます`,
        location: decl.location,
        suggestion:
          'input から外すか computes から外す。「人が入れる」と「実行時に純関数が決める」を' +
          '同じ欄について同時に宣言できない',
        counterexample: { action: op, field: decl.raw },
      }),
    ];
  }
  if (field.suppliedBy === 'db') {
    return [
      finding({
        message: `${op} の computes が指す ${decl.raw} は supplied_by: db です`,
        location: decl.location,
        suggestion:
          'DB が決める値をアプリが計算し直すと、正が 2 つになる。computes から外す' +
          '(その欄の値は data_table の defaults / triggers が決める)',
        counterexample: { action: op, field: decl.raw },
      }),
    ];
  }
  return writesListing(model, entity.entity, decl.field).map((rule) => writesFinding(model, op, decl, rule));
}

/** V18 の実装。 */
export const computesVerifier: Verifier = {
  id: VERIFIER_ID,
  title: '計算値の接地 — computes の欄は入力に無く、実在し、DB が決める値でなく、どの writes の規則にも並ばない',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];
    const loaded = inputValue(ctx.actions);
    const actions = loaded?.actions ?? [];
    for (const action of actions) {
      for (const decl of action.computes) findings.push(...checkCompute(model, action, decl));
      // 持ち主の欄(`owner`)の接地。計算値と同じ「action_spec が宣言する値の出どころ」の接地として V18 の下位検査で見る。
      findings.push(...ownerFindings(model, action));
    }
    // 例の表(`examples`)の接地。新しい規則 ID は増やさず、計算値の接地である V18 の下位検査として見る。
    findings.push(...computeExampleFindings(model, actions));
    // 作成の規則の代理の欄(`delegate`)の接地。名指しが当たらない要素は何も解かない腐った宣言なので、owner と同じ下位検査で見る。
    findings.push(...delegateFindings(model, loaded));
    return findings;
  },
};
