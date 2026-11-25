/**
 * Y1 参照実在のチェック。
 *
 * usecase-spec-writing.md の Y1:「actor が roles.md に実在するグローバル人間ロールであり、
 * start が実在する画面 id、steps の各 op がドメイン仕様(状態遷移または予約 ID)に接地し、
 * done がパースでき、参照するパスが実在の状態フィールドを指し、`accept` が名指しする
 * 不変条件 id が実在すること」。
 *
 * ADR-0011 の帰結として、usecase_spec に書けるのは「名前への参照」だけである(ドメインの
 * 操作の意味を再定義できない)。Y1 はその参照がすべて実在することだけを見る —— 中身の
 * 正しさ(順序・到達・原子性・予算・整合)は Y2〜Y6 の役目である。
 */

import type { SpecModel } from '../../model/types.js';
import type { GuardServices } from '../../guard/ast.js';
import type { UsecaseAcceptDecl, UsecaseSpec } from '../../model/usecase/types.js';
import type { Finding, UsecaseContext, UsecaseVerifier } from '../verifier.js';
import { screensBlocked, usecaseFinding } from '../verifier.js';
import type { UsecaseInput } from '../derive.js';
import { flattenSteps } from '../derive.js';
import { findRole, isContextRole } from '../../semantics/domain-lookup.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { entityStateView } from '../../semantics/entity-state-axes.js';

/** Y1: actor / start / steps / done の接地先が実在することを検証する。 */
export const referenceExistenceVerifier: UsecaseVerifier = {
  id: 'Y1',
  title: '参照実在 — actor / start / steps / done がドメイン仕様・画面仕様に実在する',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    if (!input.usecases.available) return [];
    return input.usecases.usecases.flatMap((usecase) => [
      ...checkActor(usecase, input),
      ...(screensBlocked(ctx) ? [] : checkStart(usecase, input)), // 画面が阻害なら start の実在は言わない(行は呼び手が言う)
      ...checkSteps(usecase, input),
      ...checkDone(usecase, input.domain, ctx.guards),
      ...checkAcceptedInvariants(usecase, input.domain),
    ]);
  },
};

/**
 * `accept` が名指しする不変条件 id が実在するか(Y10 の warning の受け入れ)。
 *
 * 綴り違いは「受け入れたつもりで受け入れられていない」= warning が出続けるので気付けるが、
 * **逆に「消えた不変条件の受け入れが残る」ことには気付けない**(warning が出ないのが正常な
 * 状態と区別できない)。宣言が実在を指すことをここで見る。
 */
function checkAcceptedInvariants(usecase: UsecaseSpec, domain: SpecModel): Finding[] {
  const declared = new Set<string>();
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) declared.add(invariant.id);
  }
  const accepted = usecase.accept.filter(
    (decl): decl is Extract<UsecaseAcceptDecl, { kind: 'invariant' }> => decl.kind === 'invariant',
  );
  return accepted
    .filter((decl) => !declared.has(decl.invariant))
    .map((decl) =>
      usecaseFinding('Y1', {
        message: `受け入れ(accept)が名指しする不変条件 ${decl.invariant} が invariant_spec にありません`,
        location: decl.location,
        suggestion:
          'invariant_spec(specs/domain/{集約}/invariants.md)に実在する id を書く。' +
          'その不変条件が無くなったなら、受け入れの宣言も消す(受け入れは対象が実在する間だけ意味を持つ)',
        counterexample: { usecase: usecase.name, invariant: decl.invariant },
      }),
    );
}

/** actor が実在するグローバル人間ロールか(S4 の checkAudience と同じ規則)。 */
function checkActor(usecase: UsecaseSpec, input: UsecaseInput): Finding[] {
  const role = findRole(input.domain, usecase.actor);
  if (role === null) {
    return [
      usecaseFinding('Y1', {
        message: `actor のロール ${usecase.actor} が roles.md にありません`,
        location: { file: usecase.location.file, pointer: 'actor' },
        suggestion: 'specs/domain/roles.md に定義されたロール ID を書く',
        counterexample: { usecase: usecase.name, actor: usecase.actor },
      }),
    ];
  }
  if (!isContextRole(input.domain, usecase.actor)) return [];
  return [
    usecaseFinding('Y1', {
      message: `actor のロール ${usecase.actor} は文脈依存ロールです(roles.md に binding がある)`,
      location: { file: usecase.location.file, pointer: 'actor' },
      suggestion:
        `actor に書けるのは「誰が始めるか」= グローバルロールだけ。${usecase.actor} が implies で` +
        '含意するロール(例: member)に直す(文脈依存ロールは操作の結果として立つもので、開始時点では持てない)',
      counterexample: { usecase: usecase.name, actor: usecase.actor },
    }),
  ];
}

