/**
 * T17 の下位検査「不変条件を名指すトリガの条件を本文と照らせるか」(`t17-trigger-conditions.ts`。点検 21 回目 C21-4)のテスト。
 *
 * 照らせない不変条件は黙って外さず、理由つきの警告で名指す。理由は `Finding.reason` に載り、拡張候補の絞り
 * (`trigger_condition_inexpressible`)が形式定義の無いものだけを宿題に数える。読める・名指さないトリガは何も言わない。
 */

import { describe, expect, it } from 'vitest';
import { unreadableConditionFindings } from '../../../../lib/data/verifiers/t17-trigger-conditions.js';
import { T17_REASONS } from '../../../../lib/data/check-reasons.js';
import type { DataTriggerDecl } from '../../../../lib/model/data/types.js';
import type { InvariantFormal, SpecModel } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../../helpers/data-builder.js';

/** 題材: 1 つの集約に、形式定義の形の違う不変条件を並べる。 */
/** 題材(値が文字列なら形式定義の代わりに DSL の外である理由 `formal_outside` を書く)。 */
function domain(formals: Readonly<Record<string, InvariantFormal | string | undefined>>): SpecModel {
  return specModel([
    aggregate('box', {
      entity: entitySpec('box', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('open', { kind: 'boolean' }), field('size', { kind: 'integer' })] }),
      invariants: invariantSpec(
        Object.entries(formals).map(([id, formal]) =>
          invariant({ id, entities: ['box'], ...(formal === undefined ? {} : typeof formal === 'string' ? { formalOutside: formal } : { formal }) }),
        ),
      ),
    }),
  ]);
}

/** トリガ 1 本(不変条件を名指す / 名指さない)。 */
function trigger(name: string, id?: string): DataTriggerDecl {
  return { name, functionName: name, fires: 'before insert', deferred: false, supplies: [], params: {}, ...(id === undefined ? {} : { invariant: id }) };
}

describe('T17 照らせない不変条件の名指し', () => {
  it('理由ごとに警告を出し、読める・名指さないトリガは何も言わない', () => {
    const model = domain({
      'INV-BOX-001': '下限の件数で、cardinality は上限だけを言う',
      'INV-BOX-005': undefined,
      'INV-BOX-002': { kind: 'uniqueness', keys: ['size'] },
      'INV-BOX-003': { kind: 'check', expr: 'box.open ==' },
      'INV-BOX-004': { kind: 'check', expr: 'box.open == false or box.size > 0' },
    });
    const table = dataTable('boxes', {
      entity: 'box',
      triggers: [
        trigger('no_formal', 'INV-BOX-001'),
        trigger('formal_missing', 'INV-BOX-005'),
        trigger('uniq', 'INV-BOX-002'),
        trigger('broken', 'INV-BOX-003'),
        trigger('readable', 'INV-BOX-004'),
        trigger('missing', 'INV-BOX-999'),
        trigger('unnamed'),
      ],
    });
    const findings = unreadableConditionFindings('T17', model, [table]);
    expect(findings.map((finding) => [finding.counterexample?.trigger, finding.reason, finding.severity])).toEqual([
      ['no_formal', T17_REASONS.conditionNoFormal, 'warning'],
      ['formal_missing', T17_REASONS.conditionFormalMissing, 'warning'],
      ['uniq', T17_REASONS.conditionKindOutside, 'warning'],
      ['broken', T17_REASONS.conditionUnparsable, 'warning'],
      ['missing', T17_REASONS.conditionMissingInvariant, 'warning'],
    ]);
    expect(findings[0]?.message).toContain('INV-BOX-001');
    // 受け入れは不変条件ごと: 名前と理由が毎回の警告に出る(点検 22 回目 C22-3)。
    expect(findings[0]?.message).toContain('理由: 下限の件数で、cardinality は上限だけを言う');
    expect(findings[1]?.message).toContain('INV-BOX-005');
    expect(findings[0]?.location.pointer).toBe('triggers.no_formal');
    expect(findings.every((finding) => finding.verifier === 'T17' && finding.suggestion !== '')).toBe(true);
  });

  it('真偽・数の欄だけの不変条件は欄の名前で照らせるので名指さない(語が無くても黙らない形になった。C21-4)', () => {
    const model = domain({ 'INV-BOX-001': { kind: 'check', expr: 'box.open == false or box.size > 0' } });
    expect(unreadableConditionFindings('T17', model, [dataTable('boxes', { entity: 'box', triggers: [trigger('t', 'INV-BOX-001')] })])).toEqual([]);
  });
});
