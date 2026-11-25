/**
 * R5(未ログインの書き込みの濫用の歯止め)の単体テスト。
 *
 * 形ごとに「止める形(負例)」「通る形(正例)」「受け入れの誤用」を表で 1 つずつ固定する。
 * R5-4(生成器が天井を出せない)は末尾の describe。R5-7 / R5-8(有料の口)は B4-2 の範囲。
 */

import { describe, expect, it } from 'vitest';
import { verifyAbuse } from '../../../lib/risk/verifiers/r5-abuse.js';
import type { AbuseDecl, AggregateSpecs, CreateRule, DeleteRule, EventDef, RoleSpec, SpecModel, WriteRule } from '../../../lib/model/types.js';
import { accessSpec, aggregate, create, del, entitySpec, event, field, machine, role, roleSpec, specModel, write } from '../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';

const LOC = { file: 'docs/specs/domain/inquiry/access.md', pointer: 'creates.anonymous' };

/** 全体の天井つきの abuse(上書きできる)。 */
function abuse(over: Partial<AbuseDecl> = {}): AbuseDecl {
  return { globalCeiling: { max: 30, per: '1 hour' }, location: LOC, ...over };
}

const FIELDS = [
  field('id', { kind: 'uuid' }, { auto: true }),
  field('sender_email', { kind: 'string' }, { required: true }),
  field('created_at', { kind: 'datetime' }, { auto: true }),
  field('note', { kind: 'string' }),
];

/** 1 集約のモデル(既定のロールは anonymous / member / system)。 */
function modelOf(opts: {
  readonly creates?: readonly CreateRule[];
  readonly writes?: readonly WriteRule[];
  readonly deletes?: readonly DeleteRule[];
  readonly events?: readonly EventDef[];
  readonly roles?: RoleSpec;
  readonly fields?: typeof FIELDS;
}): SpecModel {
  const specs: AggregateSpecs = aggregate('inquiry', {
    entity: entitySpec('inquiry', { fields: opts.fields ?? FIELDS }),
    access: accessSpec('inquiry', { creates: opts.creates ?? [], writes: opts.writes ?? [], deletes: opts.deletes ?? [] }),
    stateMachines:
      opts.events === undefined ? [] : [machine('inquiry', { states: ['new', 'closed'], initial: 'new', events: opts.events })],
  });
  return opts.roles === undefined ? specModel([specs]) : specModel([specs], opts.roles);
}

/** 指摘を `検査 ID|severity|message` の文字列にして返す。 */
function messages(model: SpecModel): readonly string[] {
  return verifyAbuse(model).map((finding) => `${finding.verifier}|${finding.severity}|${finding.message}`);
}

/** 未ログインの作成(over が null なら abuse を持たない)。 */
const anonymousCreate = (over: Partial<AbuseDecl> | null = {}): CreateRule => ({
  ...create('anonymous'),
  ...(over === null ? {} : { abuse: abuse(over) }),
});

