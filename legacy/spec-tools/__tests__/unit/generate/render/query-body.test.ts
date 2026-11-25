import { describe, expect, it } from 'vitest';

import { queryBodyGenerator } from '../../../../lib/generate/render/query-body.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { testCase } from '../../../helpers/trace-builder.js';
import { GEN_CTX, genContextWithQueries } from '../../../helpers/generate-context.js';

/** params / projection の引き当て先になる workshop エンティティ。 */
function workshopModel() {
  return specModel([
    aggregate('workshop', {
      entity: entitySpec('workshop', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true, description: '催しID' }),
          field('title', { kind: 'string' }, { required: true, description: '催しタイトル' }),
        ],
      }),
    }),
  ]);
}

describe('queryBodyGenerator', () => {
  it('宣言・params・filters・includes・projection・テストケースを表にする', () => {
    const query = querySpec({
      name: 'workshop_detail',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      returns: 'one',
      params: [{ name: 'workshop_id', ref: 'workshop.id' }],
      filters: ['id == param.workshop_id'],
      includes: [
        {
          entity: 'entry',
          scopeUsed: 'own',
          via: 'performer',
          filters: ['state in [draft, submitted]'],
          projection: ['id', 'title'],
          sort: [{ field: 'title', direction: 'asc' }],
        },
      ],
      projection: ['id', 'title'],
      testCases: [
        testCase({
          id: 'TC-WORKSHOP-DETAIL-001',
          type: 'integration',
          covers: ['success'],
          specIds: ['query-workshop-detail'],
          implementation: 'app/src/composition/__tests__/workshop/workshop_detail.test.ts::読める',
        }),
      ],
    });

    const sections = queryBodyGenerator.generate(workshopModel(), genContextWithQueries([query]));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/queries/workshop/workshop_detail.md');
    expect(sections[0]?.marker).toBe('query-body');

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| source | workshop |');
    expect(content).toContain('| 実行ロール（for） | member |');
    expect(content).toContain('| 可視性の供給元（via） | —（for 自身の reads） |');
    expect(content).toContain('| スコープ（scope_used） | all |');
    expect(content).toContain('| 返し方 | one |');
    // params は ref の指すフィールド定義の引き写し
    expect(content).toContain('| workshop_id（ref: workshop.id） | uuid | —（行では必須） | auto=true | 催しID |');
    expect(content).toContain('- `id == param.workshop_id`');
    // includes は 1 行 1 併読(via・filters・sort まで写す)
    expect(content).toContain(
      '| entry | own | performer | `state in [draft, submitted]` | id, title | title asc | —（全件） |',
    );
    expect(content).toContain('| title | string | ✓ | — | 催しタイトル |');
    expect(content).toContain('| TC-WORKSHOP-DETAIL-001 | integration | success | — | query-workshop-detail |');
  });

  it('paging は返し方のセルにまとめ、params・includes が無いときは節を畳む', () => {
    const query = querySpec({
      name: 'workshop_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      returns: 'many',
      paging: { kind: 'cursor' },
      projection: ['id'],
    });

    const content =
      queryBodyGenerator.generate(workshopModel(), genContextWithQueries([query]))[0]?.content ?? '';

    expect(content).toContain('| 返し方 | many / cursor |');
    expect(content).toContain('実行時入力はない');
    expect(content).not.toContain('### includes');
    // filters 0 本は —(書き忘れと区別が付くよう見出しは残す)
    expect(content).toContain('### filters（絞り込み）\n\n—');
  });

  it('query_spec を読み込んでいない文脈では何も生成しない', () => {
    expect(queryBodyGenerator.generate(workshopModel(), GEN_CTX)).toHaveLength(0);
  });

  it('paging: none には有界性の根拠(bounded_by)の行を足す', () => {
    const withParent = querySpec({
      name: 'workshop_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      paging: { kind: 'none' },
      boundedBy: { kind: 'parent', aggregate: 'venue', reason: 'capacity で有界' },
      projection: ['id'],
    });
    const withWindow = querySpec({
      name: 'workshop_my_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      paging: { kind: 'none' },
      boundedBy: { kind: 'window' },
      projection: ['id'],
    });
    const limited = querySpec({
      name: 'workshop_options',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      paging: { kind: 'limit', max: 50 },
      projection: ['id'],
    });

    const parentContent =
      queryBodyGenerator.generate(workshopModel(), genContextWithQueries([withParent]))[0]?.content ?? '';
    const windowContent =
      queryBodyGenerator.generate(workshopModel(), genContextWithQueries([withWindow]))[0]?.content ?? '';
    const limitedContent =
      queryBodyGenerator.generate(workshopModel(), genContextWithQueries([limited]))[0]?.content ?? '';

    expect(parentContent).toContain('| 有界性の根拠（bounded_by） | parent: venue（capacity で有界） |');
    expect(windowContent).toContain(
      '| 有界性の根拠（bounded_by） | window（via のスコープ条件が実行者 1 人分に絞るため有界） |',
    );
    expect(limitedContent).not.toContain('有界性の根拠');
  });
});
