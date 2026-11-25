import { describe, expect, it } from 'vitest';
import { parseAccessSpec, parseReadScope } from '../../../lib/model/parse-access.js';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FILE = 'docs/specs/domain/entry/access.md';

describe('parseReadScope', () => {
  it('値域の 4 種を読む', () => {
    const reporter = new SpecReporter(FILE);
    expect(parseReadScope('own', 'p', reporter)).toEqual({ kind: 'own' });
    expect(parseReadScope('all', 'p', reporter)).toEqual({ kind: 'all' });
    expect(parseReadScope('none', 'p', reporter)).toEqual({ kind: 'none' });
    expect(parseReadScope('context(workshop)', 'p', reporter)).toEqual({
      kind: 'context',
      entity: 'workshop',
    });
    expect(reporter.findings()).toHaveLength(0);
  });

  it('値域の外は V1 違反として弾く', () => {
    const reporter = new SpecReporter(FILE);
    expect(parseReadScope('public', 'reads[0].scope', reporter)).toBeNull();

    const finding = findByMessage(reporter.findings(), 'scope "public" は使えません');
    expect(finding.location.pointer).toBe('reads[0].scope');
    expect(finding.suggestion).toContain('own / context({entity}) / all / none');
  });
});

describe('parseAccessSpec', () => {
  const valid = {
    doc_type: 'access_spec',
    entity: 'entry',
    reads: [
      { by: 'performer', scope: 'own' },
      { by: 'organizer', scope: 'context(workshop)' },
      { by: 'member', scope: 'none' },
    ],
    fields_hidden: [{ field: 'note', from: ['member'] }],
    creates: [{ by: 'member', when: 'workshop.state == accepting' }, { by: 'system' }],
    deletes: [{ by: 'performer', when: 'state == draft' }, { by: 'system' }],
    writes: [
      { by: 'performer', fields: ['title', 'note'], when: 'state == draft' },
      { by: 'organizer', fields: ['note'] },
    ],
  };

  it('reads / fields_hidden / creates / writes / deletes を読む', () => {
    const result = parseAccessSpec(valid, FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.entity).toBe('entry');
    expect(result.value?.reads[1]).toEqual({
      by: 'organizer',
      scope: { kind: 'context', entity: 'workshop' },
      location: { file: FILE, pointer: 'reads.organizer' },
    });
    expect(result.value?.fieldsHidden[0]).toMatchObject({ field: 'note', from: ['member'] });
    expect(result.value?.writes[0]).toMatchObject({ by: 'performer', when: 'state == draft' });
    expect(result.value?.writes[1]?.when).toBeUndefined();
    expect(result.value?.creates[0]).toEqual({
      by: 'member',
      when: 'workshop.state == accepting',
      location: { file: FILE, pointer: 'creates.member' },
    });
    expect(result.value?.creates[1]?.when).toBeUndefined();
    expect(result.value?.deletes[0]).toEqual({
      by: 'performer',
      when: 'state == draft',
      location: { file: FILE, pointer: 'deletes.performer' },
    });
    expect(result.value?.deletes[1]?.when).toBeUndefined();
  });

  it('reads[].when（行の状態で見え方を絞る条件）を読む（束 §14）', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'entry',
        reads: [
          { by: 'member', scope: 'all', when: 'entry.state != cancelled' },
          { by: 'organizer', scope: 'all' },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.reads[0]).toEqual({
      by: 'member',
      scope: { kind: 'all' },
      when: 'entry.state != cancelled',
      location: { file: FILE, pointer: 'reads.member' },
    });
    // 書かなければキーそのものが無い（「条件が無い = 状態で絞らない」を空文字で表さない）。
    expect(result.value?.reads[1]?.when).toBeUndefined();
  });

  it('transition_writes(遷移だけが書く列)を読む。無ければ空で、writes の規則には混ざらない', () => {
    const declared = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry', reads: [], transition_writes: ['handled_by'] }, FILE);
    const absent = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry', reads: [] }, FILE);

    expect(declared.findings).toHaveLength(0);
    expect(declared.value?.transitionWrites).toEqual(['handled_by']);
    expect(declared.value?.writes).toEqual([]);
    expect(absent.value?.transitionWrites).toEqual([]);
  });

  it('transition_writes がリストでなければ指摘する', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry', reads: [], transition_writes: 'handled_by' }, FILE);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.map((finding) => finding.suggestion).join('\n')).toContain('transition_writes');
  });

  it('deletes が無ければ空になる（宣言なし = 誰も消せない）', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry', reads: [] }, FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.deletes).toEqual([]);
  });

  it('deletes の要素で by を欠く行だけを落とす', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'entry',
        reads: [],
        deletes: [{ when: 'state == draft' }, { by: 'performer' }],
      },
      FILE,
    );

    expect(result.value?.deletes.map((rule) => rule.by)).toEqual(['performer']);
    expect(findByMessage(result.findings, 'by がありません').location.pointer).toBe('deletes[0].by');
  });

  it('creates が無ければ空になる（宣言なし = 誰も作れない）', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry', reads: [] }, FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.creates).toEqual([]);
  });

  it('creates の要素で by を欠く行だけを落とす', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'entry',
        reads: [],
        creates: [{ when: 'workshop.state == accepting' }, { by: 'member' }],
      },
      FILE,
    );

    expect(result.value?.creates.map((rule) => rule.by)).toEqual(['member']);
    expect(findByMessage(result.findings, 'by がありません').location.pointer).toBe('creates[0].by');
  });

  it('entity / reads の欠落は AccessSpec を構築できない', () => {
    const noEntity = parseAccessSpec({ doc_type: 'access_spec', reads: [] }, FILE);
    expect(noEntity.value).toBeNull();
    expectWellFormed(noEntity.findings);
    expect(findByMessage(noEntity.findings, 'entity がありません')).toBeDefined();

    const noReads = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry' }, FILE);
    expect(noReads.value).toBeNull();
    expect(findByMessage(noReads.findings, 'reads がありません')).toBeDefined();
  });

  it('reads の要素で by / scope を欠く行だけを落とす', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'entry',
        reads: [{ by: 'member' }, { scope: 'all' }, { by: 'system', scope: 'all' }],
      },
      FILE,
    );

    expect(result.value?.reads.map((rule) => rule.by)).toEqual(['system']);
    expect(findByMessage(result.findings, 'scope がありません').location.pointer).toBe('reads[0].scope');
    expect(findByMessage(result.findings, 'by がありません').location.pointer).toBe('reads[1].by');
  });

  it('writes の effects を読む(編集の副作用。domain-spec-writing.md §access_spec)', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'member',
        reads: [],
        writes: [
          { by: 'account_owner', fields: ['display_name'], effects: ['refresh_session_profile'] },
          { by: 'staff', fields: ['is_staff'] },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.writes[0]?.effects).toEqual(['refresh_session_profile']);
    expect(result.value?.writes[1]?.effects).toBeUndefined();
  });

  it('writes の effects が空リストなら「宣言なし」と同じに畳む(effects キーを持たない)', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'member',
        reads: [],
        writes: [{ by: 'account_owner', fields: ['display_name'], effects: [] }],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.writes[0]?.effects).toBeUndefined();
  });

  it('writes の fields が空なら落として指摘する', () => {
    const result = parseAccessSpec(
      { doc_type: 'access_spec', entity: 'entry', reads: [], writes: [{ by: 'performer', fields: [] }] },
      FILE,
    );

    expect(result.value?.writes).toEqual([]);
    expect(findByMessage(result.findings, 'fields が空です')).toBeDefined();
  });

  it('fields_hidden の from が空なら落として指摘する', () => {
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'entry',
        reads: [],
        fields_hidden: [{ field: 'note', from: [] }],
      },
      FILE,
    );

    expect(result.value?.fieldsHidden).toEqual([]);
    expect(findByMessage(result.findings, 'from が空です')).toBeDefined();
  });

  describe('reads[].filters(実行者の属性で狭める境界。テナント)', () => {
    it('"{列}: actor.{欄}" を読める', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'store',
          reads: [{ by: 'member', scope: 'all', filters: { company_id: 'actor.company_id' } }],
        },
        FILE,
      );

      expect(result.findings).toEqual([]);
      expect(result.value?.reads[0]?.filters).toEqual([{ field: 'company_id', actorField: 'company_id' }]);
    });

    it('filters を書かなければ持たない(宣言の不在が「狭めない」を意味する)', () => {
      const result = parseAccessSpec(
        { doc_type: 'access_spec', entity: 'store', reads: [{ by: 'member', scope: 'all' }] },
        FILE,
      );

      expect(result.findings).toEqual([]);
      expect(result.value?.reads[0]?.filters).toBeUndefined();
    });

    it('右辺が actor.{欄} でなければ失敗する(写せる形は 1 つだけ)', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'store',
          reads: [{ by: 'member', scope: 'all', filters: { company_id: 'staff_member.company_id' } }],
        },
        FILE,
      );

      const finding = findByMessage(result.findings, '実行者の属性ではありません');
      expect(finding.location.pointer).toBe('reads[0].filters.company_id');
      expect(result.value?.reads[0]?.filters).toBeUndefined();
    });

    it('actor の後ろが 2 段なら失敗する(実行者の属性は 1 段)', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'store',
          reads: [{ by: 'member', scope: 'all', filters: { company_id: 'actor.company.id' } }],
        },
        FILE,
      );

      expect(findByMessage(result.findings, '実行者の属性ではありません')).toBeDefined();
    });

    it('"{親の集約}.{列}: actor.{欄}" を親の列として読める(binding / when と同じ語彙)', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'booking',
          reads: [{ by: 'member', scope: 'all', filters: { 'department.company_id': 'actor.company_id' } }],
        },
        FILE,
      );

      expect(result.findings).toEqual([]);
      expect(result.value?.reads[0]?.filters).toEqual([
        { entity: 'department', field: 'company_id', actorField: 'company_id' },
      ]);
    });

    it('自集約の名前で書いた左辺は裸の列に畳む(同じ境界の綴りを 2 つ作らない)', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'store',
          reads: [{ by: 'member', scope: 'all', filters: { 'store.company_id': 'actor.company_id' } }],
        },
        FILE,
      );

      expect(result.findings).toEqual([]);
      expect(result.value?.reads[0]?.filters).toEqual([{ field: 'company_id', actorField: 'company_id' }]);
    });

    it('左辺が 3 段以上・空の段なら失敗する(届く範囲は {集約}.{列} の 1 形)', () => {
      for (const key of ['room.department.company_id', '.company_id', 'department.']) {
        const result = parseAccessSpec(
          {
            doc_type: 'access_spec',
            entity: 'booking',
            reads: [{ by: 'member', scope: 'all', filters: { [key]: 'actor.company_id' } }],
          },
          FILE,
        );

        expect(findByMessage(result.findings, 'の形ではありません')).toBeDefined();
        expect(result.value?.reads[0]?.filters).toBeUndefined();
      }
    });
  });

  describe('accept[].on(受け入れる規則の種類。既定は読み取りだけ・書いたら書いた種類にだけ効く)', () => {
    /** accept 1 件を持つ access_spec を読む。 */
    function withAccept(extra: Record<string, unknown>) {
      return parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'store',
          reads: [{ by: 'member', scope: 'all' }],
          accept: [{ by: 'member', filter: 'company_id', reason: '理由', ...extra }],
        },
        FILE,
      );
    }

    it('on を書かなければ読み取りだけ(on を持たない)', () => {
      const result = withAccept({});
      expect(result.findings).toEqual([]);
      expect(result.value?.accepts[0]).not.toHaveProperty('on');
    });

    it('on: [create, write, delete] を宣言順で読む(重複は 1 つにする)', () => {
      const result = withAccept({ on: ['delete', 'create', 'delete'] });
      expect(result.findings).toEqual([]);
      expect(result.value?.accepts[0]?.on).toEqual(['delete', 'create']);
    });

    it('on: [read, transition] も読む(A3-4: 読み取りも受け入れるなら read を名指す・遷移は transition と events)', () => {
      const result = withAccept({ on: ['read', 'transition', 'create'], events: ['close', 'reopen', 'close'] });
      expect(result.findings).toEqual([]);
      expect(result.value?.accepts[0]?.on).toEqual(['read', 'transition', 'create']);
      expect(result.value?.accepts[0]?.events).toEqual(['close', 'reopen']);
    });

    it('遷移を受け入れないなら events を持たない', () => {
      expect(withAccept({ on: ['write'] }).value?.accepts[0]).not.toHaveProperty('events');
    });

    // A4-4: 遷移の受け入れはロール × 列ではなく遷移ごとに効く(名指しの無い受け入れは後から足した遷移まで外す)。
    for (const [name, extra, message] of [
      ['on: [transition] に events が無い', { on: ['transition'] }, '遷移を名指していません'],
      ['on: [read, transition] に events が無い', { on: ['read', 'transition'] }, '遷移を名指していません'],
      ['events が空', { on: ['transition'], events: [] }, 'events が空です'],
      ['on が無いのに events', { events: ['close'] }, 'on に transition があるときだけ'],
      ['on: [write] に events', { on: ['write'], events: ['close'] }, 'on に transition があるときだけ'],
    ] as const) {
      it(`${name}は V1 違反(受け入れを落とす)`, () => {
        const result = withAccept(extra);
        expect(findByMessage(result.findings, message)).toBeDefined();
        expect(result.value?.accepts ?? []).toEqual([]);
      });
    }

    for (const [name, on, message] of [
      ['未知の語', ['update'], 'on に書けない語があります'],
      ['綴り違い(reads)', ['reads'], 'on に書けない語があります'],
      ['空の配列', [], 'on が空です'],
    ] as const) {
      it(`${name}は V1 違反(黙って読み取りだけに戻さない)`, () => {
        const result = withAccept({ on });
        expect(findByMessage(result.findings, message)).toBeDefined();
        expect(result.value?.accepts ?? []).toEqual([]);
      });
    }

    it('on が配列でなければ V1 違反', () => {
      expect(withAccept({ on: 'create' }).findings.length).toBeGreaterThan(0);
    });
  });

  describe('知らないキーをエラーにする（書いたのに効いていない宣言を作らない）', () => {
    it('スキーマどおりのキーだけなら通す', () => {
      const result = parseAccessSpec({ ...valid, scope: 'common', id: 'entry-access' }, FILE);

      expect(result.findings).toHaveLength(0);
    });

    it('doc_type によらず書ける共通キー（norms / decisions）は通す', () => {
      const result = parseAccessSpec(
        { ...valid, norms: ['PRIN-0001'], decisions: ['ADR-0003'] },
        FILE,
      );

      expect(result.findings).toHaveLength(0);
    });

    it('トップレベルの知らないキーをエラーにする', () => {
      const result = parseAccessSpec({ ...valid, field_hidden: [] }, FILE);

      expectWellFormed(result.findings);
      const finding = findByMessage(result.findings, 'access_spec に field_hidden は書けません');
      expect(finding.location.pointer).toBe('field_hidden');
      expect(finding.suggestion).toContain('fields_hidden');
      expect(finding.counterexample?.key).toBe('field_hidden');
    });

    it('reads の要素の綴り違いをエラーにする（書ける軸は by / scope / filters / when の 4 つ）', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'entry',
          reads: [{ by: 'member', scope: 'all', wehn: 'state == submitted' }],
        },
        FILE,
      );

      const finding = findByMessage(result.findings, 'reads の要素 に wehn は書けません');
      expect(finding.location.pointer).toBe('reads[0].wehn');
      expect(finding.counterexample?.allowed).toBe('by, scope, filters, when');
      // 読める部分は読み続ける（1 つの書き間違いで残りの指摘が消えないため）
      expect(result.value?.reads.map((rule) => rule.by)).toEqual(['member']);
    });

    it('fields_hidden / creates / writes / deletes の要素の綴り違いをエラーにする', () => {
      const result = parseAccessSpec(
        {
          doc_type: 'access_spec',
          entity: 'entry',
          reads: [],
          fields_hidden: [{ field: 'note', from: ['member'], table: 'entries' }],
          creates: [{ by: 'member', whern: 'state == draft' }],
          writes: [{ by: 'performer', fields: ['note'], field: 'note' }],
          deletes: [{ by: 'performer', unless: 'state == draft' }],
        },
        FILE,
      );

      expect(findByMessage(result.findings, 'fields_hidden の要素 に table').location.pointer).toBe(
        'fields_hidden[0].table',
      );
      expect(findByMessage(result.findings, 'creates の要素 に whern').location.pointer).toBe(
        'creates[0].whern',
      );
      expect(findByMessage(result.findings, 'writes の要素 に field').location.pointer).toBe(
        'writes[0].field',
      );
      expect(findByMessage(result.findings, 'deletes の要素 に unless').location.pointer).toBe(
        'deletes[0].unless',
      );
    });
  });

  it('reads が空でも V1 は通す（全ロールの明示は V4 の担当）', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'entry', reads: [] }, FILE);

    expect(result.findings).toHaveLength(0);
    expect(result.value?.reads).toEqual([]);
  });
});