describe('R5-1 未ログインの作成の全体の天井', () => {
  it('abuse が無い未ログインの作成は止まる(文面は設計の型。severity は error)', () => {
    expect(messages(modelOf({ creates: [anonymousCreate(null)] }))).toEqual([
      'R5|error|inquiry.creates[0](by: anonymous) は未ログインが書ける作成で、全体の天井がありません' +
        '(毎回違う鍵で送れば行を無制限に作られ、DB の枠とスタッフの画面が溢れます)',
    ]);
  });

  it('指摘には直し方(abuse の書き方)と、値は製品が決めることが載る', () => {
    const [finding] = verifyAbuse(modelOf({ creates: [anonymousCreate(null)] }));

    expect(finding?.suggestion).toContain('abuse: { global_ceiling: { max, per } }');
    expect(finding?.suggestion).toContain('値の大きさは製品が決められます');
    expect(finding?.counterexample).toEqual({ rule: 'inquiry.creates[0](by: anonymous)', missing: 'abuse.global_ceiling' });
  });

  it('abuse はあるが global_ceiling が無い(per_key だけ)のも止まる', () => {
    const withoutCeiling: AbuseDecl = { perKey: { column: 'sender_email', max: 5, per: '1 hour' }, location: LOC };

    expect(messages(modelOf({ creates: [{ ...create('anonymous'), abuse: withoutCeiling }] }))).toEqual([
      expect.stringContaining('全体の天井がありません'),
    ]);
  });

  it('global_ceiling があれば通る(正例)', () => {
    expect(messages(modelOf({ creates: [anonymousCreate()] }))).toEqual([]);
  });

  it('未ログインでない作成(member・system)は abuse が無くても何も言わない', () => {
    expect(messages(modelOf({ creates: [create('member'), create('system')] }))).toEqual([]);
  });

  it('未ログインの規則が 2 本あり片方だけに abuse があれば、表に 1 本の天井が両方を覆うので通る(トリガは表の行を規則に依らず数える)', () => {
    expect(messages(modelOf({ creates: [anonymousCreate(), anonymousCreate(null)] }))).toEqual([]);
  });

  it('未ログインのロールが無い仕様では、どの作成も止めない', () => {
    const roles = roleSpec([role('member'), role('system')]);

    expect(messages(modelOf({ creates: [create('member')], roles }))).toEqual([]);
  });

  it('値の妥当性は見ない(max が極端に大きくても、形が正しければ通る)', () => {
    expect(messages(modelOf({ creates: [anonymousCreate({ globalCeiling: { max: 1_000_000, per: '1 minute' } })] }))).toEqual([]);
  });
});

