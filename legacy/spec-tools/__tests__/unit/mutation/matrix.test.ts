/**
 * 対応表の実測(`lib/mutation/matrix.ts`)の単体テスト(束 ⑳-5c)。
 *
 * ここで固定したいのは **「穴は穴として出る」**ことである。実物の題材(製品 + 4 題材)では
 * 穴が 0 件なので、そちらのテストが緑であることは「穴を見つけられる」ことを示さない ——
 * 穴が出る題材を 1 つ作って、`caughtBy` が空になることを見る(空振りの緑を避ける)。
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import { ALL_MUTATION_DETECTORS } from '../../../lib/mutation/detectors.js';
import { ALL_MUTATION_OPERATORS } from '../../../lib/mutation/operators.js';
import { mutationReportOf, mutationRows, mutationSubjectOf, operatorsWithoutSite } from '../../../lib/mutation/matrix.js';
import { UNMUTATED_DECLARATIONS } from '../../../lib/mutation/scope.js';
import type { MutationSubject } from '../../../lib/mutation/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  readRule,
  role,
  specModel,
} from '../../helpers/model-builder-v8plus.js';

/** テーブル仕様も action_spec も無い題材(執行点が 1 つも生成されない = 観測できるものが無い)。 */
function bareModel(): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [field('state', { kind: 'state', machine: 'doc' })]),
        stateMachines: [
          machine({
            machine: 'doc',
            states: ['draft', 'published'],
            events: [event({ id: 'publish', from: ['draft'], to: 'published', by: ['member'] })],
          }),
        ],
        access: accessSpec('doc', { reads: [readRule('member', { kind: 'own' })] }),
      }),
    ],
  });
}

/** その題材の材料(仕様は 1 種だけ = data_table も action_spec も無い)。 */
function bareSubject(): MutationSubject {
  const guards = createGuardServices();
  return mutationSubjectOf({
    name: 'bare',
    model: bareModel(),
    guards,
    actions: undefined,
    dataTables: undefined,
    jobs: undefined,
    context: { repoRoot: '/repo', guards } as GenerateContext,
  });
}

describe('mutationReportOf(人向けの本へ渡すデータ)', () => {
  it('実測の行と、表の行・列の並び(変異器と検査の全数)・壊せなかった変異器・範囲の宣言を運ぶ', () => {
    const subject = bareSubject();
    const report = mutationReportOf(subject);

    expect(report.rows).toEqual(mutationRows(subject));
    expect(report.operators.map((operator) => operator.id)).toEqual(ALL_MUTATION_OPERATORS.map((operator) => operator.id));
    expect(report.operators.map((operator) => operator.breaks)).toEqual(ALL_MUTATION_OPERATORS.map((operator) => operator.breaks));
    expect(report.detectors).toEqual(ALL_MUTATION_DETECTORS.map((detector) => ({ id: detector.id, title: detector.title })));
    expect(report.withoutSite).toEqual(operatorsWithoutSite(subject.model));
    expect(report.scope.length).toBeGreaterThan(0);
    expect(report.unmutated).toEqual(UNMUTATED_DECLARATIONS);
  });
});

describe('mutationRows', () => {
  it('観測できるものが 1 つも無い題材では、変異が穴として出る(空振りの緑を作らない)', () => {
    const rows = mutationRows(bareSubject());

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.caughtBy.length === 0)).toBe(true);
  });

  it('捕った検査の ID は目録の ID だけ(空の題材は捕らない。実物の題材の値は mutation-matrix.test.ts が見る)', () => {
    const ids = new Set(ALL_MUTATION_DETECTORS.map((detector) => detector.id));
    const rows = mutationRows(bareSubject());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.flatMap((row) => row.caughtBy).filter((caught) => !ids.has(caught))).toEqual([]);
  });

  it('壊せる場所は全部実行する(件数の上限を持たない = 残りを黙って見ないことにしない)', () => {
    const subject = bareSubject();
    const rows = mutationRows(subject);

    for (const operator of ALL_MUTATION_OPERATORS) {
      const sites = operator.mutate(subject.model).length;
      expect(rows.filter((row) => row.operator === operator.id)).toHaveLength(sites);
    }
  });

  it('宣言が無い題材では宣言された例外も立たない(穴が例外に化けない)', () => {
    for (const row of mutationRows(bareSubject())) expect(row.exemption).toBeUndefined();
  });
});

describe('operatorsWithoutSite', () => {
  it('壊せる場所が無い変異器を宣言する(穴と区別するため)', () => {
    const without = operatorsWithoutSite(bareModel());

    expect(without).toContain('drop_read_filters');
    expect(without).toContain('flip_guard_compare');
    expect(without).not.toContain('drop_role_from_by');
  });
});
