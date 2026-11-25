import { describe, expect, it } from 'vitest';

import { invariantTableGenerator } from '../../../../lib/generate/render/invariant-table.js';
import type { InvariantDef, InvariantSpec } from '../../../../lib/model/types.js';
import { aggregate, loc, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

function invariant(overrides: Partial<InvariantDef> & Pick<InvariantDef, 'id' | 'statement'>): InvariantDef {
  return {
    entities: [],
    enforcedBy: [],
    location: loc('docs/specs/domain/entry/invariants.md', `invariants.${overrides.id}`),
    ...overrides,
  };
}

function invariantSpec(invariants: readonly InvariantDef[]): InvariantSpec {
  return { invariants, location: loc('docs/specs/domain/entry/invariants.md') };
}

describe('invariantTableGenerator', () => {
  it('formal の種類ごとに要点を文字列化し、執行点を kind: ref のカンマ区切りにする', () => {
    const invariants = [
      invariant({
        id: 'INV-ENTRY-001',
        statement: '同一発表者は同一催しにアクティブなエントリーを 1 つしか持てない',
        formal: {
          kind: 'uniqueness',
          keys: ['workshop_id', 'performer_id'],
          where: 'entry.state not in [rejected, withdrawn]',
        },
        enforcedBy: [
          { kind: 'db_constraint', ref: 'entries_active_unique', location: loc('x') },
          { kind: 'guard', ref: 'entry.submit', location: loc('x') },
        ],
      }),
      invariant({
        id: 'INV-ENTRY-002',
        statement: '催しのアクティブなエントリー数は capacity を超えない',
        formal: { kind: 'cardinality', keys: ['workshop_id'], max: 'workshop.capacity' },
        enforcedBy: [{ kind: 'trigger', ref: 'check_entry_capacity', location: loc('x') }],
      }),
      invariant({
        id: 'INV-PROGRAM-003',
        statement: '公開後のプログラムは受理済みエントリーのみ',
        formal: {
          kind: 'state_dependency',
          if: 'workshop.state == program_published',
          then: 'entry.state == accepted',
        },
        enforcedBy: [{ kind: 'application', ref: 'buildProgram', location: loc('x') }],
      }),
    ];
    const model = specModel([aggregate('entry', { invariants: invariantSpec(invariants) })]);

    const sections = invariantTableGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.marker).toBe('invariant-table');
    expect(sections[0]?.file).toBe('docs/specs/domain/entry/invariants.md');

    const content = sections[0]?.content ?? '';
    expect(content).toContain(
      '| INV-ENTRY-001 | 同一発表者は同一催しにアクティブなエントリーを 1 つしか持てない | unique(workshop_id, performer_id) where entry.state not in [rejected, withdrawn] | db_constraint: entries_active_unique, guard: entry.submit |',
    );
    expect(content).toContain(
      '| INV-ENTRY-002 | 催しのアクティブなエントリー数は capacity を超えない | count(workshop_id) <= workshop.capacity | trigger: check_entry_capacity |',
    );
    expect(content).toContain(
      '| INV-PROGRAM-003 | 公開後のプログラムは受理済みエントリーのみ | if workshop.state == program_published then entry.state == accepted | application: buildProgram |',
    );
  });

  it('formal が check の場合は `check(expr)` の形でコード表記する', () => {
    const invariants = [
      invariant({
        id: 'INV-WORKSHOP-001',
        statement: 'エントリー締切は開演日時より前でなければならない',
        formal: { kind: 'check', expr: 'workshop.entry_deadline < workshop.starts_at' },
        enforcedBy: [{ kind: 'db_constraint', ref: 'workshop_deadline_before_start', location: loc('x') }],
      }),
    ];
    const model = specModel([aggregate('workshop', { invariants: invariantSpec(invariants) })]);

    const content = invariantTableGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain(
      '| INV-WORKSHOP-001 | エントリー締切は開演日時より前でなければならない | `check(workshop.entry_deadline < workshop.starts_at)` | db_constraint: workshop_deadline_before_start |',
    );
  });

  it('formal が無い不変条件は「DSL外」と表示し、invariants.md を持たない集約はスキップする', () => {
    const invariants = [
      invariant({
        id: 'INV-WORKSHOP-001',
        statement: 'entry_deadline は starts_at より前',
        enforcedBy: [{ kind: 'application', ref: 'validateWorkshopSchedule', location: loc('x') }],
      }),
    ];
    const model = specModel([
      aggregate('workshop', { invariants: invariantSpec(invariants) }),
      aggregate('member', {}),
    ]);

    const sections = invariantTableGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.content).toContain(
      '| INV-WORKSHOP-001 | entry_deadline は starts_at より前 | DSL外(コード+テスト義務) | application: validateWorkshopSchedule |',
    );
  });
});
