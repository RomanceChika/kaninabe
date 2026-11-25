/**
 * 同じ行の日時列 ± 定数の幅で列を埋めるトリガの生成(`ddl-derive-triggers.ts`)のユニットテスト。
 *
 * 固定するのは 6 つである:
 *   - 幅の字面(`{±n} {minute|hour|day}`。複数形・符号省略)が閉じた語として読める
 *   - `initial` は「空のときだけ」を包み、`follow` は無条件に代入する
 *   - 幅は interval の字面に正規化される(1 だけ単数形。符号は引く / 足す)
 *   - 元・幅・方式・対象・重複・`fires` のどれかが通らなければ本文を出さない(理由は検査と共有)
 *   - `handwritten` の関数は出さない(`generatedTriggers` が外す)
 *   - 説明に導出の一覧が出る
 *   - 表の DDL の migration に、関数(security invoker)と存在ガード付きのトリガとして出る
 */

import { describe, expect, it } from 'vitest';
import { deriveTriggersIn } from '../../../lib/sql/ddl-derive-triggers.js';
import { derivationProblemsOf } from '../../../lib/sql/derive-problems.js';
import { parseDeriveOffset } from '../../../lib/sql/derive-offset.js';
import { generatedTriggers } from '../../../lib/sql/ddl-triggers.js';
import { buildDdlMigration } from '../../../lib/sql/ddl-migration.js';
import { tableDdlPlan } from '../../../lib/sql/ddl-plan.js';
import type { DataDerivation, DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { FieldDef, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

/** DB が決める日時の欄。 */
function dbDatetime(name: string): FieldDef {
  return { ...field(name, { kind: 'datetime' }), suppliedBy: 'db' };
}

/** 題材: 開始と期限を持つ催し。リマインド 2 本と確定の時刻は DB が決める。 */
function domain(): SpecModel {
  return specModel([
    aggregate('event', {
      entity: entitySpec('event', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('starts_at', { kind: 'datetime' }, { required: true }),
          field('due_at', { kind: 'datetime' }, { required: true }),
          field('title', { kind: 'string' }, { required: true }),
          dbDatetime('due_reminder_at'),
          dbDatetime('start_reminder_at'),
          dbDatetime('settle_at'),
        ],
      }),
    }),
  ]);
}

/** 導出 1 列。 */
function derive(column: string, from: string, offset: string, mode: string): DataDerivation {
  return { column, from, offset, mode };
}

/** 導出のトリガ 1 本。 */
function trigger(init: Partial<DataTriggerDecl> & { readonly derives: readonly DataDerivation[] }): DataTriggerDecl {
  return {
    name: 'fill_event_times',
    functionName: 'fill_event_times',
    fires: 'before insert',
    deferred: false,
    supplies: init.derives.map((derivation) => derivation.column),
    params: {},
    ...init,
  };
}

/** 催しの表。 */
function table(triggers: readonly DataTriggerDecl[], functions: DataTableSpec['functions'] = []): DataTableSpec {
  return dataTable('events', { entity: 'event', triggers: [...triggers], functions: [...functions] });
}

/** 計画の最初の 1 本。 */
function planned(spec: DataTableSpec) {
  return deriveTriggersIn(spec, domain())[0];
}

describe('導出の幅の字面', () => {
  it('{±n} {単位} を読む(複数形・符号の省略・余分な空白を許す)', () => {
    expect(parseDeriveOffset('-14 days')).toEqual({ sign: '-', amount: 14, unit: 'day' });
    expect(parseDeriveOffset('-1 day')).toEqual({ sign: '-', amount: 1, unit: 'day' });
    expect(parseDeriveOffset('3 days')).toEqual({ sign: '+', amount: 3, unit: 'day' });
    expect(parseDeriveOffset('+90  minutes')).toEqual({ sign: '+', amount: 90, unit: 'minute' });
    expect(parseDeriveOffset('2 hour')).toEqual({ sign: '+', amount: 2, unit: 'hour' });
  });

  it('閉じた語の外は読めない(小数・単位違い・数が無い・桁あふれ・余計な語)', () => {
    for (const raw of ['1.5 days', '3 weeks', 'days', '3', '', '1000000 days', '3 days ago', '- 3 days', '3days']) {
      expect(parseDeriveOffset(raw), raw).toBeNull();
    }
  });
});