describe('R5-2 abuse の書き方', () => {
  const BAD_SHAPES: readonly { readonly title: string; readonly over: Partial<AbuseDecl>; readonly expected: string }[] = [
    { title: 'max が 0', over: { globalCeiling: { max: 0, per: '1 hour' } }, expected: 'global_ceiling.max=0 は 1 以上の整数ではありません' },
    { title: 'max が負', over: { globalCeiling: { max: -1, per: '1 hour' } }, expected: 'global_ceiling.max=-1' },
    { title: 'max が小数', over: { globalCeiling: { max: 2.5, per: '1 hour' } }, expected: 'global_ceiling.max=2.5' },
    {
      title: 'per が閉じた語でない(週)',
      over: { globalCeiling: { max: 3, per: '1 week' } },
      expected: 'global_ceiling.per="1 week" は "{n} {minute|hour|day}" の形ではありません',
    },
    { title: 'per の数が 0', over: { globalCeiling: { max: 3, per: '0 hour' } }, expected: 'global_ceiling.per="0 hour"' },
    { title: 'per の数が無い', over: { globalCeiling: { max: 3, per: 'hour' } }, expected: 'global_ceiling.per="hour"' },
    { title: 'per_key.max が 0', over: { perKey: { column: 'sender_email', max: 0, per: '1 hour' } }, expected: 'per_key.max=0' },
    { title: 'per_key.per が閉じた語でない', over: { perKey: { column: 'sender_email', max: 3, per: '1 month' } }, expected: 'per_key.per="1 month"' },
    {
      title: 'per_key.column が欄に無い',
      over: { perKey: { column: 'no_such', max: 3, per: '1 hour' } },
      expected: 'per_key.column="no_such" は集約の欄にありません',
    },
    {
      title: 'per_key.max が global_ceiling.max より大きい',
      over: { perKey: { column: 'sender_email', max: 31, per: '1 hour' } },
      expected: 'per_key.max=31 が global_ceiling.max=30 より大きい',
    },
    { title: 'at が欄に無い', over: { at: 'no_such' }, expected: 'at="no_such" は集約の欄にありません' },
    { title: 'at が日時の欄でない', over: { at: 'sender_email' }, expected: 'at="sender_email" は日時(datetime)の欄ではありません' },
    { title: 'per が 366 日を超える(日)', over: { globalCeiling: { max: 3, per: '367 days' } }, expected: '366 日を超えます' },
    { title: 'per が 366 日を超える(分)', over: { globalCeiling: { max: 3, per: '999999 minutes' } }, expected: '366 日を超えます' },
    { title: 'per_key.per が 366 日を超える', over: { perKey: { column: 'sender_email', max: 3, per: '9000 hours' } }, expected: 'per_key.per="9000 hours" は 366 日を超えます' },
  ];

  for (const { title, over, expected } of BAD_SHAPES) {
    it(`止まる: ${title}`, () => {
      const found = messages(modelOf({ creates: [anonymousCreate(over)] }));

      expect(found).toEqual([expect.stringContaining('の abuse の書き方が不正です')]);
      expect(found[0]).toContain(expected);
    });
  }

  it('通る(正例): per_key が global_ceiling と同じ値・at が日時の欄・複数形の単位', () => {
    const over = { perKey: { column: 'sender_email', max: 30, per: '2 hours' }, at: 'created_at', globalCeiling: { max: 30, per: '1 day' } };

    expect(messages(modelOf({ creates: [anonymousCreate(over)] }))).toEqual([]);
  });

  it('通る(正例): 366 日ちょうど', () => {
    expect(messages(modelOf({ creates: [anonymousCreate({ globalCeiling: { max: 3, per: '366 days' } })] }))).toEqual([]);
  });

  it('1 つの access_spec に abuse が 2 規則以上あると、2 本目以降が止まる', () => {
    const found = messages(modelOf({ creates: [anonymousCreate(), anonymousCreate()] }));

    expect(found).toEqual([expect.stringContaining('abuse が同じ access_spec の 2 規則以上にあります')]);
    expect(found[0]).toContain('inquiry.creates[1](by: anonymous)');
  });

  it('1 規則に複数の問題があれば 1 件にまとめて全部言う', () => {
    const over = { globalCeiling: { max: 0, per: '1 week' }, at: 'no_such' };
    const found = messages(modelOf({ creates: [anonymousCreate(over)] }));

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('global_ceiling.max=0');
    expect(found[0]).toContain('global_ceiling.per="1 week"');
    expect(found[0]).toContain('at="no_such"');
  });
});

