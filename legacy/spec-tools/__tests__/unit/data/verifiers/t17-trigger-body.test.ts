/**
 * T17(トリガ関数の本文の出どころ)の規約網羅テスト。
 * 対象の要求(ARCH-SP-BE-0001 §テーブル仕様):
 *   `kind: trigger` の関数は、**本文が生成物である**か、**`handwritten`(理由つきの手書き)**を
 *   宣言するかのどちらかである。どちらでもなければ error で、**生成できない理由を報告する**。
 *   `handwritten` を宣言するなら、その **`migration` が実在し、その本文に関数名の字面がある**こと
 *   (束 ㉖ の独立レビュー D1。自由文 1 行だったあいだ、名指しの誤りを誰も捕まえなかった)。
 *   加えて **`security`(誰の権限で実行するか)は手書きの本文だけが宣言できる**(束 §17)——
 *   本文が生成物なら値は生成器の計画が持っており、重ねて書くと正が 2 つになる。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyTriggerBody } from '../../../../lib/data/verifiers/t17-trigger-body.js';
import type { DataFunctionDecl, DataTableSpec, DataTriggerDecl } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { agentTable, crossDomain, hostTrigger, referencedTrigger, ticketTable } from '../../../helpers/cross-equality-fixture.js';

/** 題材: 自表の 2 列だけを見る不変条件を持つ消し込みシート。 */
function domain(expr: string): SpecModel {
  return specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('open', { kind: 'boolean' })],
        }),
      }),
      aggregate('sheet', {
        entity: entitySpec('sheet', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('checked', { kind: 'boolean' }, { required: true }),
            field('linked_event', { kind: 'string' }),
          ],
        }),
        invariants: invariantSpec([
          invariant({
            id: 'INV-SHEET-001',
            entities: ['sheet'],
            statement: 'システム連動の項目は人が手で消し込めない',
            formal: { kind: 'check', expr },
          }),
        ]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

/** 自表の 2 列だけを見る式。 */
const SELF = 'sheet.checked == false or sheet.linked_event is null';

/** 別の集約の欄を見る式(行の CHECK にもトリガの本文にも反映されない)。 */
const OTHER = 'sheet.checked == false or workshop.open == true';

/** 条件を課すトリガ 1 本と、その関数の宣言。 */
function table(init: {
  readonly handwritten?: string;
  readonly handwrittenMigration?: string;
  readonly invariant?: string;
  readonly withTrigger?: boolean;
  readonly security?: 'definer' | 'invoker';
}): DataTableSpec {
  const trigger: DataTriggerDecl = {
    name: 'check_sheet_manual',
    functionName: 'check_sheet_manual',
    fires: 'before insert or update of checked, linked_event',
    deferred: false,
    supplies: [],
    params: {},
    ...(init.invariant === undefined ? {} : { invariant: init.invariant }),
  };
  const fn: DataFunctionDecl = {
    name: 'check_sheet_manual',
    args: [],
    params: [],
    kind: 'trigger',
    alsoWrites: [],
    ...(init.handwritten === undefined ? {} : { handwritten: init.handwritten }),
    ...(init.handwrittenMigration === undefined ? {} : { handwrittenMigration: init.handwrittenMigration }),
    ...(init.security === undefined ? {} : { security: init.security }),
  };
  return dataTable('sheets', {
    entity: 'sheet',
    triggers: init.withTrigger === false ? [] : [trigger],
    functions: [fn],
  });
}

/** その宣言で出る指摘の文面。 */
function findings(spec: DataTableSpec, expr: string): readonly string[] {
  return verifyTriggerBody(domain(expr), dataTableModel([spec]), undefined, TEST_ROOTS).map((finding) => finding.message);
}

describe('T17 トリガ関数の本文の出どころ', () => {
  it('本文が生成できるなら何も言わない', () => {
    expect(findings(table({ invariant: 'INV-SHEET-001' }), SELF)).toEqual([]);
  });

  it('生成できなくても handwritten を宣言していれば通す', () => {
    expect(
      findings(table({ invariant: 'INV-SHEET-001', handwritten: '適用済みの手書き migration が作っている本文である' }), OTHER),
    ).toEqual([]);
  });

  it('生成できず handwritten も無ければ error で理由を報告する', () => {
    const messages = findings(table({ invariant: 'INV-SHEET-001' }), OTHER);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('本文がどこにも無い');
    expect(messages[0]).toContain('1 段の参照の欄で届かない');
  });

  it('不変条件を宣言しないトリガの関数も理由を報告する', () => {
    expect(findings(table({}), SELF).join('\n')).toContain('不変条件を宣言していない');
  });

  it('関数だけあってトリガの宣言が無ければ「発火しない関数である」と言う', () => {
    expect(findings(table({ withTrigger: false }), SELF).join('\n')).toContain('発火しない関数である');
  });

  it('error である(warning ではない)', () => {
    const all = verifyTriggerBody(domain(OTHER), dataTableModel([table({ invariant: 'INV-SHEET-001' })]), undefined, TEST_ROOTS);

    expect(all.map((finding) => finding.severity)).toEqual(['error']);
    expect(all.map((finding) => finding.verifier)).toEqual(['T17']);
  });

  it('本文が生成物の関数に security を書くと止める(権限の正が 2 つになる)', () => {
    const messages = findings(table({ invariant: 'INV-SHEET-001', security: 'definer' }), SELF);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('本文が生成物なので security を宣言できません');
  });

  it('手書きと宣言された関数の security は止めない(省略が invoker の意味を持つ宣言である)', () => {
    const reason = '適用済みの手書き migration が作っている本文である';
    expect(findings(table({ invariant: 'INV-SHEET-001', handwritten: reason, security: 'definer' }), OTHER)).toEqual([]);
    expect(findings(table({ invariant: 'INV-SHEET-001', handwritten: reason }), OTHER)).toEqual([]);
  });

  it('data_table を読めない構成では何も見ない', () => {
    expect(verifyTriggerBody(domain(SELF), { available: false, tables: [] }, undefined, TEST_ROOTS)).toEqual([]);
  });
});

/** 導出(derives)を宣言するトリガのための題材: 開始の前日の時刻を DB が決める。 */
function deriveDomain(): SpecModel {
  return specModel([
    aggregate('slot', {
      entity: entitySpec('slot', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('starts_at', { kind: 'datetime' }, { required: true }),
          { ...field('remind_at', { kind: 'datetime' }), suppliedBy: 'db' },
        ],
      }),
    }),
  ]);
}

