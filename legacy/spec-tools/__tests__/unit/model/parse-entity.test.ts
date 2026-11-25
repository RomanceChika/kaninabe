import { describe, expect, it } from 'vitest';
import { parseEntitySpec, parseFieldType } from '../../../lib/model/parse-entity.js';
import { parseFrontmatter, SpecReporter } from '../../../lib/model/parse-common.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FILE = 'docs/specs/domain/entry/entity.md';

function entityFrom(yaml: string) {
  const reporter = new SpecReporter(FILE);
  const data = parseFrontmatter(`---\n${yaml}---\n\n# 本文\n`, reporter);
  expect(reporter.findings()).toHaveLength(0);
  return parseEntitySpec(data, FILE);
}

describe('parseFieldType', () => {
  it('パラメータを持たない型の値域を受け付ける', () => {
    const reporter = new SpecReporter(FILE);
    for (const kind of ['uuid', 'string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime']) {
      expect(parseFieldType(kind, 'fields[0].type', reporter)).toEqual({ kind });
    }
    expect(reporter.findings()).toHaveLength(0);
  });

  it('enum / ref / state はパラメータごと読む', () => {
    const reporter = new SpecReporter(FILE);
    expect(parseFieldType('enum([draft, submitted])', 'p', reporter)).toEqual({
      kind: 'enum',
      values: ['draft', 'submitted'],
    });
    expect(parseFieldType('ref( workshop )', 'p', reporter)).toEqual({ kind: 'ref', entity: 'workshop' });
    expect(parseFieldType('state(entry)', 'p', reporter)).toEqual({ kind: 'state', machine: 'entry' });
    expect(reporter.findings()).toHaveLength(0);
  });

  it('値域の外の型は V1 違反として弾く', () => {
    const reporter = new SpecReporter(FILE);
    expect(parseFieldType('money', 'fields[1].type', reporter)).toBeNull();

    const finding = findByMessage(reporter.findings(), '型 "money" は使えません');
    expect(finding.location.pointer).toBe('fields[1].type');
    expect(finding.suggestion).toContain('enum([...])');
    expect(finding.counterexample).toEqual({ type: 'money' });
  });

  it('値の無い enum は弾く', () => {
    const reporter = new SpecReporter(FILE);
    expect(parseFieldType('enum([])', 'p', reporter)).toBeNull();
    expect(findByMessage(reporter.findings(), 'enum に値がありません')).toBeDefined();
  });
});

