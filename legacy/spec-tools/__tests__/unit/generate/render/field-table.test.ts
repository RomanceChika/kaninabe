import { describe, expect, it } from 'vitest';

import { fieldTableGenerator } from '../../../../lib/generate/render/field-table.js';
import type { FieldDef } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** field() ヘルパーは制約(max_length 等)を持たないため、必要な分だけ後付けする。 */
function withConstraints(base: FieldDef, extra: Partial<FieldDef>): FieldDef {
  return { ...base, ...extra };
}

describe('fieldTableGenerator', () => {
  it('型・制約・説明を持つフィールドを 1 行ずつレンダーする', () => {
    const fields = [
      withConstraints(field('id', { kind: 'uuid' }, { auto: true, description: 'エントリーID' }), {
        auto: true,
      }),
      withConstraints(
        field('workshop_id', { kind: 'ref', entity: 'workshop' }, { required: true, description: 'エントリー先の催し' }),
        {},
      ),
      withConstraints(
        field('title', { kind: 'string' }, { required: true, description: '演目名' }),
        { maxLength: 100 },
      ),
      withConstraints(field('duration_min', { kind: 'integer' }, { required: true }), { min: 1, max: 60 }),
    ];
    const model = specModel([aggregate('entry', { entity: entitySpec('entry', { fields }) })]);

    const sections = fieldTableGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.marker).toBe('field-table');
    expect(sections[0]?.file).toBe('docs/specs/domain/entry/entity.md');

    const content = sections[0]?.content ?? '';
    // auto は「入力として必須ではない」が「行には必ずある」— マトリクスが両方を写す(FE)
    expect(content).toContain('| id | uuid | —（行では必須） | auto=true | エントリーID |');
    expect(content).toContain('| workshop_id | ref(workshop) | ✓ | — | エントリー先の催し |');
    expect(content).toContain('| title | string | ✓ | max_length=100 | 演目名 |');
    expect(content).toContain('| duration_min | integer | ✓ | min=1, max=60 | — |');
  });

  it('label を 1 つでも持つエンティティは「表示名」列を挟む。持たなければ従来の列のまま', () => {
    const model = specModel([
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [
            field('title', { kind: 'string' }, { required: true, label: '催しタイトル', description: '催しタイトル' }),
            field('venue', { kind: 'string' }, { description: '会場' }),
          ],
        }),
      }),
    ]);

    const content = fieldTableGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('| フィールド | 表示名(label) | 型 | 必須 | 制約 | 説明 |');
    expect(content).toContain('| title | 催しタイトル | string | ✓ | — | 催しタイトル |');
    // label の無いフィールドの表示名セルは — で埋める。
    expect(content).toContain('| venue | — | string | — | — | 会場 |');
  });

  it('description が無ければ「—」、entity.md を持たない集約はスキップする', () => {
    const model = specModel([
      aggregate('entry', {
        entity: entitySpec('entry', { fields: [field('note', { kind: 'text' })] }),
      }),
      aggregate('member_only_states', {}),
    ]);

    const sections = fieldTableGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.content).toContain('| note | text | — | — | — |');
  });

  it('state 型も「行では必須」として書く(入力には現れないが行には必ずある)', () => {
    const model = specModel([
      aggregate('entry', {
        entity: entitySpec('entry', {
          fields: [field('state', { kind: 'state', machine: 'entry' }, { description: '状態' })],
        }),
      }),
    ]);

    const sections = fieldTableGenerator.generate(model, GEN_CTX);

    expect(sections[0]?.content).toContain('| state | state(entry) | —（行では必須） | — | 状態 |');
  });

  it('持っていれば効く値(bearer)の欄は、制約の列に寿命の宣言の種類を印として出す', () => {
    const location = { file: 'invite/entity.md', pointer: 'fields[0].bearer' };
    const reusable = withConstraints(field('code', { kind: 'string' }), {
      maxLength: 43,
      suppliedBy: 'db',
      bearer: { kind: 'reusable', reason: '何人でも入れる窓口', location },
    });
    const expiring = withConstraints(field('token', { kind: 'string' }), {
      maxLength: 43,
      suppliedBy: 'db',
      bearer: { kind: 'expiring', expiresAt: 'expires_at', usedAt: 'used_at', location },
    });
    const model = specModel([aggregate('invite', { entity: entitySpec('invite', { fields: [reusable, expiring] }) })]);

    const content = fieldTableGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('| code | string | —（DB が供給） | max_length=43, supplied_by=db, bearer=reusable |');
    expect(content).toContain('| token | string | —（DB が供給） | max_length=43, supplied_by=db, bearer=expiring |');
  });
});