/** 導出のトリガを持つ表(`from` と関数の handwritten を差し替える)。 */
function deriveTable(from: string, handwrittenReason?: string): DataTableSpec {
  return dataTable('slots', {
    entity: 'slot',
    triggers: [
      {
        name: 'fill_slot_remind',
        functionName: 'fill_slot_remind',
        fires: 'before insert',
        deferred: false,
        supplies: ['remind_at'],
        params: {},
        derives: [{ column: 'remind_at', from, offset: '-1 day', mode: 'initial' }],
      },
    ],
    functions: [
      {
        name: 'fill_slot_remind',
        args: [],
        params: [],
        kind: 'trigger',
        alsoWrites: [],
        ...(handwrittenReason === undefined ? {} : { handwritten: handwrittenReason }),
      },
    ],
  });
}

describe('T17 導出(derives)を宣言したトリガ関数', () => {
  it('導出の宣言が通れば本文は生成物として何も言わない(handwritten は要らない)', () => {
    expect(verifyTriggerBody(deriveDomain(), dataTableModel([deriveTable('starts_at')]), undefined, TEST_ROOTS)).toEqual([]);
  });

  it('導出の宣言が通らなければ、生成できない理由を error で報告する', () => {
    const found = verifyTriggerBody(deriveDomain(), dataTableModel([deriveTable('ghost')]), undefined, TEST_ROOTS);

    expect(found.map((finding) => [finding.verifier, finding.severity])).toEqual([['T17', 'error']]);
    expect(found[0]?.message).toContain('日時(datetime)の欄ではありません');
  });
});

/** 名指しの検査のための一時リポジトリ(`supabase/migrations/` に 1 本だけ置く)。 */
const ROOT = mkdtempSync(path.join(tmpdir(), 't17-'));

