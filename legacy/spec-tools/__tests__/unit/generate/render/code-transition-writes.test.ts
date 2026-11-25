/**
 * code-transition-writes(状態機械 + データテーブル + 個人データ宣言 → 遷移が書いてよい列の期待表)
 * のユニットテスト。
 *
 * 対象の要求(walker-oracle が「遷移に伴う列の書き込み」を writes 違反と誤検出しないための入力):
 * ①1 テーブルが複数の状態機械を持てば `stateColumnsByTable` に全列が並ぶ、
 * ②効果カタログの `anonymizes`(匿名化する効果)をその集約の状態機械の `effects` に持つ操作だけが
 * `anonymizedColumns`(自分の personal 列)と `cascades` を持つ(`by: system` 行や `kind` の語からは推測しない。
 * `ownColumns` は personal でない列の近似として `transition_writes` と遷移の `computes` の書き先から出る。`by: system` の行からは出ない)、
 * ③連鎖先に `ref(集約)` 型フィールドがあれば `refColumn` を添える、
 * ④無ければ `refColumn` を持たせない(裁定 2026-09-04: `also_writes` は信じてよい。行を
 * 絞り込めない表はテーブル全体免除に倒す)、⑤連鎖は匿名化の効果が `realized_by` で名指しした RPC の also_writes だけから導く
 * (表の RPC の本数・順序には依らず、匿名化でない効果の名指しは免除に入れない。`anonymizedColumns` は自分の行の話なので RPC に依らない)。
 */

import { describe, expect, it } from 'vitest';
import { transitionWritesGenerator } from '../../../../lib/generate/render/code-transition-writes.js';
import {
  accessSpec,
  aggregate,
  effect,
  entitySpec,
  event,
  field,
  machine,
  specModel,
  stubGuards,
  write,
} from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** `member` が本人の personal 列を消去する状態機械 + `erase_member` 相当の複合 RPC を持つモデル。 */
function memberAggregate() {
  return aggregate('member', {
    entity: entitySpec('member', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('display_name', { kind: 'string' }, { personal: true, personalPlaceholder: '(消去済み)' }),
      ],
    }),
    stateMachines: [
      machine('membership', {
        states: ['active', 'erased'],
        initial: 'active',
        final: ['erased'],
        events: [event('erase', { from: ['active'], to: 'erased', by: ['staff'] })],
        effects: [effect('erase', ['anonymize_member_data'])],
      }),
    ],
    // personal 列の由来は匿名化の宣言(anonymizes)であり、access.md に by: system の近似行は要らない。
    access: accessSpec('member', { writes: [write('account_owner', ['display_name'])] }),
  });
}

/** 匿名化する効果(カタログの `anonymizes: member`)。 */
const ANONYMIZE_MEMBER = outboxJob('anonymize_member_data', {
  kind: 'anonymize',
  anonymizes: 'member',
  realizedBy: { 'membership.erase': 'erase_member' },
});

/** `'membership.erase': {` から次の `},` まで(操作 1 件ぶんの本文)。 */
function operationBlock(content: string, id: string): string {
  const rest = content.slice(content.indexOf(`'${id}': {`));
  return rest.slice(0, rest.indexOf('\n  },'));
}

/** `entries`(`ref(member)` を持つ)と `program_items`(持たない)を also_writes に持つ members の data_table。 */
function membersDataTable(functions: readonly DataFunctionDecl[]) {
  return dataTable('members', { entity: 'member', functions });
}

const eraseComposite = {
  name: 'erase_member',
  args: [],
  params: [],
  kind: 'rpc' as const,
  shape: 'composite' as const,
  alsoWrites: ['entries', 'program_items'],
};

/** entries(ref(member) あり)・program_items(ref(member) 無し)を含む全集約。 */
function withCascadeTargets(model: SpecModel): SpecModel {
  return specModel([
    ...model.aggregates.values(),
    aggregate('entry', {
      entity: entitySpec('entry', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('owner_id', { kind: 'ref', entity: 'member' }),
          field('note', { kind: 'text' }, { personal: true, personalPlaceholder: null }),
        ],
      }),
    }),
    aggregate('program_item', {
      entity: entitySpec('program_item', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('entry_id', { kind: 'ref', entity: 'entry' }),
          field('performer_label', { kind: 'string' }, { personal: true, personalPlaceholder: '(消去済み)' }),
        ],
      }),
    }),
  ]);
}

