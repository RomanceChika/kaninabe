/**
 * 未ログインの作成の天井の生成(`model/data/ceiling-plan.ts` の判定 + `sql/ddl-ceiling-triggers.ts` の本文)のユニットテスト。
 *
 * 固定するもの:
 *   - 判定(`judgeCeiling`): 宣言が無ければ none・出せるなら ok(名前は `check_{entity}_rate_limit`・鍵は表ごと 1 本)・
 *     出せない理由は表で網羅する(2 規則・DDL が生成物でない・時刻の欄・鍵の欄・手書きの宣言との二重)
 *   - 本文の**順序**: 隔離の水準の拒否 → いまの行の読み直し → advisory lock → 全体の数え → 鍵ごとの数え。
 *     lock が数えより前・`> max`・`using message`・拒否の errcode が本文の字面で固定される(崩すと嘘になる)
 *   - 出力の性質: コミット時評価の制約トリガ・after insert・定義者の権限・決定的(2 回の出力が同じ)
 *   - 索引の要求: 全体 = [at]・鍵ごと = [column, at]
 */

import { describe, expect, it } from 'vitest';
import { ceilingDeclsOf, ceilingLookupOf, ceilingPlanOf, judgeCeiling } from '../../../lib/model/data/ceiling-plan.js';
import { ceilingTriggersIn } from '../../../lib/sql/ddl-ceiling-triggers.js';
import { generatedTriggers } from '../../../lib/sql/ddl-triggers.js';
import { triggerBodySource } from '../../../lib/sql/ddl-guards.js';
import { ceilingIndexRequests } from '../../../lib/relations/index-requirements/index-lookup.js';
import type { AbuseDecl, AggregateSpecs, CreateRule, SpecModel } from '../../../lib/model/types.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import { accessSpec, aggregate, create, entitySpec, field, specModel, write } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';

const LOC = { file: 'docs/specs/domain/inquiry/access.md', pointer: 'creates.anonymous' };

const FIELDS = [
  field('id', { kind: 'uuid' }, { auto: true }),
  field('sender_email', { kind: 'string' }, { required: true }),
  field('created_at', { kind: 'datetime' }, { auto: true }),
  field('note', { kind: 'string' }),
  field('seen_at', { kind: 'datetime' }),
];

/** 全体の天井つきの abuse(上書きできる)。 */
function abuse(over: Partial<AbuseDecl> = {}): AbuseDecl {
  return { globalCeiling: { max: 30, per: '1 hour' }, location: LOC, ...over };
}

/** 題材のモデル(集約 inquiry。作成の規則・欄・不変条件を差し替えられる)。 */
function domain(
  opts: {
    readonly creates?: readonly CreateRule[];
    readonly fields?: typeof FIELDS;
    readonly writes?: ReturnType<typeof write>[];
    readonly statement?: boolean;
  } = {},
): SpecModel {
  const specs: AggregateSpecs = aggregate('inquiry', {
    entity: entitySpec('inquiry', { fields: opts.fields ?? FIELDS }),
    access: accessSpec('inquiry', { creates: opts.creates ?? [{ ...create('anonymous'), abuse: abuse() }], writes: opts.writes ?? [] }),
    ...(opts.statement === false
      ? {}
      : {
          invariants: invariantSpec([
            invariant({
              id: 'INV-INQUIRY-002',
              entities: ['inquiry'],
              statement: '天井を超えない',
              enforcedBy: [{ kind: 'trigger', ref: 'check_inquiry_rate_limit', location: { file: 'x.md' } }],
            }),
          ]),
        }),
  });
  return specModel([specs]);
}

/** 題材の表(DDL を生成する宣言つき)。 */
const TABLE: DataTableSpec = dataTable('inquiries', { entity: 'inquiry', ddlMigration: '20261020000613_ddl_inquiries.sql' });

/** 作成の規則に abuse を載せたモデル。 */
const withAbuse = (over: Partial<AbuseDecl>, opts: Parameters<typeof domain>[0] = {}): SpecModel =>
  domain({ ...opts, creates: [{ ...create('anonymous'), abuse: abuse(over) }] });

