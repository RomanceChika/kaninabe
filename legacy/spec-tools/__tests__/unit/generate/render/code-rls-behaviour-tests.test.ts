/**
 * RLS の挙動テストの生成器(code-rls-behaviour-tests / code-rls-worlds / data-table-rls-tests)のテスト。
 *
 * 3 つは**同じ導出**(`rlsWorldCatalog` → `rlsTestSuites`)から出る。ここで固定するのは、
 * 生成されるテスト名・注釈・番号が 3 者で一致することと、境界(`filters`)のテスト名が **T4 が
 * 要求する名前そのもの**であること(= 生成物が T4 を満たす)である。
 */

import { describe, expect, it } from 'vitest';
import { rlsBehaviourTestsGenerator } from '../../../../lib/generate/render/code-rls-behaviour-tests.js';
import { rlsWorldsGenerator } from '../../../../lib/generate/render/code-rls-worlds.js';
import { dataTableRlsTestsGenerator } from '../../../../lib/generate/render/data-table-rls-tests.js';
import { tenantCanaryTestName } from '../../../../lib/messages/messages-rls.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { FOREIGN_LAYOUT, FOREIGN_ROOTS, leaksNextjsEntrySpelling } from '../../../helpers/platform.js';

/** 題材: 棚(shelf)と実行者の集約 staff_member。境界を宣言するかを切り替える。 */
function domain(withFilters: boolean): SpecModel {
  return specModel(
    [
      aggregate('shelf', {
        entity: entitySpec('shelf', {
          context: { shelf: 'shelf.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('label', { kind: 'string' }, { required: true }),
            field('company_id', { kind: 'uuid' }),
          ],
        }),
        access: {
          ...accessSpec('shelf', {
            reads: [
              read('anonymous', { kind: 'none' }),
              read('staff_member', { kind: 'all' }, withFilters ? { company_id: 'company_id' } : undefined),
              read('system', { kind: 'all' }),
            ],
          }),
          id: 'shelf-access',
        },
      }),
      aggregate('staff_member', {
        entity: entitySpec('staff_member', {
          context: { staff_member: 'staff_member.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('company_id', { kind: 'uuid' }, { required: true, session: true }),
          ],
        }),
      }),
    ],
    roleSpec([
      role('anonymous', undefined, undefined, 'anonymous'),
      role('staff_member', undefined, undefined, 'authenticated_default'),
      role('system', undefined, undefined, 'system'),
    ]),
  );
}

/** 2 表(棚だけがポリシーを生成する)。 */
function tables(): readonly DataTableSpec[] {
  return [
    dataTable('shelves', { entity: 'shelf', policiesMigration: '20260101000001_policies_shelves.sql' }),
    dataTable('staff_members', { entity: 'staff_member' }),
  ];
}

/** 生成の文脈。 */
function ctx(): GenerateContext {
  return { ...GEN_CTX, dataTables: dataTableModel(tables()) };
}

/** 生成されたテストファイル 1 本の全文。 */
function testFile(withFilters: boolean): string {
  const sections = rlsBehaviourTestsGenerator.generate(domain(withFilters), ctx());
  const found = sections[0];
  if (found === undefined) throw new Error('テストが 1 本も生成されませんでした');
  expect(found.file).toBe('app/src/infrastructure/__tests__/generated/rls/shelves.rls.test.ts');
  return found.content;
}

describe('挙動テストの生成', () => {
  it('world の設計図を渡して実行するだけのテストになる(world の作り方とオラクルは生成しない)', () => {
    const content = testFile(false);
    expect(content).toContain("import { rlsWorlds } from '@/domain/generated/rls-worlds';");
    expect(content).toContain('const WORLD = rlsWorlds.shelves;');
    expect(content).toContain('built = await createRlsWorld(WORLD);');
    expect(content).toContain('await resetRlsWorld();');
    // world の作り方(insert の SQL)やオラクル(可視集合の計算)は 1 行も出ない。
    expect(content).not.toContain('insert into');
    expect(content).not.toContain('grantees');
  });

  it('ロールごとに 1 本 + world の検算 1 本で、注釈は TC-RLS-{表}-{番号} になる', () => {
    const content = testFile(false);
    expect(content).toContain('// @spec shelf-access @tc TC-RLS-SHELVES-001');
    expect(content).toContain("it('shelves は staff_member として読むと宣言どおりの行だけが返る', async () => {");
    expect(content).toContain("await expectVisibleRows(WORLD, built, 'staff_member');");
    expect(content).toContain('// @spec shelf-access @tc TC-RLS-SHELVES-002');
    expect(content).toContain("it('shelves は anonymous として読むと宣言どおりの行だけが返る', async () => {");
    // どの表にも「ログインしているが実行者の集約に行が無い人」が 1 人いる(補助関数の判定を実行する)。
    expect(content).toContain('// @spec shelf-access @tc TC-RLS-SHELVES-003');
    expect(content).toContain(
      "it('shelves は staff_members に行が無いログイン実行者に宣言どおりの行だけが返る', async () => {",
    );
    expect(content).toContain("await expectVisibleRows(WORLD, built, 'staff_member_without_row');");
    expect(content).toContain('// @spec shelf-access @tc TC-RLS-SHELVES-004');
    expect(content).toContain("it('shelves の world が設計図どおりに作られている', () => {");
  });

  it('境界を宣言した表のテスト名は T4 が要求する名前そのもの(生成物が T4 を満たす)', () => {
    const content = testFile(true);
    expect(content).toContain(`it('${tenantCanaryTestName('shelves', 'company_id')}', async () => {`);
    expect(content).toContain("await expectTenantBoundary(WORLD, built, 'company_id');");
    // 境界を宣言しない表ではその口を import しない(未使用の import は lint に落ちる)。
    expect(testFile(false)).not.toContain('expectTenantBoundary');
    // 「別の境界を持つもう 1 人」には別のテスト名を付ける —— 同じロールの 2 人目に同じ名前を
    // 付けると、注釈 2 件が同じテストを指すことになる(3 段の突合が壊れる)。
    expect(content).toContain("it('shelves は別の境界を持つもう 1 人の staff_member に宣言どおりの行だけが返る', async () => {");
    expect(content).toContain("await expectVisibleRows(WORLD, built, 'staff_member_other');");
  });
});