describe('R5-2 期間を切る欄の契約(NOT NULL・既定値・書き換え不可)', () => {
  const id = field('id', { kind: 'uuid' }, { auto: true });
  const key = field('sender_email', { kind: 'string' });
  const autoAt = field('created_at', { kind: 'datetime' }, { auto: true });

  const CASES: readonly { readonly title: string; readonly fields: typeof FIELDS; readonly at?: string; readonly expected: string }[] = [
    {
      title: 'at が空にできる(required でも auto でもない)日時の欄',
      fields: [id, key, field('sent_at', { kind: 'datetime' })],
      at: 'sent_at',
      expected: 'at="sent_at" は auto: true の日時の欄ではありません(空にできる・作成の入力で時刻を書ける・作成時の既定値(now())が無い',
    },
    {
      title: 'at が required でも auto でない(入力で書ける・既定値が無い)日時の欄',
      fields: [id, key, field('sent_at', { kind: 'datetime' }, { required: true })],
      at: 'sent_at',
      expected: 'at="sent_at" は auto: true の日時の欄ではありません(作成の入力で時刻を書ける・作成時の既定値(now())が無い',
    },
    {
      title: 'at を省略したが auto の日時の欄が無い',
      fields: [id, key, field('sent_at', { kind: 'datetime' })],
      expected: '期間を切る欄が決まりません',
    },
    {
      title: 'at を省略したが auto の日時の欄が 2 つある',
      fields: [id, key, autoAt, field('updated_at', { kind: 'datetime' }, { auto: true })],
      expected: 'ちょうど 1 つではありません(2 個)',
    },
  ];

  for (const { title, fields, at, expected } of CASES) {
    it(`止まる: ${title}`, () => {
      const over = at === undefined ? {} : { at };
      const found = messages(modelOf({ fields, creates: [anonymousCreate(over)] }));

      expect(found).toEqual([expect.stringContaining('の abuse の書き方が不正です')]);
      expect(found[0]).toContain(expected);
    });
  }

  it('止まる: auto の日時の欄でも、編集(writes)で書き換えられる宣言があれば', () => {
    const found = messages(modelOf({ creates: [anonymousCreate()], writes: [write('member', ['created_at'])] }));

    expect(found).toEqual([expect.stringContaining('created_at が編集・遷移の宣言で書き換えられます')]);
  });

  it('止まる: 遷移だけが書く列(transition_writes)・records_time に含まれていても', () => {
    const viaTransition = specModel([
      aggregate('inquiry', {
        entity: entitySpec('inquiry', { fields: FIELDS }),
        access: { ...accessSpec('inquiry', { creates: [anonymousCreate()] }), transitionWrites: ['created_at'] },
      }),
    ]);
    const viaRecordsTime = modelOf({
      creates: [anonymousCreate()],
      events: [event('close', { from: ['new'], to: 'closed', by: ['member'], recordsTime: ['created_at'] })],
    });

    expect(messages(viaTransition)).toEqual([expect.stringContaining('書き換えられます')]);
    expect(messages(viaRecordsTime)).toEqual([expect.stringContaining('書き換えられます')]);
  });

  it('通る(正例): at を省略して auto の日時の欄がちょうど 1 つ・明示した auto の欄', () => {
    expect(messages(modelOf({ creates: [anonymousCreate()] }))).toEqual([]);
    expect(messages(modelOf({ creates: [anonymousCreate({ at: 'created_at' })] }))).toEqual([]);
  });
});

describe('R5-3 未ログインでない規則の abuse', () => {
  it('member の作成に abuse を書くと止まる(効く先の無い宣言)', () => {
    const rule: CreateRule = { ...create('member'), abuse: abuse() };

    expect(messages(modelOf({ creates: [rule] }))).toEqual([
      expect.stringContaining('inquiry.creates[0](by: member) に abuse がありますが、未ログインのロールの作成の規則ではありません'),
    ]);
  });

  it('system の作成に abuse を書いても止まる', () => {
    const rule: CreateRule = { ...create('system'), abuse: abuse() };

    expect(messages(modelOf({ creates: [rule] }))).toEqual([expect.stringContaining('inquiry.creates[0](by: system) に abuse があります')]);
  });

  it('未ログインのロールが無い仕様では、どの abuse も効く先が無い', () => {
    const roles = roleSpec([role('member'), role('system')]);
    const rule: CreateRule = { ...create('member'), abuse: abuse() };

    expect(messages(modelOf({ creates: [rule], roles }))).toEqual([expect.stringContaining('abuse がありますが')]);
  });

  it('未ログインの作成が abuse を持ち、member の作成が持たないなら何も言わない(正例)', () => {
    expect(messages(modelOf({ creates: [anonymousCreate(), create('member')] }))).toEqual([]);
  });
});

