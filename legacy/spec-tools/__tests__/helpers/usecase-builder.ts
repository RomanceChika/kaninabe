/**
 * ユースケース検証器(Y 群)・導出(derive.ts)のテスト用ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器のテストはファイル I/O を行わず、
 * 入力をテスト内でリテラル構築する。ここではその定型部分(location の埋め草・
 * 省略可能フィールドの扱い)だけを引き受ける。ドメイン側は model-builder.ts、
 * action_spec は trace-builder.ts、screen_spec は screen-builder.ts を使う。
 */

import type {
  UsecaseAcceptDecl,
  UsecaseBudget,
  UsecaseBudgetMetric,
  UsecaseSaveDecl,
  UsecaseSpec,
  UsecaseStepDecl,
} from '../../lib/model/usecase/types.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

const FILE = 'docs/specs/frontend/usecases/test.md';

/** steps[] の 1 要素を作る。as / label は既定 null(鍵は op)、repeat / defaultsSelf は既定 false。 */
export function usecaseStep(
  op: string,
  opts: { as?: string; label?: string; repeat?: boolean; defaultsSelf?: boolean } = {},
): UsecaseStepDecl {
  return {
    op,
    alias: opts.as ?? null,
    label: opts.label ?? null,
    repeat: opts.repeat ?? false,
    defaultsSelf: opts.defaultsSelf ?? false,
    location: loc(FILE, `saves.steps.${opts.as ?? op}`),
  };
}

/** saves[] の 1 要素を作る。migration は「name=test_usecase」に対応する既定名を使う。 */
export function usecaseSave(
  id: string,
  steps: readonly UsecaseStepDecl[],
  opts: { label?: string; migration?: string; name?: string } = {},
): UsecaseSaveDecl {
  const name = opts.name ?? 'test_usecase';
  return {
    id,
    label: opts.label ?? `${id} の説明`,
    migration: opts.migration ?? `20260101000001_usecase_${name}_${id}.sql`,
    steps,
    location: loc(FILE, `saves.${id}`),
  };
}

/** accept[] の 1 要素(予算の受け入れ)を作る。 */
export function usecaseAccept(metric: UsecaseBudgetMetric, reason = '受け入れる理由'): UsecaseAcceptDecl {
  return { kind: 'budget', metric, reason, location: loc(FILE, `accept.${metric}`) };
}

/** accept[] の 1 要素(実行しない不変条件の受け入れ)を作る。 */
export function usecaseAcceptInvariant(invariant: string, reason = '受け入れる理由'): UsecaseAcceptDecl {
  return { kind: 'invariant', invariant, reason, location: loc(FILE, `accept.${invariant}`) };
}

/** usecase_spec 1 件を作る。id は name から既定で導く。 */
export function usecaseSpec(init: {
  name?: string;
  goal?: string;
  actor?: string;
  start?: string;
  done?: string;
  saves: readonly UsecaseSaveDecl[];
  budget?: UsecaseBudget;
  accept?: readonly UsecaseAcceptDecl[];
  testCases?: readonly ActionTestCase[];
}): UsecaseSpec {
  const name = init.name ?? 'test_usecase';
  return {
    id: `usecase-${name.split('_').join('-')}`,
    name,
    goal: init.goal ?? 'テスト用の目的',
    actor: init.actor ?? 'member',
    start: init.start ?? 'screen-list',
    done: init.done ?? 'item.state == submitted',
    saves: init.saves,
    budget: init.budget ?? {},
    accept: init.accept ?? [],
    testCases: init.testCases ?? [],
    relPath: `${name}.md`,
    location: loc(FILE),
  };
}