describe('parseEntitySpec', () => {
  it('YAML から entity / context / fields と制約を読む', () => {
    const result = entityFrom(
      [
        'doc_type: entity_spec',
        'entity: entry',
        'context:',
        '  workshop: entry.workshop_id',
        'fields:',
        '  - name: id',
        '    type: uuid',
        '    auto: true',
        '    personal: false',
        '  - name: title',
        '    type: string',
        '    description: 演目名',
        '    max_length: 50',
        '    required: true',
        '    personal: false',
        '  - name: visibility',
        '    type: enum([private, public])',
        '    personal: false',
        '  - name: state',
        '    type: state(entry)',
        '    personal: false',
        '',
      ].join('\n'),
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.entity).toBe('entry');
    expect(result.value?.context).toEqual({ workshop: 'entry.workshop_id' });
    expect(result.value?.fields).toHaveLength(4);
    expect(result.value?.fields[0]).toEqual({
      name: 'id',
      type: { kind: 'uuid' },
      required: false,
      auto: true,
      personal: false,
      session: false,
      location: { file: FILE, pointer: 'fields.id' },
    });
    expect(result.value?.fields[1]).toMatchObject({
      required: true,
      auto: false,
      personal: false,
      maxLength: 50,
      description: '演目名',
    });
    expect(result.value?.fields[2]?.type).toEqual({ kind: 'enum', values: ['private', 'public'] });
  });

  it('table は任意の上書き宣言。無ければモデルに載せない(規則で導かせる)', () => {
    const withTable = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'person',
        table: 'people',
        fields: [{ name: 'id', type: 'uuid', personal: false }],
      },
      FILE,
    );
    const without = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'entry', fields: [{ name: 'id', type: 'uuid', personal: false }] },
      FILE,
    );

    expect(withTable.findings).toHaveLength(0);
    expect(withTable.value?.table).toBe('people');
    expect(without.value?.table).toBeUndefined();
  });

  it('description は任意。無ければモデルに載せず、文字列でなければ指摘する', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [
          { name: 'id', type: 'uuid', personal: false },
          { name: 'note', type: 'text', description: 42, personal: false },
        ],
      },
      FILE,
    );

    expect(result.value?.fields[0]?.description).toBeUndefined();
    expect(result.value?.fields[1]?.description).toBeUndefined();
    expect(findByMessage(result.findings, 'description は文字列で書きます').location.pointer).toBe(
      'fields[1].description',
    );
  });

  it('label は任意の表示名。読めたら載せ、無ければ載せない', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [
          {
            name: 'title',
            type: 'string',
            label: '演目名',
            description: '演目名（プログラム表記）',
            personal: false,
          },
          { name: 'note', type: 'text', personal: false },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.fields[0]?.label).toBe('演目名');
    expect(result.value?.fields[1]?.label).toBeUndefined();
  });

  it('空の label と重複する label は指摘する', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [
          { name: 'title', type: 'string', label: '演目名', personal: false },
          { name: 'alias', type: 'string', label: '演目名', personal: false },
          { name: 'note', type: 'text', label: '  ', personal: false },
        ],
      },
      FILE,
    );

    expect(findByMessage(result.findings, 'label "演目名" が title と alias で重複しています')).toBeDefined();
    expect(findByMessage(result.findings, 'label が空です').location.pointer).toBe('fields[2].label');
    // 空の label はモデルに載せない(生成物に空文字の表示名を流さない)。
    expect(result.value?.fields[2]?.label).toBeUndefined();
  });

  it('トップレベルの label は集約の表示名。読めたら載せ、無ければ載せない', () => {
    const withLabel = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'workshop',
        label: '催し',
        fields: [{ name: 'id', type: 'uuid', personal: false }],
      },
      FILE,
    );
    const without = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'workshop', fields: [{ name: 'id', type: 'uuid', personal: false }] },
      FILE,
    );

    expect(withLabel.findings).toHaveLength(0);
    expect(withLabel.value?.label).toBe('催し');
    expect(without.value?.label).toBeUndefined();
  });

  it('空のトップレベル label は指摘し、モデルには載せない', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'workshop',
        label: '   ',
        fields: [{ name: 'id', type: 'uuid', personal: false }],
      },
      FILE,
    );

    expect(findByMessage(result.findings, 'label が空です').location.pointer).toBe('label');
    expect(result.value?.label).toBeUndefined();
  });

  it('トップレベルの summary は章頭の 1 文。読めたら載せ、無ければ載せない(受け入れの検査はキーを許す)', () => {
    const withSummary = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'workshop',
        summary: '世話役が開き、メンバーが申し込む勉強会の単位です。',
        fields: [{ name: 'id', type: 'uuid', personal: false }],
      },
      FILE,
    );
    const without = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'workshop', fields: [{ name: 'id', type: 'uuid', personal: false }] },
      FILE,
    );

    expect(withSummary.findings).toHaveLength(0);
    expect(withSummary.value?.summary).toBe('世話役が開き、メンバーが申し込む勉強会の単位です。');
    expect(without.value?.summary).toBeUndefined();
  });

  it('空・文字列でない summary は指摘し、モデルには載せない', () => {
    const empty = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'workshop', summary: '  ', fields: [{ name: 'id', type: 'uuid', personal: false }] },
      FILE,
    );
    const notText = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'workshop', summary: 3, fields: [{ name: 'id', type: 'uuid', personal: false }] },
      FILE,
    );

    expect(findByMessage(empty.findings, 'summary が空です').location.pointer).toBe('summary');
    expect(empty.value?.summary).toBeUndefined();
    expect(notText.findings.some((finding) => finding.location.pointer === 'summary')).toBe(true);
    expect(notText.value?.summary).toBeUndefined();
  });

  it('display_field は行の名前の欄。読めたら載せ、無ければ載せない・空は指摘する', () => {
    const base = { doc_type: 'entity_spec', entity: 'venue', fields: [{ name: 'name', type: 'string', personal: false }] };
    const withName = parseEntitySpec({ ...base, display_field: 'name' }, FILE);
    const without = parseEntitySpec(base, FILE);
    const empty = parseEntitySpec({ ...base, display_field: '  ' }, FILE);

    expect(withName.findings).toHaveLength(0);
    expect(withName.value?.displayField).toBe('name');
    expect(without.value?.displayField).toBeUndefined();
    expect(findByMessage(empty.findings, 'display_field が空です').location.pointer).toBe('display_field');
    expect(empty.value?.displayField).toBeUndefined();
  });

  it('トップレベルの知らないキーをエラーにする', () => {
    const result = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'entry', tabel: 'entries', fields: [] },
      FILE,
    );

    expectWellFormed(result.findings);
    const finding = findByMessage(result.findings, 'entity_spec に tabel は書けません');
    expect(finding.location.pointer).toBe('tabel');
    expect(finding.counterexample?.key).toBe('tabel');
  });

  it('doc_type によらず書ける共通キー（norms / decisions）は通す', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        norms: ['PRIN-0001'],
        decisions: ['ADR-0003'],
        fields: [{ name: 'id', type: 'uuid', personal: false }],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
  });

  it('フィールドの知らないキー（綴り違い）をエラーにする(穴の再現: max_lenght)', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [{ name: 'title', type: 'string', max_lenght: 100, personal: false }],
      },
      FILE,
    );

    const finding = findByMessage(result.findings, 'fields の要素 に max_lenght は書けません');
    expect(finding.location.pointer).toBe('fields[0].max_lenght');
    expect(finding.counterexample?.key).toBe('max_lenght');
    // 綴り違いで無視されていた制約は、指摘のうえでモデルに載らない。
    expect(result.value?.fields[0]?.maxLength).toBeUndefined();
  });

  it('フィールドの既知キーは全部通る', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [
          {
            name: 'title',
            type: 'string',
            required: true,
            label: '演目名',
            description: '演目名（プログラム表記）',
            auto: false,
            max_length: 50,
            min: 1,
            max: 30,
            pattern: '^[a-z]+$',
            personal: true,
            personal_placeholder: '(消去済み)',
          },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
  });

  it('entity が無ければ EntitySpec を構築できない', () => {
    const result = parseEntitySpec({ doc_type: 'entity_spec', fields: [] }, FILE);

    expect(result.value).toBeNull();
    expectWellFormed(result.findings);
    expect(findByMessage(result.findings, 'entity がありません')).toBeDefined();
  });

  it('fields が無ければ EntitySpec を構築できない', () => {
    const result = parseEntitySpec({ doc_type: 'entity_spec', entity: 'entry' }, FILE);

    expect(result.value).toBeNull();
    expect(findByMessage(result.findings, 'fields がありません')).toBeDefined();
  });

  it('name / type を欠くフィールドだけを読み飛ばす', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [{ type: 'uuid' }, { name: 'title' }, { name: 'note', type: 'text', personal: false }],
      },
      FILE,
    );

    expect(result.value?.fields.map((field) => field.name)).toEqual(['note']);
    expect(findByMessage(result.findings, 'name がありません').location.pointer).toBe('fields[0].name');
    expect(findByMessage(result.findings, 'type がありません').location.pointer).toBe('fields[1].type');
  });

  it('制約の型不正を指摘し、その制約だけを落とす', () => {
    const result = parseEntitySpec(
      {
        doc_type: 'entity_spec',
        entity: 'entry',
        fields: [{ name: 'title', type: 'string', max_length: '50', required: 'yes', personal: false }],
      },
      FILE,
    );

    expect(result.value?.fields[0]).toMatchObject({ name: 'title', required: false });
    expect(result.value?.fields[0]?.maxLength).toBeUndefined();
    expect(findByMessage(result.findings, 'max_length は数値で書きます')).toBeDefined();
    expect(findByMessage(result.findings, 'required は true / false で書きます')).toBeDefined();
  });

  it('context の値が文字列でなければ指摘する', () => {
    const result = parseEntitySpec(
      { doc_type: 'entity_spec', entity: 'entry', context: { workshop: 1 }, fields: [] },
      FILE,
    );

    expect(result.value?.context).toEqual({});
    expect(findByMessage(result.findings, 'context.workshop は文字列で書きます')).toBeDefined();
  });

  describe('personal / personal_placeholder', () => {
    it('personal を欠くと V1 違反(暗黙に非個人にしない)', () => {
      const result = parseEntitySpec(
        { doc_type: 'entity_spec', entity: 'entry', fields: [{ name: 'note', type: 'text' }] },
        FILE,
      );

      expect(result.value?.fields[0]).toMatchObject({ name: 'note', personal: false });
      expect(findByMessage(result.findings, 'personal がありません').location.pointer).toBe(
        'fields[0].personal',
      );
    });

    it('personal が真偽値でなければ指摘し false を既定にする', () => {
      const result = parseEntitySpec(
        { doc_type: 'entity_spec', entity: 'entry', fields: [{ name: 'note', type: 'text', personal: 'yes' }] },
        FILE,
      );

      expect(result.value?.fields[0]?.personal).toBe(false);
      expect(findByMessage(result.findings, 'personal は true / false で書きます')).toBeDefined();
    });

    it('personal: true は personal_placeholder(文字列)を必須にする', () => {
      const ok = parseEntitySpec(
        {
          doc_type: 'entity_spec',
          entity: 'entry',
          fields: [{ name: 'note', type: 'text', personal: true, personal_placeholder: '(消去済み)' }],
        },
        FILE,
      );
      const missing = parseEntitySpec(
        { doc_type: 'entity_spec', entity: 'entry', fields: [{ name: 'note', type: 'text', personal: true }] },
        FILE,
      );

      expect(ok.findings).toHaveLength(0);
      expect(ok.value?.fields[0]).toMatchObject({ personal: true, personalPlaceholder: '(消去済み)' });
      expect(missing.value?.fields[0]?.personalPlaceholder).toBeUndefined();
      expect(findByMessage(missing.findings, 'personal_placeholder がありません').location.pointer).toBe(
        'fields[0].personal_placeholder',
      );
    });

    it('personal: true の personal_placeholder は null(NOT NULL でない列)も書ける', () => {
      const result = parseEntitySpec(
        {
          doc_type: 'entity_spec',
          entity: 'entry',
          fields: [{ name: 'note', type: 'text', personal: true, personal_placeholder: null }],
        },
        FILE,
      );

      expect(result.findings).toHaveLength(0);
      expect(result.value?.fields[0]).toMatchObject({ personal: true, personalPlaceholder: null });
    });

    it('personal: true の personal_placeholder が文字列でも null でもなければ指摘する', () => {
      const result = parseEntitySpec(
        {
          doc_type: 'entity_spec',
          entity: 'entry',
          fields: [{ name: 'note', type: 'text', personal: true, personal_placeholder: 42 }],
        },
        FILE,
      );

      expect(result.value?.fields[0]?.personalPlaceholder).toBeUndefined();
      expect(
        findByMessage(result.findings, 'personal_placeholder は文字列で書きます').location.pointer,
      ).toBe('fields[0].personal_placeholder');
    });

    it('personal: false に personal_placeholder を書くと指摘する', () => {
      const result = parseEntitySpec(
        {
          doc_type: 'entity_spec',
          entity: 'entry',
          fields: [{ name: 'note', type: 'text', personal: false, personal_placeholder: '(消去済み)' }],
        },
        FILE,
      );

      expect(result.value?.fields[0]?.personalPlaceholder).toBeUndefined();
      expect(
        findByMessage(result.findings, 'personal: false のフィールドに personal_placeholder は書けません')
          .location.pointer,
      ).toBe('fields[0].personal_placeholder');
    });
  });

  describe('session', () => {
    it('省略すると既定 false になる(V1 違反にはならない)', () => {
      const result = parseEntitySpec(
        { doc_type: 'entity_spec', entity: 'member', fields: [{ name: 'note', type: 'text', personal: false }] },
        FILE,
      );

      expect(result.findings).toHaveLength(0);
      expect(result.value?.fields[0]?.session).toBe(false);
    });

    it('session: true を読める(personal との併存も可)', () => {
      const result = parseEntitySpec(
        {
          doc_type: 'entity_spec',
          entity: 'member',
          fields: [
            { name: 'display_name', type: 'string', personal: true, personal_placeholder: '(消去済み)', session: true },
          ],
        },
        FILE,
      );

      expect(result.findings).toHaveLength(0);
      expect(result.value?.fields[0]).toMatchObject({ personal: true, session: true });
    });
  });
});