/** 生成本文を 1 つだけ取り出す短縮形。 */
function render(model: SpecModel, ctx: GenerateContext): string {
  const sections = transitionWritesGenerator.generate(model, ctx);
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-transition-writes', () => {
  it('1 テーブルが複数の状態機械を持てば stateColumnsByTable に全列が並ぶ', () => {
    const model = specModel([
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('state', { kind: 'state', machine: 'workshop' }),
            field('publication_state', { kind: 'state', machine: 'workshop_publication' }),
          ],
        }),
        stateMachines: [
          machine('workshop', { states: ['draft', 'accepting'], initial: 'draft' }),
          machine('workshop_publication', { states: ['unpublished', 'published'], initial: 'unpublished' }),
        ],
      }),
    ]);

    const content = render(model, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() });

    expect(content).toContain("column: 'state',\n      machine: 'workshop',");
    expect(content).toContain("column: 'publication_state',\n      machine: 'workshop_publication',");
  });

  it('匿名化する効果(anonymizes)を effects に持つ操作だけが、自分の personal 列と連鎖を持つ', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([membersDataTable([eraseComposite])]),
      jobs: jobModel([ANONYMIZE_MEMBER]),
    };

    const content = render(model, ctx);

    expect(content).toContain("'membership.erase': {");
    expect(operationBlock(content, 'membership.erase')).toContain("anonymizedColumns: ['display_name'],");
    // entries は ref(member) の owner_id を持つので refColumn 付きで絞り込める。
    expect(content).toContain("table: 'entries',\n        refColumn: 'owner_id',\n        columns: ['note'],");
  });

  it('ref(集約) 型フィールドが無いテーブルは refColumn 無しで出る(テーブル全体免除)', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([membersDataTable([eraseComposite])]),
      jobs: jobModel([ANONYMIZE_MEMBER]),
    };

    const content = render(model, ctx);

    // program_items は entry_id 経由の 2 段参照でしか member に届かない(ref(member) を持たない)。
    // refColumn を持たせず、columns だけを書く。
    expect(content).toContain("table: 'program_items',\n        columns: ['performer_label'],");
    // 万一 refColumn: undefined を書くと閉世界の型(readonly string[] を期待する読み手)を壊すので、
    // このテーブルの行に refColumn という語がまったく現れないことも確かめる。
    const programItemsBlock = content.slice(content.indexOf("table: 'program_items'"));
    const nextBrace = programItemsBlock.indexOf('},');
    expect(programItemsBlock.slice(0, nextBrace)).not.toContain('refColumn');
  });

  it('同じ表に別の複合 RPC が増えても、連鎖は匿名化の効果が名指しした RPC だけから決まる（本数にも順序にも依らない）', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const base = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      jobs: jobModel([ANONYMIZE_MEMBER]),
    };
    const extras: readonly DataFunctionDecl[] = [
      { name: 'insert_member', args: [], params: [], kind: 'rpc', shape: 'composite', alsoWrites: ['program_items'] },
      { name: 'revoke_sessions', args: [], params: [], kind: 'rpc', shape: 'composite', alsoWrites: [] },
    ];
    const alone = operationBlock(render(model, { ...base, dataTables: dataTableModel([membersDataTable([eraseComposite])]) }), 'membership.erase');
    const crowded = operationBlock(render(model, { ...base, dataTables: dataTableModel([membersDataTable([...extras, eraseComposite])]) }), 'membership.erase');

    expect(crowded).toBe(alone);
    expect(crowded).toContain("table: 'entries'");
    expect(crowded).toContain("anonymizedColumns: ['display_name'],");
  });

  it('名指しされた RPC が実在しなければ連鎖は 0 件（推測で別の RPC を使わない。T19 が error にする）。自分の行の personal 列は変わらない', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([membersDataTable([{ ...eraseComposite, name: 'erase_someone' }])]),
      jobs: jobModel([ANONYMIZE_MEMBER]),
    };

    const eraseBlock = operationBlock(render(model, ctx), 'membership.erase');

    expect(eraseBlock).toContain('cascades: [],');
    expect(eraseBlock).toContain("anonymizedColumns: ['display_name'],");
  });

  it('匿名化でない効果（セッションを終える等）が名指しした RPC の also_writes は、免除に入れない（免除を広げない）', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([
        membersDataTable([eraseComposite, { name: 'apply_transition', args: [], params: [], kind: 'rpc', shape: 'transition', alsoWrites: ['entries', 'program_items'] }]),
      ]),
      jobs: jobModel([
        outboxJob('anonymize_member_data', { kind: 'anonymize', anonymizes: 'member', realizedBy: { 'membership.erase': 'erase_member' } }),
      ]),
    };
    const withSessions = {
      ...ctx,
      jobs: jobModel([
        outboxJob('anonymize_member_data', { kind: 'anonymize', anonymizes: 'member', realizedBy: { 'membership.erase': 'erase_member' } }),
        outboxJob('revoke_sessions', { kind: 'transaction_effect', inTransaction: true, realizedBy: { 'membership.erase': 'apply_transition' } }),
      ]),
    };
    const modelWithSessions = withCascadeTargets(
      specModel([
        aggregate('member', {
          entity: entitySpec('member', {
            fields: [field('id', { kind: 'uuid' }, { auto: true }), field('display_name', { kind: 'string' }, { personal: true, personalPlaceholder: '(消去済み)' })],
          }),
          stateMachines: [
            machine('membership', {
              states: ['active', 'erased'],
              initial: 'active',
              final: ['erased'],
              events: [event('erase', { from: ['active'], to: 'erased', by: ['staff'] })],
              effects: [effect('erase', ['anonymize_member_data', 'revoke_sessions'])],
            }),
          ],
          access: accessSpec('member', { writes: [write('account_owner', ['display_name'])] }),
        }),
      ]),
    );

    expect(operationBlock(render(modelWithSessions, withSessions), 'membership.erase')).toBe(
      operationBlock(render(model, ctx), 'membership.erase'),
    );
  });

  it('匿名化の効果を持たない操作は anonymizedColumns・cascades が空', () => {
    const base = memberAggregate();
    const model = withCascadeTargets(
      specModel([
        aggregate('member', {
          ...base,
          stateMachines: [
            machine('membership', {
              states: ['active', 'erased', 'left'],
              initial: 'active',
              final: ['erased', 'left'],
              events: [
                event('erase', { from: ['active'], to: 'erased', by: ['staff'] }),
                event('leave', { from: ['active'], to: 'left', by: ['member'] }),
              ],
              effects: [effect('erase', ['anonymize_member_data'])],
            }),
          ],
        }),
      ]),
    );
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([membersDataTable([eraseComposite])]),
      jobs: jobModel([ANONYMIZE_MEMBER]),
    };

    const content = render(model, ctx);
    const leaveBlock = operationBlock(content, 'membership.leave');

    expect(leaveBlock).toContain('anonymizedColumns: [],');
    expect(leaveBlock).toContain('cascades: [],');
    expect(operationBlock(content, 'membership.erase')).toContain("anonymizedColumns: ['display_name'],");
  });

  it('同一トランザクションで実現される効果(in_transaction)でも、anonymizes が無ければ連鎖を推測しない(宣言から読む)', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([membersDataTable([eraseComposite])]),
      jobs: jobModel([outboxJob('anonymize_member_data', { kind: 'transaction_effect', inTransaction: true })]),
    };

    const eraseBlock = operationBlock(render(model, ctx), 'membership.erase');

    expect(eraseBlock).toContain('anonymizedColumns: [],');
    expect(eraseBlock).toContain('cascades: [],');
  });

  it('anonymizes が別の集約を指す効果は、この集約の遷移を匿名化にしない', () => {
    const model = withCascadeTargets(specModel([memberAggregate()]));
    const ctx: GenerateContext = {
      guards: stubGuards(),
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      dataTables: dataTableModel([membersDataTable([eraseComposite])]),
      jobs: jobModel([outboxJob('anonymize_member_data', { kind: 'anonymize', anonymizes: 'entry' })]),
    };

    expect(operationBlock(render(model, ctx), 'membership.erase')).toContain('anonymizedColumns: [],');
  });

  it('by: system の行は ownColumns に出ない(内部実行が編集で書く許可であって、遷移が書く列の印ではない)', () => {
    const model = specModel([
      aggregate('fee', {
        entity: entitySpec('fee', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('amount', { kind: 'integer' })] }),
        stateMachines: [
          machine('fee', {
            states: ['open', 'fixed'],
            initial: 'open',
            events: [event('fix', { from: ['open'], to: 'fixed', by: ['staff'] })],
          }),
        ],
        access: accessSpec('fee', { writes: [write('system', ['amount'])] }),
      }),
    ]);

    const block = operationBlock(render(model, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() }), 'fee.fix');

    expect(block).toContain('ownColumns: [],');
    expect(block).toContain('anonymizedColumns: [],');
  });

  it('遷移だけが書く列(transition_writes)と遷移の computes の書き先が ownColumns に出る(どちらも編集の表には載らないので、オラクルはここから引く)', () => {
    const model = specModel([
      aggregate('fee', {
        entity: entitySpec('fee', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('amount', { kind: 'integer' }), field('fixed_by', { kind: 'uuid' })],
        }),
        stateMachines: [
          machine('fee', {
            states: ['open', 'fixed'],
            initial: 'open',
            events: [event('fix', { from: ['open'], to: 'fixed', by: ['staff'] })],
          }),
        ],
        access: accessSpec('fee', { transitionWrites: ['fixed_by'] }),
      }),
    ]);
    // 計算で決まる列は writes に行を持たない(V18)。遷移の computes の宣言から導く。編集の computes は数えない。
    const actions = {
      actions: [
        actionSpec({ handles: 'fee.fix', computes: { 'fee.amount': 'fixedAmount' } }),
        actionSpec({ handles: 'fee.update', computes: { 'fee.note': 'noteOf' } }),
      ],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    };

    const block = operationBlock(render(model, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), actions }), 'fee.fix');

    expect(block).toContain("ownColumns: ['fixed_by', 'amount'],");
  });

  it('entity_spec が 1 件も無ければ何も生成しない', () => {
    expect(transitionWritesGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});
