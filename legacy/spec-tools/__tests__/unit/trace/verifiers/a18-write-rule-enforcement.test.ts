/**
 * A18(`writes` の規則の執行点)の規約網羅テスト(束 ⑳-5c-b)。
 *
 * 対象の要求: action-spec-writing.md「`access_spec.writes[]` の規則は、それを執行する生成物
 * (`kind: rpc` / `shape: update` の関数)を持つこと」。
 *
 * この検査は**変異テストが実測した検査の漏れ**から出てきた —— `writes[].when` を機械で落としても、
 * その表に生成 `update` RPC が無ければ、どの生成物も 1 バイトも変わらなかった。
 */

import { describe, expect, it } from 'vitest';
import { writeRuleEnforcementVerifier } from '../../../../lib/trace/verifiers/a18-write-rule-enforcement.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { ActionTestCase } from '../../../../lib/testcase/types.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';

/** `doc` を 1 つだけ持ち、`writes` の規則が 1 本あるドメイン。 */
function domain(): ReturnType<typeof specModel> {
  return specModel({
    roles: [role('member')],
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [field('title', { kind: 'text' })]),
        access: accessSpec('doc', { writes: [writeRule('member', ['title'], 'title != "")')] }),
      }),
    ],
  });
}

/**
 * 遷移が書く列(`records_actor`)だけを `writes` に並べたドメイン。
 *
 * @param when 規則に付ける条件(既定は付けない)
 * @param fields 規則に並べる欄(既定は `records_actor` が宣言する 1 本だけ)
 * @param extra `by: system` の行に並べる追加の規則(人間ロールの行を足すときに使う)
 * @returns そのドメイン仕様
 */
function transitionWritten(
  when?: string,
  fields: readonly string[] = ['handled_by'],
  extra: readonly ReturnType<typeof writeRule>[] = [],
): ReturnType<typeof specModel> {
  return specModel({
    roles: [role('member'), role('system'), role('organizer')],
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [
          field('state', { kind: 'state', machine: 'doc' }, { required: true }),
          field('title', { kind: 'text' }),
          field('handled_by', { kind: 'ref', entity: 'member' }),
          field('amount', { kind: 'integer' }),
        ]),
        stateMachines: [
          machine({
            machine: 'doc',
            states: ['open', 'handled'],
            initial: 'open',
            events: [
              event({ id: 'handle', from: ['open'], to: 'handled', by: ['member'], recordsActor: ['handled_by'] }),
            ],
          }),
        ],
        access: accessSpec('doc', { writes: [writeRule('system', fields, when), ...extra] }),
      }),
    ],
  });
}

/** 関数 1 本の宣言(検査が見るのは kind / shape / migration / handwritten だけ)。 */
function fn(init: Partial<DataFunctionDecl> & { name: string }): DataFunctionDecl {
  return { args: [], params: [], kind: 'rpc', alsoWrites: [], ...init };
}

/** テストケース 1 件(宣言の有無だけを見る)。 */
function testCase(id: string): ActionTestCase {
  return {
    id,
    type: 'integration',
    specIds: [],
    covers: [],
    implementation: { raw: `app/x.test.ts::${id}`, file: 'app/x.test.ts', testName: id },
    location: { file: 'docs/specs/backend/data/tables/docs.md' },
  };
}

/** `doc` に帰属する表 1 つだけを持つ data_table モデル。 */
function tables(functions: readonly DataFunctionDecl[], testCases: readonly ActionTestCase[] = []): DataTableSpecModel {
  const table = {
    id: 'table-docs',
    table: 'docs',
    entity: 'doc',
    internal: false,
    indexes: [],
    exclusions: [],
    foreignKeys: [],
    triggers: [],
    defaults: {},
    functions,
    checks: [],
    testCases,
    location: { file: 'docs/specs/backend/data/tables/docs.md' },
    relPath: 'docs.md',
  } as unknown as DataTableSpec;
  return { available: true, tables: [table] };
}