describe('parseEntitySpec の format', () => {
  /** 欄 1 本の宣言を読む。 */
  function parseField(extra: readonly string[], type = 'string') {
    return entityFrom(
      ['doc_type: entity_spec', 'entity: listing', 'fields:', '  - name: ticket_url', `    type: ${type}`, ...extra.map((line) => `    ${line}`), '    personal: false', ''].join('\n'),
    );
  }

  it('format: url を読む', () => {
    const result = parseField(['max_length: 500', 'format: url']);
    expect(result.findings).toHaveLength(0);
    expect(result.value?.fields[0]).toMatchObject({ format: 'url', maxLength: 500 });
  });

  it('format を書かない欄には format のキーが現れない', () => {
    const result = parseField(['max_length: 500']);
    expect(result.value?.fields[0]).not.toHaveProperty('format');
  });

  it('語彙の外の format は弾く(増やすのは DSL の拡張)', () => {
    const result = parseField(['max_length: 500', 'format: email']);
    expectWellFormed(result.findings);
    expect(findByMessage(result.findings, 'format "email" は使えません').counterexample).toEqual({ format: 'email' });
    expect(result.value?.fields[0]).not.toHaveProperty('format');
  });

  it('string 以外の欄(text・integer)の format: url は弾く', () => {
    for (const type of ['text', 'integer']) {
      const result = parseField(['max_length: 500', 'format: url'], type);
      expectWellFormed(result.findings);
      expect(findByMessage(result.findings, 'format: url は string の欄にだけ書けます').counterexample).toEqual({ format: 'url', type });
    }
  });

  it('format: markdown は text の欄を読む', () => {
    const result = parseField(['max_length: 8000', 'format: markdown'], 'text');
    expect(result.findings).toHaveLength(0);
    expect(result.value?.fields[0]).toMatchObject({ format: 'markdown', maxLength: 8000 });
  });

  it('text 以外の欄(string・integer)の format: markdown は弾く', () => {
    for (const type of ['string', 'integer']) {
      const result = parseField(['max_length: 500', 'format: markdown'], type);
      expectWellFormed(result.findings);
      expect(findByMessage(result.findings, 'format: markdown は text の欄にだけ書けます').counterexample).toEqual({ format: 'markdown', type });
      expect(result.value?.fields[0]).not.toHaveProperty('format');
    }
  });

  it('format: markdown と pattern の併記は弾く', () => {
    const result = parseField(['max_length: 500', 'format: markdown', "pattern: '^a$'"], 'text');
    expectWellFormed(result.findings);
    expect(findByMessage(result.findings, 'format: markdown と pattern は併記できません')).toBeDefined();
  });

  it('format: markdown の max_length は 8,000 以下(天井ちょうどは通す)', () => {
    const over = parseField(['max_length: 8001', 'format: markdown'], 'text');
    expectWellFormed(over.findings);
    expect(findByMessage(over.findings, 'max_length は 8000 以下にします').location.pointer).toBe('fields[0].max_length');
    expect(parseField(['max_length: 8000', 'format: markdown'], 'text').findings).toHaveLength(0);
  });

  it('max_length が無い format: markdown は ここでは通る(上限の無い欄は R10 が止める)', () => {
    expect(parseField(['format: markdown'], 'text').findings).toHaveLength(0);
  });

  it('pattern との併記は弾く', () => {
    const result = parseField(['max_length: 500', 'format: url', "pattern: '^a$'"]);
    expectWellFormed(result.findings);
    expect(findByMessage(result.findings, 'format: url と pattern は併記できません')).toBeDefined();
  });

  it('max_length が URL の天井(2048)を超えるものは弾き、天井ちょうどは通す', () => {
    const over = parseField(['max_length: 2049', 'format: url']);
    expectWellFormed(over.findings);
    expect(findByMessage(over.findings, 'max_length は 2048 以下にします').location.pointer).toBe('fields[0].max_length');
    expect(parseField(['max_length: 2048', 'format: url']).findings).toHaveLength(0);
  });

  it('max_length が無い format: url は ここでは通る(上限の無い欄は R10 が止める)', () => {
    expect(parseField(['format: url']).findings).toHaveLength(0);
  });
});

describe('parseEntitySpec の not_boundary(点検 5 回目 A5-4)', () => {
  /** 欄 1 本の宣言を読む。 */
  function parseField(type: string, extra: readonly string[]) {
    return entityFrom(['doc_type: entity_spec', 'entity: staff', 'fields:', '  - name: company_id', `    type: ${type}`, ...extra.map((line) => `    ${line}`), '    personal: false', ''].join('\n'));
  }

  it.each([
    ['参照の欄に理由を書けば読む', 'ref(company)', ['not_boundary: 所属の印で、見える行を狭めない'], [], '所属の印で、見える行を狭めない'],
    ['書かなければキーが現れない', 'ref(company)', [], [], undefined],
    ['参照でない欄には書けない', 'string', ['max_length: 10', 'not_boundary: 理由'], ['not_boundary は参照の欄(ref)にだけ書けます'], undefined],
    ['理由が空白だけ', 'ref(company)', ["not_boundary: '  '"], ['not_boundary の理由が空です'], undefined],
  ] as const)('%s', (_title, type, extra, errors, value) => {
    const result = parseField(type, extra);
    expect(result.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message)).toEqual(errors);
    if (errors.length === 0) expect(result.value?.fields[0]?.notBoundary).toBe(value);
  });
});
