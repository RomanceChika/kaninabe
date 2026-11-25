import { describe, expect, it } from 'vitest';
import { parseStateSpecs } from '../../../lib/model/parse-state.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FILE = 'docs/specs/domain/entry/states.md';

const MINIMAL_EVENT = { id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] };

function singleMachine(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'state_spec',
    state_machine: 'entry',
    states: [{ id: 'draft' }, { id: 'submitted' }],
    initial: 'draft',
    final: ['submitted'],
    events: [MINIMAL_EVENT],
    ...overrides,
  };
}

describe('parseStateSpecs（単一機械）', () => {
  it('states / initial / final / events / forbidden / effects を読む', () => {
    const result = parseStateSpecs(
      singleMachine({
        events: [
          {
            ...MINIMAL_EVENT,
            guard: 'workshop.state == accepting',
            otherwise_forbidden: '提出は下書きからのみ',
          },
        ],
        forbidden: [{ event: 'submit', from: ['submitted'], reason: '二重提出はできない' }],
        effects: [{ on: 'submit', do: ['notify_discord_organizer'] }],
      }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    const machine = result.value?.[0];
    expect(machine?.machine).toBe('entry');
    expect(machine?.states).toEqual(['draft', 'submitted']);
    expect(machine?.stateLabels).toEqual({});
    expect(machine?.initial).toBe('draft');
    expect(machine?.final).toEqual(['submitted']);
    expect(machine?.events[0]).toEqual({
      id: 'submit',
      from: ['draft'],
      to: 'submitted',
      by: ['performer'],
      guard: 'workshop.state == accepting',
      otherwiseForbidden: '提出は下書きからのみ',
      location: { file: FILE, pointer: 'events.submit' },
    });
    expect(machine?.forbidden[0]?.reason).toBe('二重提出はできない');
    expect(machine?.effects[0]).toMatchObject({ on: 'submit', do: ['notify_discord_organizer'] });
  });

  it('states[].label と events[].label を読む（label を書いた分だけ stateLabels に載る）', () => {
    const result = parseStateSpecs(
      singleMachine({
        states: [{ id: 'draft', label: '下書き' }, { id: 'submitted' }],
        events: [{ ...MINIMAL_EVENT, label: '提出' }],
      }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.states).toEqual(['draft', 'submitted']);
    expect(result.value?.[0]?.stateLabels).toEqual({ draft: '下書き' });
    expect(result.value?.[0]?.events[0]?.label).toBe('提出');
  });

  it('label が文字列でなければ V1 エラーにしてラベルだけ落とす', () => {
    const result = parseStateSpecs(
      singleMachine({
        states: [{ id: 'draft', label: ['下書き'] }, { id: 'submitted' }],
        events: [{ ...MINIMAL_EVENT, label: 3 }],
      }),
      FILE,
    );

    expect(result.value?.[0]?.stateLabels).toEqual({});
    expect(result.value?.[0]?.events[0]?.label).toBeUndefined();
    expect(result.findings.filter((finding) => finding.message === 'label は文字列で書きます')).toHaveLength(
      2,
    );
  });

  it('otherwise_forbidden の欠落は V1 では指摘しない（V3 の担当）', () => {
    const result = parseStateSpecs(singleMachine(), FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.events[0]?.otherwiseForbidden).toBeUndefined();
  });

  it('initial が states に無ければ機械を構築しない', () => {
    const result = parseStateSpecs(singleMachine({ initial: 'nowhere' }), FILE);

    expect(result.value).toEqual([]);
    expectWellFormed(result.findings);
    const finding = findByMessage(result.findings, 'initial "nowhere" が states にありません');
    expect(finding.location.pointer).toBe('initial');
    expect(finding.counterexample).toEqual({ initial: 'nowhere', states: 'draft, submitted' });
  });

  it('final に states に無い状態が混ざればその要素を落として指摘する', () => {
    const result = parseStateSpecs(singleMachine({ final: ['submitted', 'archived'] }), FILE);

    expect(result.value?.[0]?.final).toEqual(['submitted']);
    expect(findByMessage(result.findings, 'final の "archived" が states にありません').location.pointer).toBe(
      'final.archived',
    );
  });

  it('final は空リストなら通し、欠落なら指摘する', () => {
    expect(parseStateSpecs(singleMachine({ final: [] }), FILE).findings).toHaveLength(0);

    const missing = parseStateSpecs(singleMachine({ final: undefined }), FILE);
    expect(missing.value).toEqual([]);
    expect(findByMessage(missing.findings, 'final がありません')).toBeDefined();
  });

  it('by が空ならエラーにし、そのイベントを落とす', () => {
    const result = parseStateSpecs(singleMachine({ events: [{ ...MINIMAL_EVENT, by: [] }] }), FILE);

    expect(result.value?.[0]?.events).toEqual([]);
    expect(findByMessage(result.findings, 'by が空です').location.pointer).toBe('events[0].by');
  });

  it('from が空ならエラーにする', () => {
    const result = parseStateSpecs(singleMachine({ events: [{ ...MINIMAL_EVENT, from: [] }] }), FILE);

    expect(findByMessage(result.findings, 'from が空です')).toBeDefined();
  });

  it('events の欠落・to の欠落を指摘する', () => {
    const noEvents = parseStateSpecs(singleMachine({ events: undefined }), FILE);
    expect(noEvents.value?.[0]?.events).toEqual([]);
    expect(findByMessage(noEvents.findings, 'events がありません')).toBeDefined();

    const noTo = parseStateSpecs(
      singleMachine({ events: [{ id: 'submit', from: ['draft'], by: ['performer'] }] }),
      FILE,
    );
    expect(findByMessage(noTo.findings, 'to がありません').location.pointer).toBe('events[0].to');
  });

  it('states が無い・空なら機械を構築しない', () => {
    expect(parseStateSpecs(singleMachine({ states: undefined }), FILE).value).toEqual([]);

    const empty = parseStateSpecs(singleMachine({ states: [] }), FILE);
    expect(empty.value).toEqual([]);
    expect(findByMessage(empty.findings, 'states に状態が 1 つもありません')).toBeDefined();
  });

  it('別綴りだった machine: は state_machine に書き直す error で名指しする', () => {
    const { state_machine: _removed, ...rest } = singleMachine();
    const result = parseStateSpecs({ ...rest, machine: 'entry' }, FILE);

    const hit = findByMessage(result.findings, 'machine: は書けません');
    expect(hit.severity).toBe('error');
    expect(hit.suggestion).toContain('state_machine: に書き直す');
    expect(hit.location.pointer).toBe('machine');
  });

  it('state_machine も machines も無ければ指摘する', () => {
    const result = parseStateSpecs({ doc_type: 'state_spec', states: [{ id: 'draft' }] }, FILE);

    expect(result.value).toEqual([]);
    expect(findByMessage(result.findings, 'state_machine がありません')).toBeDefined();
  });
});

describe('parseStateSpecs（machines: の複数機械）', () => {
  const multi = {
    doc_type: 'state_spec',
    machines: [
      {
        state_machine: 'workshop',
        states: [{ id: 'planning' }, { id: 'accepting' }],
        initial: 'planning',
        final: [],
        events: [{ id: 'open', from: ['planning'], to: 'accepting', by: ['organizer'] }],
      },
      {
        state_machine: 'workshop_publish',
        states: [{ id: 'hidden' }, { id: 'listed' }],
        initial: 'hidden',
        final: [],
        events: [{ id: 'list', from: ['hidden'], to: 'listed', by: ['organizer'] }],
      },
    ],
  };

  it('直交する状態機械を 2 つとも読む', () => {
    const result = parseStateSpecs(multi, FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.map((machine) => machine.machine)).toEqual(['workshop', 'workshop_publish']);
    expect(result.value?.[1]?.location.pointer).toBe('machines[1].state_machine');
    expect(result.value?.[1]?.events[0]?.location.pointer).toBe('machines[1].events.list');
  });

  it('要素側の違反も machines[i] 付きの位置で指摘する', () => {
    const broken = {
      doc_type: 'state_spec',
      machines: [{ state_machine: 'workshop', states: [{ id: 'planning' }], initial: 'gone', final: [] }],
    };
    const result = parseStateSpecs(broken, FILE);

    expect(result.value).toEqual([]);
    expect(findByMessage(result.findings, 'initial "gone" が states にありません').location.pointer).toBe(
      'machines[0].initial',
    );
  });

  it('state_machine と machines の併記は指摘したうえで machines を採用する', () => {
    const result = parseStateSpecs({ ...singleMachine(), machines: multi.machines }, FILE);

    expect(result.value?.map((machine) => machine.machine)).toEqual(['workshop', 'workshop_publish']);
    expect(findByMessage(result.findings, 'state_machine と machines は併記できません')).toBeDefined();
  });

  it('machines がリストでなければ何も構築しない', () => {
    const result = parseStateSpecs({ doc_type: 'state_spec', machines: {} }, FILE);

    expect(result.value).toEqual([]);
    expect(findByMessage(result.findings, 'machines はリストで書きます')).toBeDefined();
  });
});

describe('parseStateSpecs（effects[].snapshot = C-29 / ADR-0008）', () => {
  const SNAPSHOT = {
    on: 'submit',
    do: ['snapshot_public_entry'],
    snapshot: {
      to: 'public_entry',
      fields: [
        { from: 'entry.title', to: 'title' },
        { from: 'now', to: 'published_at' },
      ],
    },
  };

  it('写像先と列の対応表を読む', () => {
    const result = parseStateSpecs(singleMachine({ effects: [SNAPSHOT] }), FILE);

    expect(result.findings).toHaveLength(0);
    const snapshot = result.value?.[0]?.effects[0]?.snapshot;
    expect(snapshot?.to).toBe('public_entry');
    expect(snapshot?.fields.map((field) => `${field.from}->${field.to}`)).toEqual([
      'entry.title->title',
      'now->published_at',
    ]);
    expect(snapshot?.location.pointer).toBe('effects[0].snapshot');
  });

  // 点検 12 回目 A12-2: 写像の行の copy_accept の形は閉じる。
  it('copy_accept を約束 × 相手 × 読み手の単位で読む', () => {
    const accept = [{ on: 'hidden', role: 'member', reader: 'guest', reason: '理由 1' }, { on: 'personal', reason: '理由 2' }];
    const result = parseStateSpecs(singleMachine({ effects: [{ ...SNAPSHOT, snapshot: { to: 'public_entry', fields: [{ from: 'entry.title', to: 'title', copy_accept: accept }] } }] }), FILE);
    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.effects[0]?.snapshot?.fields[0]?.accept).toMatchObject(accept);
  });

  it.each([
    { name: '知らないキー', row: { copy_accept: [{ on: 'personal', reason: 'r', extra: 1 }] }, message: 'extra' },
    { name: '閉じた集合の外の約束', row: { copy_accept: [{ on: 'public', reason: 'r' }] }, message: '"public" は書けません' },
    { name: 'hidden に相手が無い', row: { copy_accept: [{ on: 'hidden', reader: 'guest', reason: 'r' }] }, message: 'role と読み手の reader が要ります' },
    { name: 'hidden に読み手が無い(点検 13 回目 A13-4)', row: { copy_accept: [{ on: 'hidden', role: 'member', reason: 'r' }] }, message: 'role と読み手の reader が要ります' },
    { name: 'personal に相手がある', row: { copy_accept: [{ on: 'personal', role: 'member', reason: 'r' }] }, message: 'role と reader は書けません' },
    { name: 'personal に読み手がある', row: { copy_accept: [{ on: 'personal', reader: 'guest', reason: 'r' }] }, message: 'role と reader は書けません' },
    { name: '空白の理由', row: { copy_accept: [{ on: 'personal', reason: '  ' }] }, message: 'reason が空です' },
    { name: '理由が無い', row: { copy_accept: [{ on: 'personal' }] }, message: 'reason がありません' },
    { name: '写像の行の綴り違い', row: { copy_accepts: [] }, message: 'copy_accepts' },
  ])('読めない形は載せずに違反にする: $name', ({ row, message }) => {
    const result = parseStateSpecs(singleMachine({ effects: [{ ...SNAPSHOT, snapshot: { to: 'public_entry', fields: [{ from: 'entry.title', to: 'title', ...row }] } }] }), FILE);
    expect(result.findings.some((finding) => finding.message.includes(message)), result.findings.map((finding) => finding.message).join('\n')).toBe(true);
  });

  it('snapshot が無い effects は snapshot キーを持たない', () => {
    const result = parseStateSpecs(
      singleMachine({ effects: [{ on: 'submit', do: ['notify_discord_organizer'] }] }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.effects[0]).not.toHaveProperty('snapshot');
  });

  it('同じ on を 2 回書いてよい（1 つの遷移が別々の写しを 2 つ作る）', () => {
    const result = parseStateSpecs(
      singleMachine({
        effects: [SNAPSHOT, { ...SNAPSHOT, do: ['snapshot_public_piece'], snapshot: { ...SNAPSHOT.snapshot, to: 'public_piece' } }],
      }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.effects.map((e) => e.snapshot?.to)).toEqual(['public_entry', 'public_piece']);
  });

  it('snapshot がマッピングでなければ指摘して読み飛ばす', () => {
    const result = parseStateSpecs(
      singleMachine({ effects: [{ on: 'submit', do: ['x'], snapshot: ['bad'] }] }),
      FILE,
    );

    expect(findByMessage(result.findings, 'snapshot はマッピングで書きます')).toBeDefined();
    expect(result.value?.[0]?.effects[0]).not.toHaveProperty('snapshot');
  });

  it('to が無ければ指摘する', () => {
    const result = parseStateSpecs(
      singleMachine({ effects: [{ on: 'submit', do: ['x'], snapshot: { fields: [] } }] }),
      FILE,
    );

    expect(findByMessage(result.findings, 'to がありません')).toBeDefined();
  });

  it('fields の要素に from / to が揃っていなければ指摘して読み飛ばす', () => {
    const result = parseStateSpecs(
      singleMachine({
        effects: [{ on: 'submit', do: ['x'], snapshot: { to: 'public_entry', fields: [{ to: 'title' }] } }],
      }),
      FILE,
    );

    expect(findByMessage(result.findings, 'from がありません')).toBeDefined();
    expect(result.value?.[0]?.effects[0]?.snapshot?.fields).toEqual([]);
  });
});

const SETTLES_VOCABULARY = { vocabulary: { settles: [{ id: 'fees', label: '料金' }] } };

describe('parseStateSpecs（states[].tone / states[].settles）', () => {
  it('tone と settles を読む（書かれた状態だけキーを持つ）', () => {
    const result = parseStateSpecs(
      singleMachine({
        ...SETTLES_VOCABULARY,
        states: [{ id: 'draft' }, { id: 'submitted', tone: 'negative' }, { id: 'confirmed', settles: ['fees'] }],
        final: ['submitted', 'confirmed'],
      }),
      FILE,
    );

    expect(result.findings).toEqual([]);
    expect(result.value?.[0]?.stateTone).toEqual({ submitted: 'negative' });
    expect(result.value?.[0]?.stateSettles).toEqual({ confirmed: ['fees'] });
    expect(result.value?.[0]?.settlesVocabulary).toEqual({ fees: '料金' });
  });

  it('tone / settles / vocabulary を省略した状態はキーを持たない', () => {
    const result = parseStateSpecs(singleMachine(), FILE);

    expect(result.value?.[0]?.stateTone).toEqual({});
    expect(result.value?.[0]?.stateSettles).toEqual({});
    expect(result.value?.[0]?.settlesVocabulary).toEqual({});
  });

  it('tone が値域の外なら違反になり、そのキーは持たない', () => {
    const result = parseStateSpecs(
      singleMachine({ states: [{ id: 'draft' }, { id: 'submitted', tone: 'urgent' }] }),
      FILE,
    );

    expect(findByMessage(result.findings, 'tone "urgent" は値域にありません')).toBeDefined();
    expect(result.value?.[0]?.stateTone).toEqual({});
  });

  it('settles の要素が vocabulary.settles に無ければ違反になり、その要素だけ除く', () => {
    const result = parseStateSpecs(
      singleMachine({
        ...SETTLES_VOCABULARY,
        states: [{ id: 'draft' }, { id: 'submitted', settles: ['fees', 'seats'] }],
      }),
      FILE,
    );

    expect(findByMessage(result.findings, 'settles の "seats" は vocabulary.settles にありません')).toBeDefined();
    expect(result.value?.[0]?.stateSettles).toEqual({ submitted: ['fees'] });
  });

  it('vocabulary.settles を宣言せずに settles を書くと、すべての要素が違反になる', () => {
    const result = parseStateSpecs(
      singleMachine({ states: [{ id: 'draft' }, { id: 'submitted', settles: ['fees'] }] }),
      FILE,
    );

    expect(findByMessage(result.findings, 'settles の "fees" は vocabulary.settles にありません')).toBeDefined();
    expect(result.value?.[0]?.stateSettles).toEqual({});
  });
});

describe('parseStateSpecs（summary = 節の要約・段の場面）', () => {
  it('単一機械のトップレベル summary と states[].summary を読む(書かれた状態だけキーを持つ)', () => {
    const result = parseStateSpecs(
      singleMachine({
        summary: 'この機械は申し込みの進み具合を管理します。',
        states: [{ id: 'draft', summary: 'メンバーが書いている途中の段です。' }, { id: 'submitted' }],
      }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.summary).toBe('この機械は申し込みの進み具合を管理します。');
    expect(result.value?.[0]?.stateSummaries).toEqual({ draft: 'メンバーが書いている途中の段です。' });
  });

  it('machines: では機械ごとの summary と状態ごとの summary を読む', () => {
    const result = parseStateSpecs(
      {
        doc_type: 'state_spec',
        machines: [
          { ...singleMachine({ summary: '1 本目です。', states: [{ id: 'draft', summary: '下書きです。' }, { id: 'submitted' }] }) },
          { ...singleMachine({ state_machine: 'second' }) },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.[0]?.summary).toBe('1 本目です。');
    expect(result.value?.[0]?.stateSummaries).toEqual({ draft: '下書きです。' });
    expect(result.value?.[1]?.summary).toBeUndefined();
    expect(result.value?.[1]?.stateSummaries).toEqual({});
  });

  it('空の summary は指摘して載せない', () => {
    const result = parseStateSpecs(
      singleMachine({ summary: '', states: [{ id: 'draft', summary: '   ' }, { id: 'submitted' }] }),
      FILE,
    );

    expect(result.findings.filter((finding) => finding.message.includes('summary が空です')).map((finding) => finding.location.pointer).sort()).toEqual([
      'states[0].summary',
      'summary',
    ]);
    expect(result.value?.[0]?.summary).toBeUndefined();
    expect(result.value?.[0]?.stateSummaries).toEqual({});
  });
});
