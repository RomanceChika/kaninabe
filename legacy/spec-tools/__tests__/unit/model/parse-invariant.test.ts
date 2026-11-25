import { describe, expect, it } from 'vitest';
import { parseInvariantSpec } from '../../../lib/model/parse-invariant.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FILE = 'docs/specs/domain/entry/invariants.md';

function invariant(formal: unknown, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    doc_type: 'invariant_spec',
    invariants: [
      {
        id: 'INV-ENTRY-001',
        statement: '同一発表者は同一催しにアクティブなエントリーを 1 つしか持てない',
        entities: ['entry'],
        formal,
        enforced_by: [{ kind: 'db_constraint', ref: 'entries_active_unique' }],
        ...overrides,
      },
    ],
  };
}

describe('parseInvariantSpec の formal_outside(形式定義を書かない理由。点検 22 回目 C22-3)', () => {
  it('形式定義の無い不変条件の理由を読む', () => {
    const result = parseInvariantSpec(invariant(undefined, { formal_outside: '件数の下限で、cardinality は上限だけを言う' }), FILE);
    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]?.formalOutside).toBe('件数の下限で、cardinality は上限だけを言う');
  });

  it('理由が空・formal と同時ならエラー', () => {
    expect(findByMessage(parseInvariantSpec(invariant(undefined, { formal_outside: '  ' }), FILE).findings, 'formal_outside の理由が空です')).toBeDefined();
    const both = parseInvariantSpec(invariant({ type: 'uniqueness', keys: ['a'] }, { formal_outside: 'x' }), FILE);
    expect(findByMessage(both.findings, 'formal と formal_outside は同時に書けません')).toBeDefined();
    expect(both.value?.invariants[0]?.formalOutside).toBeUndefined();
  });

  it('書かなければ欄が無い', () => {
    expect(parseInvariantSpec(invariant(undefined), FILE).value?.invariants[0]).not.toHaveProperty('formalOutside');
  });
});

