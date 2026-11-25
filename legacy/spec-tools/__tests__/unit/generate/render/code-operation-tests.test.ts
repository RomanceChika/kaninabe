/**
 * 実行計画 → ユニットテストの字面(`lib/generate/render/code-operation-tests.ts`。束 ⑰-3 / ⑰-3b)
 * と、その場面を指す action_spec の生成ブロック(`action-test-cases.ts`)。
 *
 * ここで固定するのは仕組みの規約である ——
 *   - 生成物の印(AUTO-GENERATED)を持ち、計画を差し替えずそのまま実行する形になること
 *   - 成功の場面が**名前つき引数まで**確かめること(独立レビュー 1-B)
 *   - `test_cases` の生成ブロックが、同じ場面の同じ名前・同じ ID を指すこと(A6 がすれ違わない)
 */

import { describe, expect, it } from 'vitest';
import { operationTestsGenerator } from '../../../../lib/generate/render/code-operation-tests.js';
import { actionTestCasesGenerator } from '../../../../lib/generate/render/action-test-cases.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, FOREIGN_ROOTS, TEST_PLATFORM, TEST_LAYOUT, leaksNextjsEntrySpelling } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 遷移 1 本を持つ widget 集約。 */
const DOMAIN = specModel({
  roles: [role('anonymous'), role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [
        field('state', { kind: 'state', machine: 'widget' }, { required: true }),
        field('amount', { kind: 'integer' }),
      ]),
      stateMachines: [
        {
          ...machine({
            machine: 'widget',
            states: ['draft', 'sent'],
            initial: 'draft',
            events: [event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'] })],
          }),
          effects: [{ on: 'send', do: ['notify'], location: { file: 'docs/specs/domain/widget/states.md' } }],
        },
      ],
      access: accessSpec('widget', { writes: [writeRule('system', ['amount'])] }),
    }),
  ],
});

/** 生成の文脈(action_spec / data_table / ジョブカタログまで揃える)。 */
function context(): GenerateContext {
  const { guards } = stubContext();
  return {
    guards,
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    actions: {
      actions: [actionSpec({ handles: 'widget.send', input: ['widget.id'] })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    dataTables: dataTableModel([
      dataTable('widgets', {
        entity: 'widget',
        functions: [
          {
            name: 'apply_widget_transition',
            args: ['text', 'text', 'text', 'text', 'text', 'text'],
            params: [
              'p_widget_id',
              'p_expected_state',
              'p_next_state',
              'p_effects',
              'p_event_id',
              'p_actor_id',
            ],
            kind: 'rpc',
            shape: 'transition',
            alsoWrites: [],
          },
        ],
      }),
    ]),
    jobs: jobModel([outboxJob('notify', { kind: 'notification' })]),
  };
}

/** 生成されたテストファイル 1 本。 */
function testFile(): { readonly file: string; readonly content: string } {
  const sections = operationTestsGenerator.generate(DOMAIN, context());
  expect(sections).toHaveLength(1);
  const section = sections[0];
  return { file: section?.file ?? '', content: section?.content ?? '' };
}

describe('生成されるユニットテストの字面', () => {
  it('生成物の印を持ち、計画を差し替えずそのまま実行する', () => {
    const { file, content } = testFile();

    expect(file).toBe('app/src/operation/__tests__/generated/widget/send.test.ts');
    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain("const PLAN = operationPlans['widget.send'];");
    expect(content).toContain('const run = runPlanOperation(PLAN, {});');
  });

  it('RPC は名前だけでなく名前つき引数まで確かめる', () => {
    const { content } = testFile();

    expect(content).toContain("expect(calls[0]?.rpc).toBe('apply_widget_transition');");
    expect(content).toContain('expect(calls[0]?.args).toMatchObject(');
    expect(content).toContain("p_next_state: 'sent'");
    expect(content).toContain("p_event_id: 'widget.send'");
  });

  it('行を読む計画には「対象なし」の場面が出る(A7 の要求を待たない)', () => {
    expect(testFile().content).toContain('対象が');
  });
});

describe('action_spec の test_cases の生成ブロック', () => {
  it('生成テストと同じ ID・同じ名前を指す', () => {
    const sections = actionTestCasesGenerator.generate(DOMAIN, context());
    const block = sections[0]?.content ?? '';
    const tests = testFile().content;

    expect(sections[0]?.file).toBe('docs/specs/backend/actions/widget/send.md');
    expect(block).toContain('- id: TC-WIDGET-SEND-901');
    expect(block).toContain('    type: unit');
    // 宣言が指すテスト名は、生成テストの `it()` の名前そのものである(A6 がすれ違わない)。
    for (const line of block.split('\n')) {
      const match = /implementation: .*::(.+)$/u.exec(line);
      if (match?.[1] !== undefined) expect(tests).toContain(`it('${match[1]}'`);
    }
  });
});

describe('生成テストの置き場は置き場の配置の役割 operation-test が決める', () => {
  it('配置を差し替えると、生成テストのファイルと test_cases の implementation がその配置の値になる(Next.js の綴りは残らない)', () => {
    const foreign: GenerateContext = { ...context(), layout: FOREIGN_LAYOUT, roots: { ...context().roots, generated: FOREIGN_ROOTS.generated } };
    const tests = operationTestsGenerator.generate(DOMAIN, foreign);
    const cases = actionTestCasesGenerator.generate(DOMAIN, foreign);

    expect(tests.map((section) => section.file)).toEqual(['app/server_code/checks/ops/widget__send.check.ts']);
    expect(cases[0]?.content).toContain('implementation: app/server_code/checks/ops/widget__send.check.ts::');
    expect(leaksNextjsEntrySpelling(cases[0]?.content ?? '')).toBe(false);
    expect(leaksNextjsEntrySpelling(tests[0]?.file ?? '')).toBe(false);
  });

  it('実装の木が無ければ何も出さず、配置が operation-test を決められなければ配置の定義の検査を名指して止める', () => {
    expect(operationTestsGenerator.generate(DOMAIN, { ...context(), roots: { ...TEST_ROOTS, app: null } })).toEqual([]);
    expect(actionTestCasesGenerator.generate(DOMAIN, { ...context(), roots: { ...TEST_ROOTS, app: null } })).toEqual([]);
    expect(() => operationTestsGenerator.generate(DOMAIN, { ...context(), layout: {} })).toThrowError(/operation-test/);
  });
});