describe('導出のトリガ生成', () => {
  it('initial は「空のときだけ」を包み、follow は無条件に代入する', () => {
    const [first, second] = [
      planned(table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-14 days', 'initial')] })])),
      planned(
        table([trigger({ derives: [derive('settle_at', 'due_at', '3 days', 'follow')], fires: 'before insert or update of due_at' })]),
      ),
    ];
    expect(first?.function.body).toEqual([
      'if new.due_reminder_at is null then',
      "    new.due_reminder_at := new.due_at - interval '14 days';",
      'end if;',
      'return new;',
    ]);
    expect(second?.function.body).toEqual(["new.settle_at := new.due_at + interval '3 days';", 'return new;']);
    expect(second?.fires).toBe('before insert or update of due_at');
  });

  it('複数の列は 1 列 1 文で宣言順に並び、幅 1 だけが単数形になる', () => {
    const body = planned(
      table([
        trigger({
          derives: [
            derive('due_reminder_at', 'due_at', '-14 days', 'initial'),
            derive('start_reminder_at', 'starts_at', '-1 day', 'initial'),
          ],
        }),
      ]),
    )?.function.body;
    expect(body?.filter((line) => line.includes(':='))).toEqual([
      "    new.due_reminder_at := new.due_at - interval '14 days';",
      "    new.start_reminder_at := new.starts_at - interval '1 day';",
    ]);
  });

  it('説明に導出の一覧(列・元・幅・方式)が出る', () => {
    const comment = planned(
      table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-14 days', 'initial')] })]),
    )?.function.comment;
    expect(comment).toContain('due_reminder_at = due_at - 14 days (initial)');
  });

  it('本文は new だけを見る(security は書かない = invoker の計画)', () => {
    const plan = planned(table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-14 days', 'initial')] })]));
    expect(plan?.function.securityDefiner).toBeUndefined();
    expect(plan?.deferred).toBeUndefined();
  });

  it('通らない宣言は本文を出さない(部分的な本文は宣言の嘘を通す)', () => {
    const bad = table([trigger({ derives: [derive('due_reminder_at', 'title', '-14 days', 'initial')] })]);
    expect(deriveTriggersIn(bad, domain())).toEqual([]);
  });

  it('handwritten の関数のトリガは generatedTriggers が外す', () => {
    const spec = table(
      [trigger({ derives: [derive('due_reminder_at', 'due_at', '-14 days', 'initial')] })],
      [
        {
          name: 'fill_event_times',
          args: [],
          params: [],
          kind: 'trigger',
          alsoWrites: [],
          handwritten: '手書き',
        },
      ],
    );
    expect(generatedTriggers(spec, domain(), [spec])).toEqual([]);
  });

  it('表の DDL に security invoker の関数と存在ガード付きのトリガとして出る', () => {
    const spec = table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-14 days', 'initial')] })]);
    const plan = tableDdlPlan(spec, domain(), [spec]);
    const sql = plan === null ? '' : buildDdlMigration(plan);

    expect(sql).toContain('create or replace function public.fill_event_times() returns trigger');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("new.due_reminder_at := new.due_at - interval '14 days';");
    expect(sql).toContain('before insert on public.events');
    expect(sql).toContain("t.tgname = 'fill_event_times'");
  });

  it('derives の無いトリガは対象外である', () => {
    const plain: DataTriggerDecl = {
      name: 'fill_event_times',
      functionName: 'fill_event_times',
      fires: 'before insert',
      deferred: false,
      supplies: ['due_reminder_at'],
      params: {},
    };
    expect(deriveTriggersIn(table([plain]), domain())).toEqual([]);
  });
});

describe('導出の宣言が通らない理由', () => {
  /** 1 本のトリガの理由の字面。 */
  function reasons(spec: DataTableSpec): readonly string[] {
    const first = spec.triggers[0];
    return first === undefined ? [] : derivationProblemsOf(first, spec, domain()).map((entry) => `${entry.path}: ${entry.reason}`);
  }

  it('正しい宣言には理由が無い', () => {
    expect(reasons(table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-14 days', 'initial')] })]))).toEqual([]);
  });

  it('元(from)が実在しない・日時でない・自分自身なら止める', () => {
    for (const from of ['nothing', 'title', 'due_reminder_at']) {
      const found = reasons(table([trigger({ derives: [derive('due_reminder_at', from, '-1 day', 'initial')] })]));
      expect(found.join('\n'), from).toContain('derives.due_reminder_at.from');
    }
  });

  it('幅(offset)が閉じた語に合わなければ止める', () => {
    const found = reasons(table([trigger({ derives: [derive('due_reminder_at', 'due_at', '2 weeks', 'initial')] })]));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('derives.due_reminder_at.offset');
  });

  it('方式(mode)が値域の外なら止める', () => {
    const found = reasons(table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-1 day', 'always')] })]));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('derives.due_reminder_at.mode');
  });

  it('導出する列が supplied_by: db でなければ止める(列が無い場合も)', () => {
    for (const column of ['due_at', 'ghost']) {
      const found = reasons(table([trigger({ derives: [derive(column, 'starts_at', '-1 day', 'initial')] })]));
      expect(found.join('\n'), column).toContain('supplied_by: db');
    }
  });

  it('導出する列が日時の型でなければ止める(boolean の列に日時の式を入れた本文を出さない)', () => {
    const withFlag = specModel([
      aggregate('event', {
        entity: entitySpec('event', {
          fields: [
            field('starts_at', { kind: 'datetime' }, { required: true }),
            { ...field('flag', { kind: 'boolean' }), suppliedBy: 'db' },
          ],
        }),
      }),
    ]);
    const spec = table([trigger({ derives: [derive('flag', 'starts_at', '-1 day', 'initial')] })]);
    const first = spec.triggers[0];
    if (first === undefined) throw new Error('トリガが無い');
    const found = derivationProblemsOf(first, spec, withFlag);

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('derives.flag');
    expect(found[0]?.reason).toContain('datetime');
    expect(deriveTriggersIn(spec, withFlag)).toEqual([]);
  });

  it('supplies と derives の列が一致しなければ止める(どちらの側が余っているかを言う)', () => {
    const found = reasons(
      table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-1 day', 'initial')], supplies: ['due_reminder_at', 'settle_at'] })]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('supplies だけ: settle_at');
  });

  it('derives が空なら止める', () => {
    expect(reasons(table([trigger({ derives: [] })])).join('\n')).toContain('derives が空');
  });

  it('同じ列を 2 つのトリガが導出していれば、どちらの側にも止める', () => {
    const one = trigger({ derives: [derive('due_reminder_at', 'due_at', '-1 day', 'initial')] });
    const two = trigger({ name: 'other_fill', functionName: 'other_fill', derives: [derive('due_reminder_at', 'starts_at', '-1 day', 'initial')] });
    const spec = table([one, two]);
    expect(derivationProblemsOf(one, spec, domain()).map((entry) => entry.reason).join('\n')).toContain('other_fill');
    expect(derivationProblemsOf(two, spec, domain()).map((entry) => entry.reason).join('\n')).toContain('fill_event_times');
  });

  it('元(from)が別のトリガの導出列なら、読む側のトリガだけを止める(元になる側は通る)', () => {
    const upstream = trigger({ derives: [derive('due_reminder_at', 'due_at', '-1 day', 'initial')] });
    const chained = trigger({
      name: 'chain_fill',
      functionName: 'chain_fill',
      derives: [derive('start_reminder_at', 'due_reminder_at', '-1 hour', 'initial')],
    });
    const spec = table([upstream, chained]);

    const found = derivationProblemsOf(chained, spec, domain());
    expect(found.map((entry) => entry.path)).toEqual(['derives.start_reminder_at.from']);
    expect(found[0]?.reason).toContain('fill_event_times');
    expect(found[0]?.example).toEqual({ column: 'start_reminder_at', from: 'due_reminder_at', upstream: 'fill_event_times' });
    expect(deriveTriggersIn(spec, domain()).map((plan) => plan.name)).toEqual(['fill_event_times']);
    // 元になる側(入力の列から導く)は通る。
    expect(derivationProblemsOf(upstream, spec, domain())).toEqual([]);
  });

  it('元(from)が同じトリガの別の導出列でも、別のトリガの列でなければこの検査では止めない', () => {
    const both = trigger({
      derives: [derive('due_reminder_at', 'due_at', '-1 day', 'initial'), derive('start_reminder_at', 'due_at', '-1 hour', 'initial')],
    });
    expect(derivationProblemsOf(both, table([both]), domain())).toEqual([]);
  });

  it('follow なのに fires が元の列の更新を含まなければ止める(列を名指さない update は含む)', () => {
    const derives = [derive('settle_at', 'due_at', '3 days', 'follow')];
    expect(reasons(table([trigger({ derives, fires: 'before insert' })])).join('\n')).toContain('更新を含みません');
    expect(reasons(table([trigger({ derives, fires: 'before insert or update of title' })])).join('\n')).toContain('更新を含みません');
    expect(reasons(table([trigger({ derives, fires: 'before insert or update of due_at' })]))).toEqual([]);
    expect(reasons(table([trigger({ derives, fires: 'before insert or update' })]))).toEqual([]);
    expect(reasons(table([trigger({ derives, fires: 'before insert or update of title, due_at' })]))).toEqual([]);
  });

  it('initial は fires に update が無くてよい', () => {
    expect(reasons(table([trigger({ derives: [derive('due_reminder_at', 'due_at', '-1 day', 'initial')] })]))).toEqual([]);
  });

  it('fires が値を入れられる形でなければ止める(after・insert なし・delete・表名・文トリガ・deferred・読めない・無い)', () => {
    const derives = [derive('due_reminder_at', 'due_at', '-1 day', 'initial')];
    const cases: ReadonlyArray<readonly [Partial<DataTriggerDecl>, string]> = [
      [{ fires: 'after insert' }, 'after'],
      [{ fires: 'before update of due_at' }, 'insert を含まない'],
      [{ fires: 'before insert or delete' }, 'delete'],
      [{ fires: 'before insert for each statement' }, 'for each statement'],
      [{ fires: 'before insert', deferred: true }, 'deferred'],
      [{ fires: 'before insert on events' }, '表名'],
      [{ fires: 'たまに' }, '読めません'],
      [{ fires: '' }, '宣言されていません'],
    ];
    for (const [override, expected] of cases) {
      expect(reasons(table([trigger({ derives, ...override })])).join('\n'), expected).toContain(expected);
    }
  });

  it('関数が handwritten なら止める(本文は生成物)', () => {
    const spec = table(
      [trigger({ derives: [derive('due_reminder_at', 'due_at', '-1 day', 'initial')] })],
      [{ name: 'fill_event_times', args: [], params: [], kind: 'trigger', alsoWrites: [], handwritten: '手書き' }],
    );
    expect(reasons(spec).join('\n')).toContain('handwritten');
  });
});