describe('R5-5 未ログインの更新・削除・遷移の受け入れ', () => {
  const anonymousWrite = (over: Partial<WriteRule> = {}): WriteRule => ({ ...write('anonymous', ['note']), ...over });
  const anonymousDelete = (over: Partial<DeleteRule> = {}): DeleteRule => ({ ...del('anonymous'), ...over });
  const anonymousEvent = (over: Partial<EventDef> = {}): EventDef => ({
    ...event('withdraw', { from: ['new'], to: 'closed', by: ['member', 'anonymous'] }),
    ...over,
  });

  const CASES: readonly {
    readonly kind: string;
    readonly place: string;
    readonly bare: SpecModel;
    readonly withEmpty: SpecModel;
    readonly accepted: SpecModel;
  }[] = [
    {
      kind: 'writes',
      place: 'inquiry.writes[0](by: anonymous)',
      bare: modelOf({ writes: [anonymousWrite()] }),
      withEmpty: modelOf({ writes: [anonymousWrite({ public: ' ' })] }),
      accepted: modelOf({ writes: [anonymousWrite({ public: '送り主が直後に直せる' })] }),
    },
    {
      kind: 'deletes',
      place: 'inquiry.deletes[0](by: anonymous)',
      bare: modelOf({ deletes: [anonymousDelete()] }),
      withEmpty: modelOf({ deletes: [anonymousDelete({ public: '' })] }),
      accepted: modelOf({ deletes: [anonymousDelete({ public: '送り主が取り下げられる' })] }),
    },
    {
      kind: 'events',
      place: 'inquiry.withdraw(by: member, anonymous)',
      bare: modelOf({ events: [anonymousEvent()] }),
      withEmpty: modelOf({ events: [anonymousEvent({ public: '   ' })] }),
      accepted: modelOf({ events: [anonymousEvent({ public: '送り主の取り下げ' })] }),
    },
  ];

  for (const { kind, place, bare, withEmpty, accepted } of CASES) {
    it(`${kind}: public が無いと止まる(認証なしで動かせる形)`, () => {
      expect(messages(bare)).toEqual([expect.stringContaining(`${place} は未ログインが更新・削除・遷移を起こせる形です`)]);
      expect(verifyAbuse(bare)[0]?.suggestion).toContain('public: 理由');
    });

    it(`${kind}: public が空白だけでも止まる(理由の無い受け入れは受け入れの無いのと同じ)`, () => {
      expect(messages(withEmpty)).toEqual([expect.stringContaining(`${place} の public の理由が空です`)]);
    });

    it(`${kind}: public に理由があれば通る(正例)`, () => {
      expect(messages(accepted)).toEqual([]);
    });
  }

  it('未ログインでない更新・削除・遷移は public が無くても何も言わない', () => {
    const model = modelOf({
      writes: [write('member', ['note'])],
      deletes: [del('system')],
      events: [event('close', { from: ['new'], to: 'closed', by: ['member', 'system'] })],
    });

    expect(messages(model)).toEqual([]);
  });

  it('遷移の by に未ログインのロールが 1 つでも並んでいれば対象になる', () => {
    const model = modelOf({ events: [event('close', { from: ['new'], to: 'closed', by: ['member', 'anonymous', 'system'] })] });

    expect(messages(model)).toEqual([expect.stringContaining('inquiry.close(by: member, anonymous, system)')]);
  });
});

describe('R5-6 腐った public', () => {
  it('member の更新に public を書くと止まる(何も受け入れていない)', () => {
    const rule: WriteRule = { ...write('member', ['note']), public: 'メンバーに開く' };

    expect(messages(modelOf({ writes: [rule] }))).toEqual([
      expect.stringContaining('inquiry.writes[0](by: member) に public がありますが、未ログインのロールの規則ではありません'),
    ]);
  });

  it('system の削除・未ログインのいない遷移に public を書いても止まる', () => {
    const model = modelOf({
      deletes: [{ ...del('system'), public: '理由' }],
      events: [{ ...event('close', { from: ['new'], to: 'closed', by: ['member'] }), public: '理由' }],
    });
    const found = messages(model);

    expect(found).toHaveLength(2);
    expect(found.every((text) => text.includes('腐った受け入れです'))).toBe(true);
  });

  it('空白だけの public も、未ログインの規則でなければ腐った受け入れとして止まる', () => {
    const rule: DeleteRule = { ...del('member'), public: ' ' };

    expect(messages(modelOf({ deletes: [rule] }))).toEqual([expect.stringContaining('腐った受け入れです')]);
  });

  it('未ログインのロールが無い仕様では、どの public も腐っている', () => {
    const roles = roleSpec([role('member'), role('system')]);
    const rule: WriteRule = { ...write('member', ['note']), public: '理由' };

    expect(messages(modelOf({ writes: [rule], roles }))).toEqual([expect.stringContaining('腐った受け入れです')]);
  });
});