describe('parseInvariantSpec', () => {
  it('exclusion を range と where 付きで読む', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'exclusion', keys: ['room_id'], range: ['starts_at', 'ends_at'], where: 'state != cancelled' }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]).toMatchObject({
      formal: {
        kind: 'exclusion',
        keys: ['room_id'],
        range: ['starts_at', 'ends_at'],
        where: 'state != cancelled',
      },
    });
  });

  it('exclusion の range が 2 つでなければエラー(端の扱いは宣言では選べない)', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'exclusion', keys: ['room_id'], range: ['starts_at', 'ends_at', 'closed'] }),
      FILE,
    );

    expect(findByMessage(result.findings, '2 つで書きます')).toBeDefined();
    expect(result.value?.invariants).toHaveLength(0);
  });

  it('exclusion の range の開始と終了が同じフィールドならエラー', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'exclusion', keys: ['room_id'], range: ['starts_at', 'starts_at'] }),
      FILE,
    );

    expect(findByMessage(result.findings, '開始と終了が同じフィールド')).toBeDefined();
  });

  it('uniqueness を where 付きで読む', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'uniqueness', keys: ['workshop_id', 'performer_id'], where: 'state != withdrawn' }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]).toMatchObject({
      id: 'INV-ENTRY-001',
      entities: ['entry'],
      formal: {
        kind: 'uniqueness',
        keys: ['workshop_id', 'performer_id'],
        where: 'state != withdrawn',
      },
      enforcedBy: [{ kind: 'db_constraint', ref: 'entries_active_unique' }],
      location: { file: FILE, pointer: 'invariants.INV-ENTRY-001' },
    });
  });

  it('check は expr（1 レコード内の行内制約）を読む', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'check', expr: 'workshop.entry_deadline < workshop.starts_at' }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]?.formal).toEqual({
      kind: 'check',
      expr: 'workshop.entry_deadline < workshop.starts_at',
    });
  });

  it('check の expr 欠落・型不正を指摘してその不変条件を落とす', () => {
    const missing = parseInvariantSpec(invariant({ type: 'check' }), FILE);
    expect(missing.value?.invariants).toEqual([]);
    expectWellFormed(missing.findings);
    const finding = findByMessage(missing.findings, 'expr がありません');
    expect(finding.location.pointer).toBe('invariants[0].formal.expr');
    expect(finding.suggestion).toContain('ガード式の文字列で expr に書く');

    const wrong = parseInvariantSpec(invariant({ type: 'check', expr: ['a < b'] }), FILE);
    expect(wrong.value?.invariants).toEqual([]);
    expect(findByMessage(wrong.findings, 'expr は文字列で書きます')).toBeDefined();
  });

  it('cardinality の max は数値でも親フィールド参照でも読む', () => {
    const numeric = parseInvariantSpec(
      invariant({ type: 'cardinality', keys: ['event_id', 'gender'], max: 5 }),
      FILE,
    );
    expect(numeric.value?.invariants[0]?.formal).toEqual({
      kind: 'cardinality',
      keys: ['event_id', 'gender'],
      max: 5,
    });

    const reference = parseInvariantSpec(
      invariant({ type: 'cardinality', keys: ['workshop_id'], max: 'workshop.capacity' }),
      FILE,
    );
    expect(reference.value?.invariants[0]?.formal).toMatchObject({ max: 'workshop.capacity' });
    expect(reference.findings).toHaveLength(0);
  });

  it('cardinality の max 欠落・型不正を指摘する', () => {
    const missing = parseInvariantSpec(invariant({ type: 'cardinality', keys: ['workshop_id'] }), FILE);
    expect(missing.value?.invariants).toEqual([]);
    expect(findByMessage(missing.findings, 'max がありません').location.pointer).toBe(
      'invariants[0].formal.max',
    );

    const wrong = parseInvariantSpec(
      invariant({ type: 'cardinality', keys: ['workshop_id'], max: [1] }),
      FILE,
    );
    expect(findByMessage(wrong.findings, 'max は数値または親フィールド参照の文字列で書きます')).toBeDefined();
  });

  it('state_dependency は if と then を読む', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'state_dependency', if: 'workshop.state == program_published', then: 'entry.state in [accepted]' }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]?.formal).toEqual({
      kind: 'state_dependency',
      if: 'workshop.state == program_published',
      then: 'entry.state in [accepted]',
    });
  });

  it('前提を when で書いていたら if に直すよう指摘する', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'state_dependency', when: 'workshop.state == program_published', then: 'x == y' }),
      FILE,
    );

    expect(result.value?.invariants).toEqual([]);
    const finding = findByMessage(result.findings, 'state_dependency の前提は when ではなく if に書きます');
    expect(finding.location.pointer).toBe('invariants[0].formal.when');
    expect(finding.suggestion).toContain('if に書く');
  });

  it('state_dependency の前提・帰結の欠落を指摘する', () => {
    const noIf = parseInvariantSpec(invariant({ type: 'state_dependency', then: 'x == y' }), FILE);
    expect(noIf.value?.invariants).toEqual([]);
    expect(findByMessage(noIf.findings, 'if がありません')).toBeDefined();

    const noThen = parseInvariantSpec(invariant({ type: 'state_dependency', if: 'x == y' }), FILE);
    expect(findByMessage(noThen.findings, 'then がありません')).toBeDefined();
  });

  it('formal.type が値域の外なら弾く', () => {
    const result = parseInvariantSpec(invariant({ type: 'aggregate_limit', keys: ['a'] }), FILE);

    expect(result.value?.invariants).toEqual([]);
    const finding = findByMessage(result.findings, 'formal.type "aggregate_limit" は使えません');
    expect(finding.location.pointer).toBe('invariants[0].formal.type');
    expect(finding.counterexample).toEqual({ type: 'aggregate_limit' });
  });

  it('formal は任意（集計を含む制約は DSL 外）。無くてもモデルに載せる', () => {
    const result = parseInvariantSpec(
      invariant(undefined, {
        enforced_by: [{ kind: 'application', ref: 'assert_total_duration' }],
      }),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants).toHaveLength(1);
    expect(result.value?.invariants[0]?.formal).toBeUndefined();
    expect(result.value?.invariants[0]?.enforcedBy[0]?.kind).toBe('application');
  });

  it('formal がマッピングでなければ指摘してその不変条件を落とす', () => {
    const result = parseInvariantSpec(invariant('uniqueness'), FILE);

    expect(result.value?.invariants).toEqual([]);
    expectWellFormed(result.findings);
    expect(findByMessage(result.findings, 'formal はマッピングで書きます')).toBeDefined();
  });

  it('enforced_by の欠落・kind の値域の外を指摘する', () => {
    const missing = parseInvariantSpec(
      invariant({ type: 'uniqueness', keys: ['a'] }, { enforced_by: undefined }),
      FILE,
    );
    expect(missing.value?.invariants[0]?.enforcedBy).toEqual([]);
    expect(findByMessage(missing.findings, 'enforced_by がありません')).toBeDefined();

    const wrongKind = parseInvariantSpec(
      invariant({ type: 'uniqueness', keys: ['a'] }, { enforced_by: [{ kind: 'rls', ref: 'x' }] }),
      FILE,
    );
    expect(findByMessage(wrongKind.findings, 'enforced_by.kind "rls" は使えません')).toBeDefined();
  });

  it('id / statement / entities の欠落を指摘し、その不変条件を落とす', () => {
    const result = parseInvariantSpec(
      { doc_type: 'invariant_spec', invariants: [{ formal: { type: 'uniqueness', keys: ['a'] } }] },
      FILE,
    );

    expect(result.value?.invariants).toEqual([]);
    expect(findByMessage(result.findings, 'id がありません')).toBeDefined();
    expect(findByMessage(result.findings, 'statement がありません')).toBeDefined();
    expect(findByMessage(result.findings, 'entities がありません')).toBeDefined();
  });

  it('invariants が無ければ InvariantSpec を構築できない', () => {
    const result = parseInvariantSpec({ doc_type: 'invariant_spec' }, FILE);

    expect(result.value).toBeNull();
    expect(findByMessage(result.findings, 'invariants がありません')).toBeDefined();
  });

  it('involves を任意の集約名リストとして読む', () => {
    const result = parseInvariantSpec(
      invariant(
        { type: 'uniqueness', keys: ['workshop_id'] },
        { involves: ['piece', 'entry_participant'] },
      ),
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]?.involves).toEqual(['piece', 'entry_participant']);
  });

  it('境界: involves を書かなければ undefined のまま(V10 の接地対象にならない)', () => {
    const result = parseInvariantSpec(invariant({ type: 'uniqueness', keys: ['workshop_id'] }), FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]?.involves).toBeUndefined();
  });

  it('invariants の要素に書けるキーは閉じている(綴り違いは V1 違反)', () => {
    const result = parseInvariantSpec(
      invariant({ type: 'uniqueness', keys: ['workshop_id'] }, { involes: ['piece'] }),
      FILE,
    );

    const finding = findByMessage(result.findings, 'invariants の要素 に involes は書けません');
    expect(finding.location.pointer).toBe('invariants[0].involes');
    expect(finding.suggestion).toContain('involves');
  });
});