mkdirSync(path.join(ROOT, 'supabase/migrations'), { recursive: true });
writeFileSync(
  path.join(ROOT, 'supabase/migrations/20260101000001_sheets.sql'),
  'create function public.check_sheet_manual() returns trigger language plpgsql as $$ begin return new; end; $$;\n',
  'utf8',
);
writeFileSync(
  path.join(ROOT, 'supabase/migrations/20260101000002_other.sql'),
  'create function public.something_else() returns trigger language plpgsql as $$ begin return new; end; $$;\n',
  'utf8',
);

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** `handwritten` を宣言する表(名指しつき)。 */
function handwritten(migration: string): DataTableSpec {
  return table({
    invariant: 'INV-SHEET-001',
    handwritten: '適用済みの手書き migration が作っている本文である',
    handwrittenMigration: migration,
  });
}

describe('T17 handwritten が名指した migration', () => {
  it('実在してその本文に関数名の字面があれば通す', () => {
    expect(
      verifyTriggerBody(domain(OTHER), dataTableModel([handwritten('20260101000001_sheets.sql')]), ROOT, TEST_ROOTS),
    ).toEqual([]);
  });

  it('実在しないファイル名は落とす', () => {
    const messages = verifyTriggerBody(domain(OTHER), dataTableModel([handwritten('99999999999999_nope.sql')]), ROOT, TEST_ROOTS).map((finding) => finding.message);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('は実在しません');
  });

  it('関数名の字が 1 つも無いファイルは落とす(名指しの誤り)', () => {
    const messages = verifyTriggerBody(domain(OTHER), dataTableModel([handwritten('20260101000002_other.sql')]), ROOT, TEST_ROOTS).map((finding) => finding.message);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('の字は 1 つもありません');
  });

  it('リポジトリの場所を渡さない構成では名指しを見ない', () => {
    expect(
      verifyTriggerBody(domain(OTHER), dataTableModel([handwritten('99999999999999_nope.sql')]), undefined, TEST_ROOTS),
    ).toEqual([]);
  });

  it('supabase/migrations が無い構成でも名指しを見ない(fixture)', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 't17-empty-'));
    try {
      expect(
        verifyTriggerBody(domain(OTHER), dataTableModel([handwritten('99999999999999_nope.sql')]), empty, TEST_ROOTS),
      ).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('T17 別の集約の列との等式は両端の表にトリガが要る', () => {
  /** 2 つの表だけで T17 を回す。 */
  function run(tables: readonly DataTableSpec[], domainOpts: Parameters<typeof crossDomain>[0] = {}) {
    return verifyTriggerBody(crossDomain(domainOpts), dataTableModel(tables), undefined, TEST_ROOTS);
  }

  it('両端が揃っていれば何も言わない(本文は生成物)', () => {
    expect(run([ticketTable(), agentTable()])).toEqual([]);
  });

  it('相手の端が欠けていれば、欠けた端を名指して error', () => {
    const found = run([ticketTable(), agentTable([])]);
    expect(found.map((finding) => finding.severity)).toEqual(['error']);
    expect(found[0]?.counterexample).toMatchObject({ invariant: 'INV-TICKET-001', declaredSide: 'host', missingSide: 'referenced' });
    expect(found[0]?.message).toContain('agent の側に宣言が無い');
  });

  it('行の端が欠けていても error(相手の側だけでは、行の側の付け替えが素通りする)', () => {
    const found = run([ticketTable([]), agentTable()]);
    expect(found.map((finding) => finding.counterexample?.['missingSide'])).toEqual(['host']);
  });

  it('宣言した側の fires が見るべき更新を漏らすなら、生成できない理由を error で報告する', () => {
    const lacking = hostTrigger({ fires: 'after insert or update of org_id' });
    const found = run([ticketTable([lacking]), agentTable([referencedTrigger()])]);
    expect(found.some((finding) => finding.message.includes('agent_id'))).toBe(true);
  });

  it('参照の欄が空にできるなら生成できない(error)', () => {
    const found = run([ticketTable(), agentTable()], { required: false });
    expect(found.map((finding) => finding.message).join('\n')).toContain('空にできる参照の欄');
  });
});