describe('A18 writes の規則の執行点', () => {
  it('生成 update RPC(migration つき)があれば通る', () => {
    const input = traceInput({
      domain: domain(),
      dataTables: tables([fn({ name: 'update_doc', shape: 'update', migration: '0001_rpc_update_doc.sql' })]),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toEqual([]);
  });

  it('update RPC が 1 本も無ければ warning(執行点が無い書き込み規則)', () => {
    const input = traceInput({
      domain: domain(),
      dataTables: tables([fn({ name: 'reorder_docs', shape: 'composite' })]),
    });
    const findings = writeRuleEnforcementVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A18');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('執行する生成物がありません');
  });

  it('composite の RPC があっても執行点にはならない(形が違う関数で埋めさせない)', () => {
    const input = traceInput({
      domain: domain(),
      dataTables: tables([fn({ name: 'do_everything', shape: 'composite' }), fn({ name: 'ins', shape: 'create' })]),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toHaveLength(1);
  });

  it('handwritten の update RPC は、見張りテストの宣言があれば通る(理由つきの宣言)', () => {
    const input = traceInput({
      domain: domain(),
      dataTables: tables(
        [fn({ name: 'update_doc', shape: 'update', handwritten: '定型に乗らない手順がある' })],
        [testCase('TC-TABLE-DOCS-001')],
      ),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toEqual([]);
  });

  it('handwritten なのに見張りテストの宣言が 1 つも無ければ warning(見張りテストを宣言していない手写しは宣言ではない)', () => {
    const input = traceInput({
      domain: domain(),
      dataTables: tables([fn({ name: 'update_doc', shape: 'update', handwritten: '理由' })]),
    });
    const findings = writeRuleEnforcementVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('test_cases');
  });

  it('遷移が書く列だけの規則は、遷移の RPC が執行点になる(update RPC を要求しない)', () => {
    const input = traceInput({
      domain: transitionWritten(),
      dataTables: tables([fn({ name: 'apply_doc_transition', shape: 'transition', migration: '0002_t.sql' })]),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toEqual([]);
  });

  it('同じ列を並べた人間ロールの行は warning のまま(遷移の RPC は人の許可を執行しない)', () => {
    const input = traceInput({
      domain: transitionWritten(undefined, ['handled_by'], [writeRule('organizer', ['handled_by'])]),
      dataTables: tables([fn({ name: 'apply_doc_transition', shape: 'transition', migration: '0002_t.sql' })]),
    });
    const findings = writeRuleEnforcementVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('by: organizer');
  });

  it('遷移が書く列でも when を持つ規則は warning(遷移の RPC は when を 1 度も読まない)', () => {
    const input = traceInput({
      domain: transitionWritten('state == open'),
      dataTables: tables([fn({ name: 'apply_doc_transition', shape: 'transition', migration: '0002_t.sql' })]),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toHaveLength(1);
  });

  it('遷移の宣言に無い列が 1 つでも混ざれば warning(規則ごと・列ごとに数え直す)', () => {
    const input = traceInput({
      domain: transitionWritten(undefined, ['handled_by', 'title']),
      dataTables: tables([fn({ name: 'apply_doc_transition', shape: 'transition', migration: '0002_t.sql' })]),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toHaveLength(1);
  });

  it('computes が示す列も遷移が書く列として数える(実行時に純関数が決める値)', () => {
    const input = traceInput({
      domain: transitionWritten(undefined, ['amount']),
      actions: [actionSpec({ handles: 'doc.handle', computes: { 'doc.amount': 'docAmount' } })],
      dataTables: tables([fn({ name: 'apply_doc_transition', shape: 'transition', migration: '0002_t.sql' })]),
    });

    expect(writeRuleEnforcementVerifier.verify(input)).toEqual([]);
  });

  describe('composite の enforces(ADR-0014)', () => {
    const organizer = { writes: 'doc', by: 'member', testCase: 'TC-TABLE-DOCS-001' };

    it('名指された規則は執行点を持つ(見張りテストが同じ表の test_cases に実在するとき)', () => {
      const input = traceInput({
        domain: domain(),
        dataTables: tables(
          [fn({ name: 'reorder_docs', shape: 'composite', enforces: [organizer] })],
          [testCase('TC-TABLE-DOCS-001')],
        ),
      });

      expect(writeRuleEnforcementVerifier.verify(input)).toEqual([]);
    });

    it('見張りテストの id が test_cases に無いと執行点とは数えない(警告は残る。書き間違いは T18 が error にする)', () => {
      const input = traceInput({
        domain: domain(),
        dataTables: tables(
          [fn({ name: 'reorder_docs', shape: 'composite', enforces: [organizer] })],
          [testCase('TC-TABLE-DOCS-099')],
        ),
      });

      expect(writeRuleEnforcementVerifier.verify(input)).toHaveLength(1);
    });

    it('別の by を名指した宣言では消えない(規則ごとに名指す)', () => {
      const input = traceInput({
        domain: domain(),
        dataTables: tables(
          [fn({ name: 'reorder_docs', shape: 'composite', enforces: [{ ...organizer, by: 'organizer' }] })],
          [testCase('TC-TABLE-DOCS-001')],
        ),
      });

      expect(writeRuleEnforcementVerifier.verify(input)).toHaveLength(1);
    });

    it('composite でない関数に書いた enforces では消えない(書き場所の誤りは T18 が error にする)', () => {
      const input = traceInput({
        domain: domain(),
        dataTables: tables(
          [fn({ name: 'ins_doc', shape: 'create', enforces: [organizer] })],
          [testCase('TC-TABLE-DOCS-001')],
        ),
      });

      expect(writeRuleEnforcementVerifier.verify(input)).toHaveLength(1);
    });

    it('指摘の対処に 4 つ目(enforces を書く道)が出る', () => {
      const input = traceInput({
        domain: domain(),
        dataTables: tables([fn({ name: 'reorder_docs', shape: 'composite' })]),
      });

      expect(writeRuleEnforcementVerifier.verify(input)[0]?.suggestion).toContain('(4)');
      expect(writeRuleEnforcementVerifier.verify(input)[0]?.suggestion).toContain('enforces');
    });
  });

  it('data_table を読めない構成では何も言わない(読めない環境で壊れない)', () => {
    expect(writeRuleEnforcementVerifier.verify(traceInput({ domain: domain() }))).toEqual([]);
    expect(
      writeRuleEnforcementVerifier.verify(
        traceInput({ domain: domain(), dataTables: { available: false, tables: [] } }),
      ),
    ).toEqual([]);
  });
});
