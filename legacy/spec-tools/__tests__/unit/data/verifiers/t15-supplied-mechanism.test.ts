/**
 * T15(トリガが供給する列を、生成物だけの系で誰が埋めるか)のテスト。
 *
 * 固定するのは 4 つ:
 *   - 写しとして導出でき、関数も宣言されていれば何も言わない
 *   - 本文が生成されるのに `functions[]` に `kind: trigger` の宣言が無ければ error
 *   - 写しのトリガの `fires` が表名まで書いていれば error(生成が `on {表}` を付ける)
 *   - 写しでもなく `defaults` も無い列は warning(生成物だけでは誰も埋めない)—— ただし
 *     `defaults` がある列は何も言わない(列の既定値が埋めるから)
 *   - **写しと書いてあるのに道が解けない列は別の warning**(書いた人に「書け」と言わない)
 */

import { describe, expect, it } from 'vitest';
import { verifySuppliedMechanism } from '../../../../lib/data/verifiers/t15-supplied-mechanism.js';
import { copySources } from '../../../../lib/data/verifiers/t15-copy-source.js';
import type { DataDerivation, DataFunctionDecl, DataTableSpec, DataTriggerDecl } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { accessSpec, invariant, invariantSpec, loc, readRule } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 題材: 売場(section)。会社は店舗からの写しである。 */
function domain(withFormal: boolean, expr = 'section.company_id == store.company_id', extraDbColumn = false): SpecModel {
  return specModel([
    aggregate('store', {
      entity: entitySpec('store', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('company_id', { kind: 'ref', entity: 'company' }, { required: true }),
        ],
      }),
    }),
    aggregate('company', { entity: entitySpec('company', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }) }),
    aggregate('section', {
      entity: entitySpec('section', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('company_id', { kind: 'ref', entity: 'company' }, { required: true }),
          field('store_id', { kind: 'ref', entity: 'store' }, { required: true }),
          field('opened_at', { kind: 'datetime' }, { required: true }),
          { ...field('opening_notice_at', { kind: 'datetime' }), suppliedBy: 'db' },
          ...(extraDbColumn ? [{ ...field('closing_notice_at', { kind: 'datetime' }), suppliedBy: 'db' as const }] : []),
        ],
      }),
      invariants: invariantSpec([
        withFormal
          ? invariant({ id: 'INV-SECTION-002', entities: ['section', 'store'], formal: { kind: 'check', expr } })
          : invariant({ id: 'INV-SECTION-002', entities: ['section', 'store'] }),
      ]),
    }),
  ]);
}

/** 写しのトリガ 1 本。 */
function syncTrigger(supplies: readonly string[], fires = 'before insert or update of store_id, company_id'): DataTriggerDecl {
  return {
    name: 'sync_section_company',
    functionName: 'sync_section_company',
    fires,
    deferred: false,
    supplies: [...supplies],
    params: {},
    invariant: 'INV-SECTION-002',
  };
}

/** `kind: trigger` の関数宣言。 */
const TRIGGER_FUNCTION: DataFunctionDecl = {
  name: 'sync_section_company',
  args: [],
  params: [],
  kind: 'trigger',
  alsoWrites: [],
};

/** 売場の表(トリガ・関数・既定値を差し替える)。 */
function tables(opts: Partial<DataTableSpec>) {
  return dataTableModel([
    dataTable('companies', { entity: 'company' }),
    dataTable('stores', { entity: 'store' }),
    dataTable('sections', { entity: 'section', ...opts }),
  ]);
}