describe('R5 全体', () => {
  it('access も状態機械も無い集約は何も言わない', () => {
    expect(verifyAbuse(specModel([aggregate('empty')]))).toEqual([]);
  });

  it('entity が無い集約でも、鍵の欄が無い扱いになるだけで throw しない', () => {
    const specs = aggregate('inquiry', {
      access: accessSpec('inquiry', { creates: [anonymousCreate({ perKey: { column: 'sender_email', max: 3, per: '1 hour' } })] }),
    });

    expect(messages(specModel([specs]))).toEqual([expect.stringContaining('per_key.column="sender_email" は集約の欄にありません')]);
  });

  it('指摘の位置は規則の場所(ファイルと pointer)を指す', () => {
    const [finding] = verifyAbuse(modelOf({ creates: [anonymousCreate(null)] }));

    expect(finding?.location.file).toBe('docs/specs/domain/test/access.md');
  });
});

describe('独立レビューの直し(2026-10-21)', () => {
  it('未ログインのロールが含意するロールの規則も、未ログインに開いている(作成は天井・更新/削除/遷移は public が要る)', () => {
    const roles = roleSpec([role('anonymous', undefined, ['member']), role('member'), role('system')]);
    const found = messages(
      modelOf({
        roles,
        creates: [create('member')],
        writes: [write('member', ['note'])],
        deletes: [del('member')],
        events: [event('close', { from: ['new'], to: 'closed', by: ['member'] })],
      }),
    );
    expect(found).toEqual([
      expect.stringContaining('inquiry.creates[0](by: member) は未ログインが書ける作成で、全体の天井がありません'),
      expect.stringContaining('inquiry.writes[0](by: member)'),
      expect.stringContaining('inquiry.deletes[0](by: member)'),
      expect.stringContaining('inquiry.close(by: member)'),
    ]);
  });

  it('含意が無ければ member の規則は対象外のまま(対照)', () => {
    expect(messages(modelOf({ creates: [create('member')], writes: [write('member', ['note'])] }))).toEqual([]);
  });

  it('天井の max は SQL の integer の範囲まで(2147483647 は通り、それを超える値・1e21 は止まる)', () => {
    expect(messages(modelOf({ creates: [anonymousCreate({ globalCeiling: { max: 2147483647, per: '1 minute' } })] }))).toEqual([]);
    for (const max of [2147483648, 1e21]) {
      expect(messages(modelOf({ creates: [anonymousCreate({ globalCeiling: { max, per: '1 minute' } })] })), String(max)).toEqual([
        expect.stringContaining('は 2147483647 を超えます'),
      ]);
    }
  });

  it('per_key の鍵が空にできる欄なら止まる(空の鍵どうしは等しくならず、鍵を省けばすり抜ける)。required / auto なら通る', () => {
    const perKey = { column: 'note', max: 5, per: '1 hour' };
    expect(messages(modelOf({ creates: [anonymousCreate({ perKey })] }))).toEqual([expect.stringContaining('per_key.column="note" は空にできる欄です')]);
    expect(messages(modelOf({ creates: [anonymousCreate({ perKey: { ...perKey, column: 'sender_email' } })] }))).toEqual([]);
    expect(messages(modelOf({ creates: [anonymousCreate({ perKey: { ...perKey, column: 'id' } })] }))).toEqual([]);
  });
});

