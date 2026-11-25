/**
 * 単発の操作の入力スキーマの生成(`lib/generate/render/code-operation-inputs.ts`)。
 *
 * ここで固定するのは **作成の入力が閉世界(`z.strictObject`)であること**(点検 25 回目 O25-2。外した欄を黙って剥がさない)と、
 * `zod` の import が使う形(作成がある)のときに出ること。以前は入力を 1 つも受けない作成だけが `z.object({})` で zod を使い、
 * それが無くなると使われない import が lint(no-unused-vars)を落とした(2026-10-23)。
 */

import { describe, expect, it } from 'vitest';
import { operationInputsGenerator } from '../../../../lib/generate/render/code-operation-inputs.js';
import { buildOperationPlans } from '../../../../lib/usecase/operation-plan.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import {
  accessSpec,
  aggregate,
  createRule,
  entitySpec,
  field,
  role,
  specModel,
  stubContext,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { jobModel } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 作成だけを持つ widget 集約(名前の欄が 1 つ)。 */
const DOMAIN = specModel({
  roles: [role('anonymous'), role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [field('name', { kind: 'string' })]),
      access: accessSpec('widget', { creates: [createRule('member')] }),
    }),
  ],
});

/** 生成の文脈(作成の RPC と、渡した入力の action_spec)。 */
function context(input: readonly string[]): GenerateContext {
  const { guards } = stubContext();
  // 作成の RPC の引数は入力に合わせる(名前を受けない作成は p_name を持たない)。
  const params = input.length === 0 ? ['p_id', 'p_actor_id', 'p_actor_roles'] : ['p_id', 'p_name', 'p_actor_id', 'p_actor_roles'];
  return {
    guards,
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    actions: {
      actions: [actionSpec({ handles: 'widget.create', input })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    dataTables: dataTableModel([
      dataTable('widgets', {
        entity: 'widget',
        functions: [
          { name: 'insert_widget', args: params.map(() => 'text'), params, kind: 'rpc', shape: 'create', alsoWrites: [] },
        ],
      }),
    ]),
    jobs: jobModel([]),
  };
}

/** 生成された操作の入力スキーマのファイルの本文。 */
function render(input: readonly string[]): string {
  const ctx = context(input);
  const built = buildOperationPlans({ domain: DOMAIN, guards: ctx.guards, actions: ctx.actions, dataTables: ctx.dataTables, jobs: ctx.jobs });
  expect(built.problems).toEqual([]);
  const sections = operationInputsGenerator.generate(DOMAIN, ctx);
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('作成の入力スキーマは閉世界(点検 25 回目 O25-2)', () => {
  // 行のスキーマ(strictObject)と揃え、宣言に無い欄(外した欄・古い呼び手の欄)を黙って剥がさずに断る(unrecognized_keys)。
  it('入力を受けない作成は z.strictObject({}) で、zod を import する', () => {
    const content = render([]);

    expect(content).toContain("'widget.create': z.strictObject({}),");
    expect(content).toContain("import { z } from 'zod';");
    expect(content).not.toContain('z.object(');
  });

  it('入力を受ける作成は生成スキーマから借りた欄を z.strictObject で閉じる(zod を import する)', () => {
    const content = render(['widget.name']);

    expect(content).toContain("'widget.create': z.strictObject(widgetInputSchema.pick({ name: true }).shape),");
    expect(content).toContain("import { z } from 'zod';");
    expect(content).not.toContain('z.object(');
  });
});