describe('T15 供給する列の機構', () => {
  it('写しとして導出でき、関数も宣言されていれば何も言わない', () => {
    const findings = verifySuppliedMechanism(
      domain(true),
      tables({ triggers: [syncTrigger(['company_id'])], functions: [TRIGGER_FUNCTION] }),
    );
    expect(findings).toEqual([]);
  });

  it('本文が生成されるのに関数の宣言が無ければ error', () => {
    const findings = verifySuppliedMechanism(domain(true), tables({ triggers: [syncTrigger(['company_id'])] }));
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T15', 'error']]);
    expect(findings[0]?.message).toContain('sync_section_company');
  });

  it('写しのトリガの fires が表名まで書いていれば error', () => {
    const findings = verifySuppliedMechanism(
      domain(true),
      tables({
        triggers: [syncTrigger(['company_id'], 'before insert or update of store_id, company_id on sections')],
        functions: [TRIGGER_FUNCTION],
      }),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T15', 'error']]);
    expect(findings[0]?.message).toContain('fires');
  });

  it('写しでもなく既定値も無い列は warning(生成物だけでは誰も埋めない)', () => {
    const findings = verifySuppliedMechanism(
      domain(false),
      tables({ triggers: [syncTrigger(['company_id'])], functions: [TRIGGER_FUNCTION] }),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T15', 'warning']]);
    expect(findings[0]?.counterexample).toMatchObject({ columns: 'company_id' });
  });

  it('列の既定値がある列には何も言わない(それが機構である)', () => {
    const findings = verifySuppliedMechanism(
      domain(false),
      tables({
        triggers: [syncTrigger(['opened_at'])],
        functions: [TRIGGER_FUNCTION],
        defaults: { opened_at: 'now()' },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('写しと書いてあるのに道が解けない列は、別の文言で名指す(「書け」と言わない)', () => {
    // 売場から「持株会社」へは参照列をたどっても届かない。
    const findings = verifySuppliedMechanism(
      domain(true, 'section.company_id == holding.company_id'),
      tables({ triggers: [syncTrigger(['company_id'])], functions: [TRIGGER_FUNCTION] }),
    );
    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T15', 'warning']]);
    expect(findings[0]?.message).toContain('参照の連鎖が解けません');
    expect(findings[0]?.message).not.toContain('誰も埋めません');
    expect(findings[0]?.counterexample?.where).toContain('届かない');
  });

  it('値を供給しないトリガは対象外である', () => {
    const findings = verifySuppliedMechanism(domain(true), tables({ triggers: [syncTrigger([])] }));
    expect(findings).toEqual([]);
  });

  describe('導出(derives)を宣言したトリガ', () => {
    /** 導出のトリガ 1 本。 */
    function deriveTrigger(
      derives: readonly DataDerivation[],
      over: Partial<DataTriggerDecl> = {},
    ): DataTriggerDecl {
      return {
        name: 'fill_section_notice',
        functionName: 'fill_section_notice',
        fires: 'before insert',
        deferred: false,
        supplies: derives.map((derivation) => derivation.column),
        params: {},
        derives,
        ...over,
      };
    }

    /** その関数の宣言。 */
    const DERIVE_FUNCTION: DataFunctionDecl = { ...TRIGGER_FUNCTION, name: 'fill_section_notice' };
    const NOTICE = { column: 'opening_notice_at', from: 'opened_at', offset: '-1 day', mode: 'initial' } as const;

    it('通る宣言には何も言わない(列を埋める機構が無いという warning も出ない)', () => {
      const findings = verifySuppliedMechanism(
        domain(false),
        tables({ triggers: [deriveTrigger([NOTICE])], functions: [DERIVE_FUNCTION] }),
      );
      expect(findings).toEqual([]);
    });

    it('通る宣言でも functions[] に kind: trigger の宣言が無ければ error(生成先が無い)', () => {
      const findings = verifySuppliedMechanism(domain(false), tables({ triggers: [deriveTrigger([NOTICE])] }));
      expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['T15', 'error']]);
      expect(findings[0]?.message).toContain('fill_section_notice');
    });

    it('supplies を書かず derives だけでも見られる(通れば何も言わない)', () => {
      const findings = verifySuppliedMechanism(
        domain(false),
        tables({ triggers: [deriveTrigger([NOTICE], { supplies: [] })], functions: [DERIVE_FUNCTION] }),
      );
      expect(findings.map((finding) => finding.severity)).toEqual(['error']);
      expect(findings[0]?.message).toContain('supplies と derives の列が一致しません');
    });

    it('下位検査は error で、位置は宣言の下の相対パスを指す', () => {
      const cases: ReadonlyArray<readonly [DataDerivation, string, string]> = [
        [{ ...NOTICE, from: 'store_id' }, 'derives.opening_notice_at.from', '日時(datetime)の欄ではありません'],
        [{ ...NOTICE, offset: '1 week' }, 'derives.opening_notice_at.offset', '閉じた語'],
        [{ ...NOTICE, mode: 'sometimes' }, 'derives.opening_notice_at.mode', '値域にありません'],
        [{ ...NOTICE, column: 'opened_at', from: 'opened_at' }, 'derives.opened_at', 'supplied_by: db'],
      ];
      for (const [derivation, pointer, message] of cases) {
        const findings = verifySuppliedMechanism(
          domain(false),
          tables({ triggers: [deriveTrigger([derivation])], functions: [DERIVE_FUNCTION] }),
        );
        expect(findings.every((finding) => finding.severity === 'error' && finding.verifier === 'T15')).toBe(true);
        expect(findings.map((finding) => finding.location.pointer).join('\n')).toContain(pointer);
        expect(findings.map((finding) => finding.message).join('\n')).toContain(message);
      }
    });

    it('follow なのに fires が元の列の更新を含まなければ error(宣言の嘘)', () => {
      const findings = verifySuppliedMechanism(
        domain(false),
        tables({
          triggers: [deriveTrigger([{ ...NOTICE, mode: 'follow' }], { fires: 'before insert' })],
          functions: [DERIVE_FUNCTION],
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('更新を含みません');
      expect(findings[0]?.suggestion).toContain('update of opened_at');
    });

    it('同じ列を 2 つのトリガが導出すれば error', () => {
      const second = deriveTrigger([NOTICE], { name: 'other_notice', functionName: 'other_notice' });
      const findings = verifySuppliedMechanism(
        domain(false),
        tables({
          triggers: [deriveTrigger([NOTICE]), second],
          functions: [DERIVE_FUNCTION, { ...TRIGGER_FUNCTION, name: 'other_notice' }],
        }),
      );
      expect(findings).toHaveLength(2);
      expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
    });

    it('元(from)が別のトリガの導出列なら error(発火順で結果が変わる)で、読む側だけを指す', () => {
      const upstream = deriveTrigger([NOTICE]);
      const chained = deriveTrigger([{ column: 'closing_notice_at', from: 'opening_notice_at', offset: '1 hour', mode: 'initial' }], {
        name: 'chain_notice',
        functionName: 'chain_notice',
      });
      const findings = verifySuppliedMechanism(
        domain(false, undefined, true),
        tables({
          triggers: [upstream, chained],
          functions: [DERIVE_FUNCTION, { ...TRIGGER_FUNCTION, name: 'chain_notice' }],
        }),
      );
      const fromProblems = findings.filter((finding) => finding.location.pointer?.endsWith('.from') === true);
      expect(fromProblems).toHaveLength(1);
      expect(fromProblems[0]?.severity).toBe('error');
      expect(fromProblems[0]?.message).toContain('fill_section_notice');
    });

    it('関数が handwritten なら error(本文は生成物なので併記できない)', () => {
      const findings = verifySuppliedMechanism(
        domain(false),
        tables({
          triggers: [deriveTrigger([NOTICE])],
          functions: [{ ...DERIVE_FUNCTION, handwritten: '手書き' }],
        }),
      );
      expect(findings.map((finding) => finding.severity)).toEqual(['error']);
      expect(findings[0]?.message).toContain('handwritten');
    });
  });
});

describe('T15 写しのトリガは隠し列・個人列の約束を保つ(点検 12 回目 A12-2)', () => {
  const location = { file: 'x.md' };
  /** 注文の `customer` を通知へ写す題材(`notice.customer == sales.customer`)。 */
  function copyDomain(init: { readonly sourcePersonal?: boolean; readonly targetPersonal?: boolean; readonly hidden?: readonly string[]; readonly reader?: string; readonly ref?: boolean }): SpecModel {
    return specModel([
      aggregate('sales', {
        entity: entitySpec('sales', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('customer', { kind: 'string' }, { personal: init.sourcePersonal ?? false })] }),
        access: accessSpec('sales', { fieldsHidden: init.hidden === undefined ? [] : [{ field: 'customer', from: init.hidden, location: loc() }] }),
      }),
      aggregate('notice', {
        entity: entitySpec('notice', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            ...(init.ref === false ? [] : [field('sales_id', { kind: 'ref', entity: 'sales' }, { required: true })]),
            { ...field('customer', { kind: 'string' }, { personal: init.targetPersonal ?? false }), suppliedBy: 'db' },
          ],
        }),
        access: accessSpec('notice', { reads: [readRule(init.reader ?? 'staff', { kind: 'all' })] }),
        invariants: invariantSpec([invariant({ id: 'INV-NOTICE-001', entities: ['notice', 'sales'], formal: { kind: 'check', expr: 'notice.customer == sales.customer' } })]),
      }),
    ]);
  }
  const TRIGGER: DataTriggerDecl = { name: 'sync', functionName: 'sync', deferred: false, supplies: ['customer'], invariant: 'INV-NOTICE-001', params: {}, fires: 'before insert' };
  const FUNCTIONS: readonly DataFunctionDecl[] = [{ name: 'sync', args: [], kind: 'trigger', handwritten: false } as unknown as DataFunctionDecl];
  const run = (model: SpecModel, trigger: DataTriggerDecl = TRIGGER, entity: string | undefined = 'notice') =>
    verifySuppliedMechanism(model, dataTableModel([dataTable('notices', { ...(entity === undefined ? { internal: true } : { entity }), triggers: [trigger], functions: FUNCTIONS })])).filter((finding) => /約束|隠した|個人列/u.test(finding.message));
  const accept = (on: 'hidden' | 'personal', role?: string, column = 'customer', reader = 'staff') => ({ column, on, ...(role === undefined ? {} : { role, reader }), reason: '理由', location });

  it.each([
    { name: '隠した相手が写し先を読める(探り台本 H0 の形)', init: { hidden: ['staff'], targetPersonal: true, sourcePersonal: true }, pattern: /staff から隠した列/u },
    { name: '個人列を personal: false へ(探り台本 H1 の形)', init: { sourcePersonal: true }, pattern: /個人列の値を/u },
    { name: '道が解けない写しも写し元は読める', init: { sourcePersonal: true, ref: false }, pattern: /個人列の値を/u },
  ])('赤: $name', ({ init, pattern }) => {
    expect(run(copyDomain(init))).toEqual([expect.objectContaining({ verifier: 'T15', severity: 'error', message: expect.stringMatching(pattern) })]);
  });

  it.each([
    { name: '約束の崩れない写し', model: () => copyDomain({ sourcePersonal: true, targetPersonal: true, hidden: ['other'] }), trigger: TRIGGER },
    { name: 'supplies に載らない列の等式は値を運ばない', model: () => copyDomain({ sourcePersonal: true }), trigger: { ...TRIGGER, supplies: ['other'] } },
    { name: '導出のトリガは写しではない', model: () => copyDomain({ sourcePersonal: true }), trigger: { ...TRIGGER, derives: [] } },
    { name: '受け入れ', model: () => copyDomain({ sourcePersonal: true, hidden: ['staff'] }), trigger: { ...TRIGGER, accept: [accept('personal'), accept('hidden', 'staff')] } },
  ])('緑: $name', ({ model, trigger }) => {
    expect(run(model(), trigger)).toEqual([]);
  });

  it.each([
    { name: '崩れていない列の受け入れ', trigger: { ...TRIGGER, accept: [accept('personal')] }, entity: 'notice' },
    { name: '写しでない列の受け入れ', trigger: { ...TRIGGER, accept: [accept('personal', undefined, 'other')] }, entity: 'notice' },
    { name: '供給の無いトリガの受け入れ', trigger: { ...TRIGGER, supplies: [], accept: [accept('personal')] }, entity: 'notice' },
    { name: '集約を持たない表の受け入れ', trigger: { ...TRIGGER, accept: [accept('personal')] }, entity: undefined },
  ])('赤: 腐った受け入れ — $name', ({ trigger, entity }) => {
    expect(run(copyDomain({ targetPersonal: true }), trigger, entity).length + 0).toBe(1);
  });

  describe('写しの参照の列の付け替え(A14-7)', () => {
    /** 売場の参照の列 store_id を編集できる題材。 */
    function editable(): SpecModel {
      const model = domain(true);
      const specs = model.aggregates.get('section');
      if (specs === undefined) throw new Error('題材に section がありません');
      const access = { reads: [], fieldsHidden: [], creates: [], deletes: [], writes: [{ by: 'manager', fields: ['store_id'] }] } as unknown as NonNullable<typeof specs.access>;
      return { ...model, aggregates: new Map([...model.aggregates, ['section', { ...specs, access }]]) };
    }
    const fn = { functions: [TRIGGER_FUNCTION] };

    it.each(['before insert', 'before insert or update of opened_at'])('赤: F4w 編集できる参照の列の更新で発火しない: %s', (fires) => {
      const findings = verifySuppliedMechanism(editable(), tables({ ...fn, triggers: [syncTrigger(['company_id'], fires)] })).filter((finding) => finding.message.includes('付け替え'));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.counterexample).toMatchObject({ ref: 'store_id', column: 'company_id' });
    });

    it.each(['before insert or update of store_id', 'before insert or update of opened_at, store_id', 'before insert or update', 'before update of store_id or insert on sections for each row'])('緑: %s', (fires) => {
      expect(verifySuppliedMechanism(editable(), tables({ ...fn, triggers: [syncTrigger(['company_id'], fires)] })).filter((finding) => finding.message.includes('付け替え'))).toEqual([]);
    });

    it('緑: 参照の列を編集できなければ before insert でよい', () => {
      expect(verifySuppliedMechanism(domain(true), tables({ ...fn, triggers: [syncTrigger(['company_id'], 'before insert')] })).filter((finding) => finding.message.includes('付け替え'))).toEqual([]);
    });
  });
});

describe('T15 写しは不変の祖先の列に限り、写す列そのものの更新でも写し直す(点検 26 回目 A26-2)', () => {
  /** 店舗(写し元)の access_spec を差し替えた題材。 */
  function withStoreAccess(access: { readonly writes?: readonly { readonly by: string; readonly fields: readonly string[] }[]; readonly transitionWrites?: readonly string[] }): SpecModel {
    const model = domain(true);
    const specs = model.aggregates.get('store');
    if (specs === undefined) throw new Error('題材に store がありません');
    const filled = { reads: [], fieldsHidden: [], creates: [], deletes: [], writes: access.writes ?? [], transitionWrites: access.transitionWrites ?? [] } as unknown as NonNullable<typeof specs.access>;
    return { ...model, aggregates: new Map([...model.aggregates, ['store', { ...specs, access: filled }]]) };
  }
  const fn = { functions: [TRIGGER_FUNCTION] };
  const sourceFindings = (model: SpecModel): readonly unknown[] =>
    verifySuppliedMechanism(model, tables({ ...fn, triggers: [syncTrigger(['company_id'])] })).filter((finding) => finding.message.includes('写し元の道'));

  it.each([
    ['writes', { writes: [{ by: 'admin', fields: ['company_id'] }] }],
    ['transition_writes', { transitionWrites: ['company_id'] }],
  ] as const)('赤: 写し元の列が %s で書き換えられる宣言は error', (_label, access) => {
    const findings = verifySuppliedMechanism(withStoreAccess(access), tables({ ...fn, triggers: [syncTrigger(['company_id'])] })).filter((finding) => finding.message.includes('写し元の道'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', counterexample: { column: 'company_id', source: 'store.company_id' } });
  });

  it('緑: 写し元の別の列だけが書き換えられるなら何も言わない', () => {
    expect(sourceFindings(withStoreAccess({ writes: [{ by: 'admin', fields: ['name'] }] }))).toEqual([]);
    expect(sourceFindings(domain(true))).toEqual([]);
  });

  it('写し元の道の列は 2 段目以降の参照の欄と最後の写し元の列(1 段目の自表の参照の欄は入れない)', () => {
    const copy = {
      column: 'company_id',
      fromEntity: 'company',
      fromColumn: 'id',
      path: [
        { refColumn: 'shelf_id', entity: 'shelf' },
        { refColumn: 'section_id', entity: 'section' },
        { refColumn: 'company_id', entity: 'company' },
      ],
    };
    expect(copySources(copy)).toEqual([
      { entity: 'shelf', column: 'section_id' },
      { entity: 'section', column: 'company_id' },
      { entity: 'company', column: 'id' },
    ]);
  });

  it.each(['before insert', 'before insert or update of store_id', 'before insert or update of opened_at, store_id'])('赤: 写す列そのものの更新で発火しない: %s', (fires) => {
    const findings = verifySuppliedMechanism(domain(true), tables({ ...fn, triggers: [syncTrigger(['company_id'], fires)] })).filter((finding) => finding.message.includes('自身の更新で発火しません'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', counterexample: { column: 'company_id', fires } });
  });

  it.each(['before insert or update of store_id, company_id', 'before insert or update of company_id, store_id', 'before insert or update'])('緑: %s', (fires) => {
    expect(verifySuppliedMechanism(domain(true), tables({ ...fn, triggers: [syncTrigger(['company_id'], fires)] })).filter((finding) => finding.message.includes('自身の更新で発火しません'))).toEqual([]);
  });
});