describe('R5-4 生成器が天井を出せない宣言(判定は生成器と同じ judgeCeiling)', () => {
  const ready = dataTable('inquiries', { entity: 'inquiry', ddlMigration: '20261020000613_ddl_inquiries.sql' });
  const run = (model: SpecModel, tables?: ReturnType<typeof dataTableModel>): readonly string[] =>
    verifyAbuse(model, tables).map((finding) => `${finding.verifier}|${finding.severity}|${finding.message}`);
  const open = (): SpecModel => modelOf({ creates: [anonymousCreate()] });

  it('生成器が出せる表があれば何も言わない(正例)', () => {
    expect(run(open(), dataTableModel([ready]))).toEqual([]);
  });

  it('data_table の材料が無い(未選択・available でない)ときは R5-4 を見ない', () => {
    expect(run(open())).toEqual([]);
    expect(run(open(), dataTableModel([], false))).toEqual([]);
  });

  it('集約の表が無ければ止まる(宣言だけで DB が天井を課さない嘘になる)', () => {
    expect(run(open(), dataTableModel([dataTable('others', { entity: 'other', ddlMigration: 'x.sql' })]))).toEqual([
      'R5|error|inquiry.creates[0](by: anonymous) の abuse は、生成器が制約トリガにできません: 集約 inquiry の表(data_table)がありません(宣言だけで DB が天井を課さない、嘘の宣言になります)',
    ]);
  });

  it('表の DDL が生成物でない(ddl_migration が無い)と止まり、直し方が載る', () => {
    const [finding] = verifyAbuse(open(), dataTableModel([dataTable('inquiries', { entity: 'inquiry' })]));

    expect(finding?.message).toContain('表 inquiries の DDL が生成物ではありません');
    expect(finding?.suggestion).toContain('ddl_migration');
    expect(finding?.counterexample).toMatchObject({ rule: 'inquiry.creates[0](by: anonymous)' });
  });

  it('鍵の欄(per_key)が編集・遷移で書き換えられると止まる(トリガは挿入の時だけ数える。外部レビュー)', () => {
    const perKey = { column: 'sender_email', max: 5, per: '1 hour' };
    const tables = dataTableModel([ready]);
    const viaWrite = modelOf({ creates: [anonymousCreate({ perKey })], writes: [write('member', ['sender_email'])] });
    const viaEvent = modelOf({ creates: [anonymousCreate({ perKey })], events: [event('close', { from: ['new'], to: 'closed', by: ['member'], recordsActor: ['sender_email'] })] });
    for (const model of [viaWrite, viaEvent]) {
      expect(run(model, tables)).toEqual([expect.stringContaining('鍵の欄(per_key) sender_email が編集・遷移の宣言で書き換えられます')]);
    }
    expect(run(modelOf({ creates: [anonymousCreate({ perKey })], writes: [write('member', ['note'])] }), tables)).toEqual([]);
  });

  it('同名のトリガが手で宣言されていると止まる(二重になる)', () => {
    const doubled = dataTable('inquiries', {
      entity: 'inquiry',
      ddlMigration: 'x.sql',
      triggers: [{ name: 'check_inquiry_rate_limit', functionName: 'check_inquiry_rate_limit', deferred: true, supplies: [], params: {} }],
    });

    expect(run(open(), dataTableModel([doubled]))).toEqual([expect.stringContaining('check_inquiry_rate_limit という名前のトリガ・関数が宣言されています')]);
  });

  it('天井の鍵の受け入れを parity_accepts に手で書くと止まる(宣言から導くので二重になる。点検 26 回目の後の判断待ち 1)', () => {
    const accepted = dataTable('inquiries', {
      entity: 'inquiry',
      ddlMigration: 'x.sql',
      parityAccepts: [{ check: 'trigger_advisory', function: 'check_inquiry_rate_limit', invariant: 'INV-INQUIRY-002', reason: '鍵は 1 つ', test: 'TC-X-001' }],
    });

    expect(run(open(), dataTableModel([accepted]))).toEqual([expect.stringContaining('parity_accepts に check_inquiry_rate_limit の trigger_advisory の行があります')]);
    // 別の関数の受け入れ(手書きの下限など)は止めない。
    const other = dataTable('inquiries', {
      entity: 'inquiry',
      ddlMigration: 'x.sql',
      parityAccepts: [{ check: 'trigger_advisory', function: 'check_other_floor', invariant: 'INV-INQUIRY-003', reason: '鍵は 1 つ', test: 'TC-X-002' }],
    });
    expect(run(open(), dataTableModel([other]))).toEqual([]);
  });

  it('abuse の書き方が不正(R5-2)のときは、同じ宣言に R5-4 を重ねない', () => {
    const badAt = modelOf({ creates: [anonymousCreate({ at: 'note' })] });

    expect(run(badAt, dataTableModel([ready])).filter((line) => line.includes('生成器が制約トリガにできません'))).toEqual([]);
    expect(run(badAt, dataTableModel([ready]))).toEqual([expect.stringContaining('abuse の書き方が不正です')]);
  });

  it('全体の天井の無い宣言は R5-1 だけが言う(R5-4 は重ねない)', () => {
    expect(run(modelOf({ creates: [anonymousCreate(null)] }), dataTableModel([ready]))).toEqual([expect.stringContaining('全体の天井がありません')]);
  });

  it('表の引き当ては生成器と同じ(集約ディレクトリ名で entity を書いた表も見つかり、誤って「表が無い」と言わない)', () => {
    const specs = aggregate('box', {
      entity: entitySpec('inquiry', { fields: FIELDS }),
      access: accessSpec('inquiry', { creates: [anonymousCreate()] }),
    });
    const byDirectoryName = dataTable('inquiries', { entity: 'box', ddlMigration: 'x.sql' });

    expect(run(specModel([specs]), dataTableModel([byDirectoryName]))).toEqual([]);
  });

  it('生成器が安全に出せない形(予約語の表名)は R5-4 が理由つきで言う', () => {
    const reserved = dataTable('user', { entity: 'inquiry', ddlMigration: 'x.sql' });

    expect(run(open(), dataTableModel([reserved]))).toEqual([expect.stringContaining('PostgreSQL の予約語です')]);
  });

  it('未ログインでない規則の abuse(R5-3)に R5-4 は重ならない', () => {
    const stray: CreateRule = { ...create('member'), abuse: abuse() };

    expect(run(modelOf({ creates: [stray] }), dataTableModel([ready]))).toEqual([expect.stringContaining('未ログインのロールの作成の規則ではありません')]);
  });
});

