/**
 * 変異の目録の起動口(`lib/mutation/context-report.ts`)の単体テスト(設計メモ framework-modules §13)。
 *
 * 起動は組み立ての根(CLI と通し実行)の側が行い、生成器の側は結果を受け取るだけである。
 * ここで固定するのは「材料が足りないときは回さず、理由つきの unavailable」「材料が揃えば実測(ran)を返す」の 2 つ
 * (回さないことを「穴 0 件」と読ませない)。
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import { mutationReportOfContext } from '../../../lib/mutation/context-report.js';
import { ALL_MUTATION_DETECTORS } from '../../../lib/mutation/detectors.js';
import { aggregate, accessSpec, entitySpec, event, field, machine, readRule, role, specModel } from '../../helpers/model-builder-v8plus.js';
import { guaranteeModel } from '../../helpers/guarantee-builder.js';

const MODEL = specModel({
  roles: [role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'doc',
      entity: entitySpec('doc', [field('state', { kind: 'state', machine: 'doc' })]),
      stateMachines: [
        machine({ machine: 'doc', states: ['draft', 'published'], events: [event({ id: 'publish', from: ['draft'], to: 'published', by: ['member'] })] }),
      ],
      access: accessSpec('doc', { reads: [readRule('member', { kind: 'own' })] }),
    }),
  ],
});

const BASE: GenerateContext = { repoRoot: '/repo', guards: createGuardServices() } as GenerateContext;

describe('mutationReportOfContext(組み立ての根が起動する口)', () => {
  it('保証台帳が無い・読めていなければ回さず、理由を言う(unavailable)', () => {
    const tables = { available: true, tables: [] } as const;
    expect(mutationReportOfContext(MODEL, { ...BASE, dataTables: tables })).toEqual({ state: 'unavailable', reason: '保証台帳が無い' });
    expect(mutationReportOfContext(MODEL, { ...BASE, dataTables: tables, guarantees: guaranteeModel([], { available: false }) })).toEqual({
      state: 'unavailable',
      reason: '保証台帳が無い',
    });
    expect(mutationReportOfContext(MODEL, { ...BASE, dataTables: tables, guarantees: { available: true, catalog: null } })).toEqual({
      state: 'unavailable',
      reason: '保証台帳が読めていない',
    });
  });

  it('テーブル仕様が読めていなければ回さず、理由を言う(unavailable)', () => {
    const guarantees = guaranteeModel([]);
    const expected = { state: 'unavailable', reason: 'テーブル仕様が読めていない' };
    expect(mutationReportOfContext(MODEL, { ...BASE, guarantees })).toEqual(expected);
    expect(mutationReportOfContext(MODEL, { ...BASE, guarantees, dataTables: { available: false, tables: [] } })).toEqual(expected);
  });

  it('材料が揃えば実測を返す(ran。検査の全数が表の列に入る)', () => {
    const outcome = mutationReportOfContext(MODEL, { ...BASE, guarantees: guaranteeModel([]), dataTables: { available: true, tables: [] } });
    if (outcome.state !== 'ran') throw new Error(`回せるはずの材料で ${outcome.state}`);
    expect(outcome.report.detectors.map((detector) => detector.id)).toEqual(ALL_MUTATION_DETECTORS.map((detector) => detector.id));
    expect(outcome.report.rows.length).toBeGreaterThan(0);
  });
});