describe('judgeCeiling — 宣言が無い表・出せる表', () => {
  it('abuse が無ければ none(entity の無い表・未ログインの作成が無い集約も)', () => {
    expect(judgeCeiling(TABLE, domain({ creates: [create('member')] }))).toEqual({ kind: 'none' });
    expect(judgeCeiling(dataTable('jobs', { internal: true }), domain())).toEqual({ kind: 'none' });
    expect(judgeCeiling(dataTable('others', { entity: 'other' }), domain())).toEqual({ kind: 'none' });
  });

  it('global_ceiling が無い abuse は none(R5-1 が言う。生成器は天井を出さない)', () => {
    expect(judgeCeiling(TABLE, domain({ creates: [{ ...create('anonymous'), abuse: { location: LOC } }] }))).toEqual({ kind: 'none' });
  });

  it('出せる宣言は計画になる(名前は check_{entity}_rate_limit・鍵は表ごとに 1 本・時刻の欄は auto の日時の欄)', () => {
    const plan = ceilingPlanOf(TABLE, domain());

    expect(plan).toMatchObject({
      table: 'inquiries',
      name: 'check_inquiry_rate_limit',
      at: 'created_at',
      global: { max: 30, per: '1 hour' },
      lockKey: 'inquiries:ceiling',
    });
    expect(plan?.perKey).toBeUndefined();
    expect(plan?.invariant?.id).toBe('INV-INQUIRY-002');
  });

  it('per_key があれば計画が運び、本文が引く列は [鍵, 時刻]・無ければ [時刻]', () => {
    const perKey = { column: 'sender_email', max: 5, per: '1 hour' };

    expect(ceilingLookupOf(ceilingPlanOf(TABLE, withAbuse({ perKey })) ?? fail())).toEqual(['sender_email', 'created_at']);
    expect(ceilingLookupOf(ceilingPlanOf(TABLE, domain()) ?? fail())).toEqual(['created_at']);
  });

  it('執行点を名指す不変条件が無くても出せる(拒否の文面の先頭がトリガ名だけになる)', () => {
    const plan = ceilingPlanOf(TABLE, domain({ statement: false }));

    expect(plan?.invariant).toBeUndefined();
  });
});

describe('judgeCeiling — 出せない理由(表で網羅)', () => {
  const cases: readonly { readonly name: string; readonly table?: DataTableSpec; readonly model: SpecModel; readonly reason: string }[] = [
    {
      name: 'abuse が 2 規則にある',
      model: domain({ creates: [{ ...create('anonymous'), abuse: abuse() }, { ...create('member'), abuse: abuse() }] }),
      reason: '2 規則以上',
    },
    { name: '表の DDL が生成物でない(ddl_migration が無い)', table: dataTable('inquiries', { entity: 'inquiry' }), model: domain(), reason: 'ddl_migration' },
    {
      name: 'at が省略で決まらない(auto の日時の欄が無い)',
      model: domain({ fields: FIELDS.filter((item) => item.name !== 'created_at') }),
      reason: 'auto: true の日時の欄がちょうど 1 つではありません',
    },
    { name: 'at が空にできる日時の欄(auto でない)', model: withAbuse({ at: 'seen_at' }), reason: 'auto: true の日時の欄ではありません' },
    { name: 'at が日時の欄でない', model: withAbuse({ at: 'note' }), reason: '日時(datetime)の欄ではありません' },
    { name: 'at が集約の欄に無い', model: withAbuse({ at: 'missing' }), reason: '集約の欄にありません' },
    {
      name: 'at が編集で書き換えられる',
      model: domain({ creates: [{ ...create('anonymous'), abuse: abuse() }], writes: [write('member', ['created_at'])] }),
      reason: '書き換えられます',
    },
    { name: '主キーの欄 id が無い(本文は where id = new.id で読み直す)', model: domain({ fields: FIELDS.filter((item) => item.name !== 'id') }), reason: '主キーの欄 id' },
    { name: '表名が PostgreSQL の予約語', table: dataTable('user', { entity: 'inquiry', ddlMigration: 'x.sql' }), model: domain(), reason: '予約語' },
    { name: '表名が小文字の英数字と _ だけでない', table: dataTable('Inquiries', { entity: 'inquiry', ddlMigration: 'x.sql' }), model: domain(), reason: '引用符なしで SQL に置けません' },
    {
      name: '時刻の欄が予約語',
      model: withAbuse({ at: 'end' }, { fields: [...FIELDS.filter((item) => item.name !== 'created_at'), field('end', { kind: 'datetime' }, { auto: true })] }),
      reason: '予約語',
    },
    { name: 'per_key の欄が空にできる', model: withAbuse({ perKey: { column: 'note', max: 5, per: '1 hour' } }), reason: '空にできる欄' },
    { name: '全体の max が 0', model: withAbuse({ globalCeiling: { max: 0, per: '1 hour' } }), reason: '1 以上の整数' },
    { name: '全体の max が integer の上限を超える', model: withAbuse({ globalCeiling: { max: 2147483648, per: '1 hour' } }), reason: '2147483647 を超えます' },
    { name: 'per が閉じた語でない', model: withAbuse({ globalCeiling: { max: 3, per: '1 week' } }), reason: '"{n} {minute|hour|day}" の形ではありません' },
    { name: 'per_key の per が閉じた語でない', model: withAbuse({ perKey: { column: 'sender_email', max: 2, per: "1 hour'; drop" } }), reason: 'per_key.per' },
    { name: 'per_key の欄が集約に無い', model: withAbuse({ perKey: { column: 'nobody', max: 5, per: '1 hour' } }), reason: 'per_key.column="nobody"' },
    {
      name: '同名のトリガ関数が data_table に手で宣言されている',
      table: dataTable('inquiries', {
        entity: 'inquiry',
        ddlMigration: '20261020000613_ddl_inquiries.sql',
        functions: [{ name: 'check_inquiry_rate_limit', args: [], params: [], kind: 'trigger', alsoWrites: [] }],
      }),
      model: domain(),
      reason: '二重',
    },
    {
      name: '同名のトリガが data_table に手で宣言されている',
      table: dataTable('inquiries', {
        entity: 'inquiry',
        ddlMigration: '20261020000613_ddl_inquiries.sql',
        triggers: [{ name: 'check_inquiry_rate_limit', functionName: 'other_fn', deferred: true, supplies: [], params: {} }],
      }),
      model: domain(),
      reason: '二重',
    },
  ];

  for (const row of cases) {
    it(`${row.name} → refused(理由に「${row.reason}」)で、生成器は何も出さない`, () => {
      const table = row.table ?? TABLE;
      const judged = judgeCeiling(table, row.model);

      expect(judged.kind).toBe('refused');
      expect(judged.kind === 'refused' ? judged.reason : '').toContain(row.reason);
      expect(ceilingTriggersIn(table, row.model)).toEqual([]);
      expect(ceilingDeclsOf(table, row.model)).toEqual({ triggers: [], functions: [] });
    });
  }
});