/** start が実在する画面 id か。 */
function checkStart(usecase: UsecaseSpec, input: UsecaseInput): Finding[] {
  if (!input.screens.available) return [];
  const found = input.screens.screens.some((screen) => screen.id === usecase.start);
  if (found) return [];
  return [
    usecaseFinding('Y1', {
      message: `start ${usecase.start} が実在する画面ではありません`,
      location: { file: usecase.location.file, pointer: 'start' },
      suggestion: 'specs/frontend/screens に実在する screen_spec の id を書く',
      counterexample: { usecase: usecase.name, start: usecase.start },
    }),
  ];
}

/** steps の各 op がドメイン仕様に接地するか。 */
function checkSteps(usecase: UsecaseSpec, input: UsecaseInput): Finding[] {
  return flattenSteps(usecase).flatMap(({ save, step }) => {
    const grounding = groundOperation(input.domain, step.op);
    if (grounding.kind !== 'unknown') return [];
    return [
      usecaseFinding('Y1', {
        message: `${save.id} の手順 ${step.op} がドメイン仕様に接地しません`,
        location: step.location,
        suggestion:
          'op に状態遷移(`{machine}.{event}`)または予約 ID(`{entity}.create` / `.delete` / `.update`)を書く',
        counterexample: { usecase: usecase.name, save: save.id, op: step.op },
      }),
    ];
  });
}

/** done がパースでき、参照するパスが実在の状態フィールドを指すか。 */
function checkDone(usecase: UsecaseSpec, domain: SpecModel, guards: GuardServices): Finding[] {
  return doneShape(usecase, domain, guards) === null
    ? [
        usecaseFinding('Y1', {
          message: `done "${usecase.done}" を評価できません`,
          location: { file: usecase.location.file, pointer: 'done' },
          suggestion:
            'done は "{entity}.{状態フィールド} == {状態ID}" の形で書く(例: entry.state == submitted)。' +
            'entity は実在の集約、状態 ID はその状態機械に実在するもの',
          counterexample: { usecase: usecase.name, done: usecase.done },
        }),
      ]
    : [];
}

/** done の接地結果。Y6(達成条件の整合)が再利用できるよう export する。 */
export interface DoneShape {
  readonly aggregate: string;
  readonly machine: string;
  readonly stateField: string;
  readonly state: string;
}

/**
 * done を接地させる。パースでき、`{entity}.{state field}` == `{実在する状態}` の形であれば
 * その接地結果を返す。それ以外(パース不能・compare 以外・path が状態フィールドでない・
 * rhs がその機械の状態でない)は null。
 *
 * @param usecase 対象のユースケース
 * @param domain ドメイン仕様全体
 * @param guards ガード式の共有サービス
 */
export function doneShape(usecase: UsecaseSpec, domain: SpecModel, guards: GuardServices): DoneShape | null {
  const parsed = guards.parse(usecase.done);
  if (!parsed.ok || parsed.expr.kind !== 'compare' || parsed.expr.op !== '==') return null;
  const { path, rhs } = parsed.expr;
  if (path.segments.length !== 2 || rhs.kind !== 'symbol') return null;
  const [entity, field] = path.segments;
  if (entity === undefined || field === undefined) return null;
  const view = entityStateView(domain, entity);
  if (view === null) return null;
  const axis = view.axes.find((candidate) => candidate.stateField === field);
  if (axis === undefined) return null;
  if (!axis.machine.states.includes(rhs.value)) return null;
  return { aggregate: view.aggregate, machine: axis.machine.machine, stateField: field, state: rhs.value };
}