describe('未ログインに開く作成の規則が複数(外部レビュー)', () => {
  const roles = roleSpec([role('anonymous', undefined, ['member']), role('member'), role('system')]);

  it('1 つの規則の abuse が表全体の天井として、開く作成の規則すべてを覆う(正例)', () => {
    expect(messages(modelOf({ roles, creates: [anonymousCreate(), create('member')] }))).toEqual([]);
    expect(messages(modelOf({ roles, creates: [create('anonymous'), { ...create('member'), abuse: abuse() }] }))).toEqual([]);
  });

  it('どの開く規則にも天井が無ければ、規則ごとに R5-1', () => {
    expect(messages(modelOf({ roles, creates: [create('anonymous'), create('member')] }))).toEqual([
      expect.stringContaining('inquiry.creates[0](by: anonymous) は未ログインが書ける作成で、全体の天井がありません'),
      expect.stringContaining('inquiry.creates[1](by: member) は未ログインが書ける作成で、全体の天井がありません'),
    ]);
  });

  it('2 つの規則に abuse があれば(同じ値でも)R5-2(天井は表に 1 本)', () => {
    expect(messages(modelOf({ roles, creates: [anonymousCreate(), { ...create('member'), abuse: abuse() }] }))).toEqual([
      expect.stringContaining('abuse が同じ access_spec の 2 規則以上にあります'),
    ]);
  });
});