describe('天井のトリガの本文', () => {
  const perKey = { column: 'sender_email', max: 5, per: '1 hour' };
  const bodyOf = (model: SpecModel): string => {
    const [trigger] = ceilingTriggersIn(TABLE, model);
    return trigger === undefined ? '' : triggerBodySource(trigger.function);
  };

  it('全体の天井だけの本文は、順序・字面ともに固定される', () => {
    expect(bodyOf(domain())).toBe(
      [
        '',
        'begin',
        '    declare',
        '        v_row public.inquiries;',
        '    begin',
        "        if current_setting('transaction_isolation') <> 'read committed' then",
        '            raise exception using',
        "                message = '取引の隔離の水準が read committed でない(repeatable read・serializable)ため、未ログインの作成の天井を数えられません(古い snapshot で先に確定した行を数え落とし、serializable も read committed の取引との交錯は検出しないので拒否します。read committed で実行してください)',",
        "                errcode = 'invalid_transaction_state';",
        '        end if;',
        '        select * into v_row from public.inquiries where id = new.id;',
        '        if not found then',
        '            return null;',
        '        end if;',
        "        perform pg_advisory_xact_lock(hashtext('inquiries:ceiling'));",
        '        if (',
        '            select count(*) from public.inquiries',
        "            where created_at > now() - interval '1 hour'",
        '        ) > 30 then',
        '            raise exception using',
        "                message = 'check_inquiry_rate_limit: INV-INQUIRY-002: この表への作成が全体の天井(1 hour に 30 件)を超えています',",
        "                errcode = 'check_violation',",
        "                constraint = 'check_inquiry_rate_limit';",
        '        end if;',
        '        return null;',
        '    end;',
        'end;',
        '',
      ].join('\n'),
    );
  });

  it('per_key があれば、読み直した行の鍵で同じ数えが続く(全体の後)', () => {
    const body = bodyOf(withAbuse({ perKey }));

    expect(body).toContain('where sender_email = v_row.sender_email');
    expect(body).toContain("and created_at > now() - interval '1 hour'");
    expect(body).toContain(') > 5 then');
    expect(body).toContain('同じ sender_email の作成が鍵ごとの天井(1 hour に 5 件)を超えています');
    expect(body.indexOf(') > 30 then')).toBeLessThan(body.indexOf(') > 5 then'));
  });

  it('順序: 隔離の拒否 < 行の読み直し < lock < 全体の数え < 鍵ごとの数え(lock が数えより前)', () => {
    const body = bodyOf(withAbuse({ perKey }));
    const order = ['transaction_isolation', 'select * into v_row', 'pg_advisory_xact_lock', ') > 30 then', ') > 5 then'].map((needle) => body.indexOf(needle));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('拒否は using message(書式文字列にしない)・天井の超過は check_violation・隔離の拒否は invalid_transaction_state で不変条件 ID を載せない', () => {
    const body = bodyOf(withAbuse({ perKey }));

    expect(body).not.toMatch(/raise exception '/);
    expect(body.match(/raise exception using/g)).toHaveLength(3);
    expect(body.match(/errcode = 'check_violation'/g)).toHaveLength(2);
    expect(body).toContain("errcode = 'invalid_transaction_state'");
    // 隔離の拒否には、トリガ名(制約名)も不変条件 ID も載せない(呼び出し側の写像が本文から探して「天井の超過」と誤読しないため)。
    const isolation = body.slice(0, body.indexOf('select * into v_row'));
    expect(isolation).not.toContain('INV-INQUIRY-002');
    expect(isolation).not.toContain('check_inquiry_rate_limit');
    expect(isolation).not.toContain('constraint =');
  });

  it('数える対象は期間の中の行だけ(消された行は数えない = スライドする期間)で、削除を表す列・条件を持たない', () => {
    const body = bodyOf(withAbuse({ perKey }));

    expect(body).not.toMatch(/deleted|count\(distinct/);
    expect(body.match(/select count\(\*\) from public\.inquiries/g)).toHaveLength(2);
  });

  it('期間の字面は interval にそのまま載る(分・日・複数形)', () => {
    expect(bodyOf(withAbuse({ globalCeiling: { max: 3, per: '15 minute' } }))).toContain("interval '15 minute'");
    expect(bodyOf(withAbuse({ globalCeiling: { max: 3, per: '2 days' } }))).toContain("interval '2 days'");
  });

  it('不変条件が無ければ文面の先頭はトリガ名だけ', () => {
    expect(bodyOf(domain({ statement: false }))).toContain("message = 'check_inquiry_rate_limit: この表への作成が全体の天井");
  });

  it('2 回出しても同じ(決定的)', () => {
    expect(JSON.stringify(ceilingTriggersIn(TABLE, withAbuse({ perKey })))).toBe(JSON.stringify(ceilingTriggersIn(TABLE, withAbuse({ perKey }))));
  });
});

describe('天井のトリガの計画', () => {
  it('コミット時評価の制約トリガ・after insert・定義者の権限・関数名はトリガ名と同じ', () => {
    const [trigger] = ceilingTriggersIn(TABLE, domain());

    expect(trigger).toMatchObject({
      name: 'check_inquiry_rate_limit',
      fires: 'after insert',
      deferred: true,
      function: { name: 'check_inquiry_rate_limit', securityDefiner: true },
    });
    expect(trigger?.function.comment).toContain('INV-INQUIRY-002');
  });

  it('DDL の計画(generatedTriggers)に、写し・導出・条件の家族と並んで載る', () => {
    expect(generatedTriggers(TABLE, domain(), [TABLE]).map((trigger) => trigger.name)).toEqual(['check_inquiry_rate_limit']);
  });

  it('宣言(閉世界・ハンドブックが読む形)は、トリガと関数が 1 本ずつ・本文が引く列を lookup に持つ', () => {
    const decls = ceilingDeclsOf(TABLE, withAbuse({ perKey: { column: 'sender_email', max: 5, per: '1 hour' } }));

    expect(decls.triggers).toEqual([
      { name: 'check_inquiry_rate_limit', functionName: 'check_inquiry_rate_limit', fires: 'after insert', deferred: true, supplies: [], params: {}, invariant: 'INV-INQUIRY-002' },
    ]);
    expect(decls.functions).toEqual([
      { name: 'check_inquiry_rate_limit', args: [], params: [], kind: 'trigger', alsoWrites: [], security: 'definer', lookup: ['sender_email', 'created_at'] },
    ]);
  });
});

describe('天井が要求する索引(T2 の導出の入力)', () => {
  it('全体 = [at]・鍵ごと = [column, at]。要求元は生成されるトリガ関数の名前', () => {
    const requests = ceilingIndexRequests(dataTableModel([TABLE]), withAbuse({ perKey: { column: 'sender_email', max: 5, per: '1 hour' } }));

    expect(requests.map((request) => [request.table, request.columns, request.function])).toEqual([
      ['inquiries', ['created_at'], 'check_inquiry_rate_limit'],
      ['inquiries', ['sender_email', 'created_at'], 'check_inquiry_rate_limit'],
    ]);
  });

  it('per_key が無ければ全体の 1 本だけ・出せない宣言・宣言が無い表は何も要求しない', () => {
    expect(ceilingIndexRequests(dataTableModel([TABLE]), domain()).map((request) => request.columns)).toEqual([['created_at']]);
    expect(ceilingIndexRequests(dataTableModel([dataTable('inquiries', { entity: 'inquiry' })]), domain())).toEqual([]);
    expect(ceilingIndexRequests(dataTableModel([TABLE]), domain({ creates: [create('member')] }))).toEqual([]);
  });
});

/** 失敗を表す(計画が出るはずの場所で出なかったとき)。 */
function fail(): never {
  throw new Error('計画が出るはずでした');
}