describe('parseInvariantSpec — formal.global_key(V26 の受け入れ。点検 12 回目 A12-3)', () => {
  const ACCEPT = { keys: ['code'], reason: '公開の識別子' };

  it.each([
    { formal: { type: 'uniqueness', keys: ['code'], global_key: ACCEPT } },
    { formal: { type: 'cardinality', keys: ['code'], max: 3, global_key: ACCEPT } },
    { formal: { type: 'exclusion', keys: ['code'], range: ['a', 'b'], global_key: ACCEPT } },
  ])('$formal.type は鍵の列と理由を読む', ({ formal }) => {
    const result = parseInvariantSpec(invariant(formal), FILE);
    expect(result.findings).toHaveLength(0);
    expect(result.value?.invariants[0]?.formal).toMatchObject({ globalKey: { keys: ['code'], reason: '公開の識別子' } });
  });

  it('書かなければ欄を持たない', () => {
    expect(parseInvariantSpec(invariant({ type: 'uniqueness', keys: ['code'] }), FILE).value?.invariants[0]?.formal).not.toHaveProperty('globalKey');
  });

  it.each([
    { name: '理由だけの文字列(点検 13 回目 A13-4: 鍵を名指さない)', value: '公開の識別子', message: 'global_key の形が違います' },
    { name: '空白の理由', value: { keys: ['code'], reason: '  ' }, message: 'reason が空です' },
    { name: '鍵が無い', value: { reason: '理由' }, message: 'keys' },
    { name: '鍵が空', value: { keys: [], reason: '理由' }, message: 'keys' },
    { name: '知らないキー', value: { keys: ['code'], reason: '理由', extra: 1 }, message: 'extra' },
    { name: '列', value: ['code'], message: 'global_key の形が違います' },
  ])('読めない形は載せず違反にする: $name', ({ value, message }) => {
    const result = parseInvariantSpec(invariant({ type: 'uniqueness', keys: ['code'], global_key: value }), FILE);
    expect(result.findings.some((finding) => finding.message.includes(message)), result.findings.map((finding) => finding.message).join('\n')).toBe(true);
    if (message.startsWith('global_key') || message.startsWith('reason')) expect(result.value?.invariants[0]?.formal).not.toHaveProperty('globalKey');
  });
});