describe('設計図と注釈', () => {
  it('設計図は作れた表だけを載せ、ロールの根拠を別に出す', () => {
    const sections = rlsWorldsGenerator.generate(domain(false), ctx());
    const content = sections[0]?.content ?? '';
    expect(sections[0]?.file).toBe('app/src/domain/generated/rls-worlds.ts');
    expect(content).toContain('export const rlsWorlds =');
    expect(content).toContain('export const rlsRoles =');
    expect(content).toContain('export const rlsWorldTables');
    expect(content).toContain('shelves: {');
    // 実行者の集約はポリシーを生成していないので、world の的にはならない。
    expect(content).not.toContain('staff_members: {');
  });

  it('data_table の test_cases は生成テストと同じ名前・同じ番号を指す', () => {
    const sections = dataTableRlsTestsGenerator.generate(domain(true), ctx());
    const section = sections[0];
    expect(section?.file).toBe('docs/specs/backend/data/tables/shelves.md');
    expect(section?.marker).toBe('data-table-rls-tests');
    const content = section?.content ?? '';
    expect(content).toContain('  - id: TC-RLS-SHELVES-001');
    expect(content).toContain('    spec_ids: [shelf-access]');
    expect(content).toContain(
      `    implementation: app/src/infrastructure/__tests__/generated/rls/shelves.rls.test.ts::${tenantCanaryTestName('shelves', 'company_id')}`,
    );
    // 生成テストに出る全テスト名が注釈にも出る(3 者が同じ導出から出ている)。
    for (const line of content.split('\n').filter((entry) => entry.startsWith('    implementation:'))) {
      const name = line.slice(line.indexOf('::') + 2);
      expect(testFile(true)).toContain(`it('${name}'`);
    }
  });

  it('注釈の covers は分類どおり(返らないことを見る検査は forbidden)', () => {
    const sections = dataTableRlsTestsGenerator.generate(domain(true), ctx());
    const entries = (sections[0]?.content ?? '').split('  - id: ').slice(1);
    const covers = new Map(
      entries.map((entry) => {
        const id = entry.slice(0, entry.indexOf('\n'));
        return [id, /covers: \[(\w+)\]/u.exec(entry)?.[1] ?? ''];
      }),
    );
    // 読める実行者(既定のログインロールに scope: all)は success、
    // 拒否される未ログイン・行が無い人・境界の見張りテストは forbidden である。
    expect(covers.get('TC-RLS-SHELVES-001')).toBe('success');
    expect(covers.get('TC-RLS-SHELVES-002')).toBe('forbidden');
    expect(covers.get('TC-RLS-SHELVES-003')).toBe('success');
    expect(covers.get('TC-RLS-SHELVES-004')).toBe('forbidden');
    expect(covers.get('TC-RLS-SHELVES-005')).toBe('forbidden');
    expect(covers.get('TC-RLS-SHELVES-006')).toBe('success');
  });
});

describe('挙動テストの置き場は置き場の配置の役割 rls-test が決める', () => {
  it('配置を差し替えると、生成テストのファイルと data_table の test_cases の implementation がその配置の値になる(Next.js の綴りは残らない)', () => {
    const foreign: GenerateContext = { ...ctx(), layout: FOREIGN_LAYOUT, roots: { ...ctx().roots, generated: FOREIGN_ROOTS.generated } };
    const tests = rlsBehaviourTestsGenerator.generate(domain(false), foreign);
    const cases = dataTableRlsTestsGenerator.generate(domain(false), foreign);

    expect(tests.map((section) => section.file)).toEqual(['app/server_code/checks/db/visibility/shelves.view.test.ts']);
    expect(cases[0]?.content).toContain('implementation: app/server_code/checks/db/visibility/shelves.view.test.ts::');
    expect(leaksNextjsEntrySpelling(cases.map((section) => section.content).join('\n'))).toBe(false);
  });

  it('配置が rls-test を決められなければ、黙って 0 本にせず配置の定義の検査を名指して止める。実装の木が無ければ何も出さない', () => {
    expect(() => rlsBehaviourTestsGenerator.generate(domain(false), { ...ctx(), layout: {} })).toThrowError(/rls-test/);
    expect(rlsBehaviourTestsGenerator.generate(domain(false), { ...ctx(), roots: { ...GEN_CTX.roots, app: null } })).toEqual([]);
    expect(dataTableRlsTestsGenerator.generate(domain(false), { ...ctx(), roots: { ...GEN_CTX.roots, app: null } })).toEqual([]);
  });
});
