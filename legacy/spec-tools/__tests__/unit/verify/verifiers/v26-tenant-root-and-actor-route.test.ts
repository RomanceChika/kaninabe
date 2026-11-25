/**
 * テナント境界(V20 / V26)の点検 4 回目の直し(A4-1〜A4-4)の規約網羅テスト。
 *
 * - A4-1: **境界の根**(境界の欄の参照先。`ref(company)` なら `company`)は `id` を境界の列として扱う。読み取り・書き込み・遷移の
 *   どれでも、根の行を `company.id == actor.company_id`(読み取りは `filters: { id: actor.company_id }`)で結ばなければ error。
 *   子の表が根を指す参照の列を持つときに、根の `id` を重ねて要求しない。死角の warning は遷移も数える。
 * - A4-2: 実行者の集約(`session: true` の欄を持つ集約)を経た祖先の列は境界にしない(人の今の所属であって行のテナントではない)。
 * - A4-3: 未ログインのロールの遷移は、テナントを持つ表では warning(受け入れは `on: [transition]`)。
 * - A4-4: 遷移の受け入れは `events` で名指した遷移にだけ効く(V2 は名指しの接地を見る)。
 *
 * 式の読みは本物のガード式のパーサーを使う。
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { tenantWriteBoundaryVerifier } from '../../../../lib/verify/verifiers/v26-tenant-write-boundary.js';
import { tenantBoundaryVerifier } from '../../../../lib/verify/verifiers/v20-tenant-boundary.js';
import { checkAccessFields } from '../../../../lib/verify/verifiers/v2-access-fields.js';
import {
  accessSpec,
  aggregate,
  createRule,
  entitySpec,
  event,
  field,
  machine,
  readRule,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import type { AccessSpec, ReadFilter, ReadFilterAccept, ReadRule, SpecModel, WriteRule } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';

/** 本物のパーサーを載せた検証の文脈。 */
function realContext(): VerifyContext {
  return { ...stubContext({}).ctx, guards: createGuardServices() };
}

const COMPANY = { kind: 'ref', entity: 'company' } as const;
const ADMIN = { ...role('company_admin', undefined, ['staff_member']), claim: 'staff_member.is_admin' };

/** 受け入れ 1 件。 */
function accept(by: string, column: string, on?: ReadFilterAccept['on'], events?: readonly string[]): ReadFilterAccept {
  return {
    by,
    field: column,
    reason: '理由',
    ...(on === undefined ? {} : { on }),
    ...(events === undefined ? {} : { events }),
    location: { file: 'docs/specs/domain/company/access.md' },
  };
}

/** 根(company)の規則と遷移。 */
interface RootInit {
  readonly reads?: readonly ReadRule[];
  readonly writes?: readonly WriteRule[];
  readonly events?: readonly { readonly id: string; readonly by: readonly string[]; readonly guard?: string }[];
  readonly accepts?: readonly ReadFilterAccept[];
  /** 子の表(store。会社を指す参照の列を持つ)の書き込み。 */
  readonly storeWhen?: string;
}

/** 会社(根)・従業員(実行者の集約)・店舗(子)のモデル。 */
function rootModel(init: RootInit = {}): SpecModel {
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member'), ADMIN],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [
          field('company_id', COMPANY, { required: true, session: true }),
          field('is_admin', { kind: 'boolean' }, { required: true, session: true }),
        ]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'company',
        entity: entitySpec('company', [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' }), field('state', { kind: 'state', machine: 'company' })], {
          company: 'company.id',
        }),
        stateMachines:
          init.events === undefined
            ? []
            : [
                machine({
                  machine: 'company',
                  states: ['active', 'suspended'],
                  events: init.events.map((entry) => event({ id: entry.id, from: ['active'], to: 'suspended', by: entry.by, ...(entry.guard === undefined ? {} : { guard: entry.guard }) })),
                }),
              ],
        access: accessSpec('company', {
          reads: init.reads ?? [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'id', actorField: 'company_id' }] }],
          writes: init.writes ?? [],
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [field('company_id', COMPANY, { required: true })], { company: 'store.company_id' }),
        access: accessSpec('store', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
          ...(init.storeWhen === undefined ? {} : { creates: [createRule('company_admin', init.storeWhen)], writes: [writeRule('company_admin', ['name'], init.storeWhen)] }),
        }),
      }),
    ],
  });
}

/** 指摘を `検査 重さ 集約 種類 遷移 ロール 列 kind` の行にする。 */
function lines(model: SpecModel): string[] {
  const ctx = realContext();
  return [...tenantBoundaryVerifier.verify(model, ctx), ...tenantWriteBoundaryVerifier.verify(model, ctx)].map((finding) => {
    const ce = finding.counterexample ?? {};
    return [finding.verifier, finding.severity, ce['entity'], ce['key'] ?? 'reads', ce['event'] ?? '', ce['by'], ce['column'] ?? ce['rules'], ce['kind'] ?? '']
      .join(' ')
      .replace(/ +/gu, ' ')
      .trim();
  });
}

const BOUND = 'company.id == actor.company_id';

describe('A4-1 境界の根(company)は id を境界の列として扱う', () => {
  const CASES: readonly { readonly name: string; readonly init: RootInit; readonly expected: readonly string[] }[] = [
    { name: '緑: 題材の形(filters: { id: actor.company_id })', init: {}, expected: [] },
    { name: '赤: 読み取りの filters を消す', init: { reads: [readRule('staff_member', { kind: 'all' })] }, expected: ['V20 error company reads staff_member id'] },
    { name: '緑: filters を消しても accept(読み取り・id)で受け入れる', init: { reads: [readRule('staff_member', { kind: 'all' })], accepts: [accept('staff_member', 'id')] }, expected: [] },
    { name: '緑: scope: none は見ない', init: { reads: [readRule('staff_member', { kind: 'none' })] }, expected: [] },
    { name: '赤: 管理者の writes を when なしで足す', init: { writes: [writeRule('company_admin', ['name'])] }, expected: ['V26 error company writes company_admin id'] },
    { name: '緑: writes の when が company.id == actor.company_id', init: { writes: [writeRule('company_admin', ['name'], BOUND)] }, expected: [] },
    { name: '緑: 辺を入れ替えた等式', init: { writes: [writeRule('company_admin', ['name'], 'actor.company_id == company.id')] }, expected: [] },
    { name: '赤: or の片側だけ', init: { writes: [writeRule('company_admin', ['name'], `${BOUND} or company.name == company.name`)] }, expected: ['V26 error company writes company_admin id'] },
    { name: '赤: id を actor.id と比べる(欄が違う)', init: { writes: [writeRule('company_admin', ['name'], 'company.id == actor.id')] }, expected: ['V26 error company writes company_admin id'] },
    { name: '赤: 書き込みの accept が on を名指さない', init: { writes: [writeRule('company_admin', ['name'])], accepts: [accept('company_admin', 'id')] }, expected: ['V26 error company writes company_admin id'] },
    { name: '赤: 管理者の遷移を guard なしで足す', init: { events: [{ id: 'suspend', by: ['company_admin'] }] }, expected: ['V26 error company events suspend company_admin id'] },
    { name: '緑: 遷移の guard で結ぶ', init: { events: [{ id: 'suspend', by: ['company_admin'], guard: BOUND }] }, expected: [] },
    { name: '緑: システム起点の遷移は見ない', init: { events: [{ id: 'suspend', by: ['system'] }] }, expected: [] },
  ];
  for (const row of CASES) {
    it(row.name, () => {
      expect(lines(rootModel(row.init))).toEqual(row.expected);
    });
  }

  it('子の表は自分の会社の列で結べば足り、根の id を重ねて要求しない(作成・編集とも)', () => {
    expect(lines(rootModel({ storeWhen: 'store.company_id == actor.company_id' }))).toEqual([]);
    expect(lines(rootModel({ storeWhen: 'store.company_id == actor.id' }))).toEqual([
      'V26 error store creates company_admin company_id',
      'V26 error store writes company_admin company_id',
    ]);
  });

  it('文面: 根の when に足す項を company.id で示す', () => {
    const [finding] = tenantWriteBoundaryVerifier.verify(rootModel({ writes: [writeRule('company_admin', ['name'])] }), realContext());
    expect(finding?.suggestion).toContain('company.id == actor.company_id');
  });
});

describe('A4-1 死角の warning は遷移も数える', () => {
  /** 境界の列を導けない集約(note)が遷移だけを持つ。 */
  function noteModel(withEvents: boolean): SpecModel {
    return specModel({
      roles: [role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
          access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'note',
          entity: entitySpec('note', [field('state', { kind: 'state', machine: 'note' })]),
          stateMachines: withEvents ? [machine({ machine: 'note', states: ['open', 'closed'], events: [event({ id: 'close', from: ['open'], to: 'closed', by: ['staff_member'] })] })] : [],
          access: accessSpec('note', {}),
        }),
      ],
    });
  }

  it('遷移だけを持つ集約も warning で名指す(以前は無音)', () => {
    expect(lines(noteModel(true))).toEqual(['V26 warning note reads 遷移']);
  });

  it('規則も遷移も無ければ黙る', () => {
    expect(lines(noteModel(false))).toEqual([]);
  });
});

describe('A4-3 未ログインの遷移はテナントを持つ表で warning', () => {
  const CASES: readonly { readonly name: string; readonly init: RootInit; readonly expected: readonly string[] }[] = [
    { name: '未ログインの遷移 → warning', init: { events: [{ id: 'suspend', by: ['anonymous'] }] }, expected: ['V26 warning company events suspend anonymous id actorless'] },
    { name: 'guard があっても未ログインは結べない → warning', init: { events: [{ id: 'suspend', by: ['anonymous'], guard: 'company.name == company.name' }] }, expected: ['V26 warning company events suspend anonymous id actorless'] },
    {
      name: '遷移を名指した受け入れで消える',
      init: { events: [{ id: 'suspend', by: ['anonymous'] }], accepts: [accept('anonymous', 'id', ['transition'], ['suspend'])] },
      expected: [],
    },
    {
      name: '書き込みの受け入れでは消えない',
      init: { events: [{ id: 'suspend', by: ['anonymous'] }], accepts: [accept('anonymous', 'id', ['write'])] },
      expected: ['V26 warning company events suspend anonymous id actorless'],
    },
    { name: 'システム起点は黙る(入口が対象の行を決める)', init: { events: [{ id: 'suspend', by: ['system'] }] }, expected: [] },
  ];
  for (const row of CASES) {
    it(row.name, () => {
      expect(lines(rootModel(row.init))).toEqual(row.expected);
    });
  }
});

describe('A4-4 遷移の受け入れは events で名指した遷移にだけ効く', () => {
  const both = [
    { id: 'suspend', by: ['company_admin'] },
    { id: 'revoke', by: ['company_admin'] },
  ];

  it('名指した遷移だけが消え、後から足した遷移は error のまま', () => {
    expect(lines(rootModel({ events: both, accepts: [accept('company_admin', 'id', ['transition'], ['suspend'])] }))).toEqual([
      'V26 error company events revoke company_admin id',
    ]);
  });

  it('両方を名指せば両方消える', () => {
    expect(lines(rootModel({ events: both, accepts: [accept('company_admin', 'id', ['transition'], ['suspend', 'revoke'])] }))).toEqual([]);
  });

  it('events の無い on: [transition](パーサーを通らない形)はどの遷移にも効かない', () => {
    expect(lines(rootModel({ events: both, accepts: [accept('company_admin', 'id', ['transition'])] }))).toEqual([
      'V26 error company events suspend company_admin id',
      'V26 error company events revoke company_admin id',
    ]);
  });

  it('文面: 受け入れの例は遷移を名指す', () => {
    const [finding] = tenantWriteBoundaryVerifier.verify(rootModel({ events: [{ id: 'suspend', by: ['company_admin'] }] }), realContext());
    expect(finding?.suggestion).toContain('on: [transition], events: [suspend]');
  });

  it('V2: events の名指しが状態遷移に無ければ error(死んだ受け入れ)', () => {
    const model = rootModel({ events: both, accepts: [accept('company_admin', 'id', ['transition'], ['suspend', 'typo'])] });
    const company = model.aggregates.get('company');
    const findings = checkAccessFields(company?.access as AccessSpec, company?.entity, model);
    expect(findings.map((finding) => finding.message).filter((message) => message.includes('events'))).toEqual([
      'company の accept(by: company_admin)の events typo は、company の状態遷移のうち company_admin が起こせるものにありません',
    ]);
  });
});

describe('A4-2 実行者の集約を経た祖先の列は境界にしない', () => {
  /** 部署(根)・職員(実行者の集約。所属部署)・フォルダ(部署を持つ)・メモ(起案者とフォルダを指す。自分は部署を持たない)。 */
  function memoModel(memo: { readonly filters?: readonly ReadFilter[]; readonly when?: string; readonly folder: boolean }): SpecModel {
    const DEPT = { kind: 'ref', entity: 'department' } as const;
    return specModel({
      roles: [role('staff')],
      aggregates: [
        aggregate({
          name: 'staff',
          entity: entitySpec('staff', [field('department_id', DEPT, { required: true, session: true })], { department: 'staff.department_id' }),
          access: accessSpec('staff', { reads: [readRule('staff', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'folder',
          entity: entitySpec('folder', [field('department_id', DEPT, { required: true })], { department: 'folder.department_id' }),
          access: accessSpec('folder', { reads: [{ ...readRule('staff', { kind: 'all' }), filters: [{ field: 'department_id', actorField: 'department_id' }] }] }),
        }),
        aggregate({
          name: 'memo',
          entity: entitySpec(
            'memo',
            [field('body', { kind: 'string' }), field('author_id', { kind: 'ref', entity: 'staff' }, { required: true }), ...(memo.folder ? [field('folder_id', { kind: 'ref', entity: 'folder' }, { required: true })] : [])],
            { staff: 'memo.author_id', ...(memo.folder ? { folder: 'memo.folder_id' } : {}) },
          ),
          access: accessSpec('memo', {
            reads: [{ ...readRule('staff', { kind: 'all' }), ...(memo.filters === undefined ? {} : { filters: memo.filters }) }],
            ...(memo.when === undefined ? {} : { writes: [writeRule('staff', ['body'], memo.when)] }),
          }),
        }),
      ],
    });
  }
  const BY_AUTHOR: ReadFilter = { entity: 'staff', field: 'department_id', actorField: 'department_id' };
  const BY_FOLDER: ReadFilter = { entity: 'folder', field: 'department_id', actorField: 'department_id' };

  it('読み取り: 起案者の所属で狭めても閉じたことにならない(フォルダの部署で狭めれば閉じる)', () => {
    expect(lines(memoModel({ folder: true, filters: [BY_AUTHOR] }))).toEqual(['V20 error memo reads staff folder.department_id']);
    expect(lines(memoModel({ folder: true, filters: [BY_FOLDER] }))).toEqual([]);
  });

  it('編集: 起案者の所属で結んでも閉じたことにならない(フォルダの部署で結べば閉じる)', () => {
    expect(lines(memoModel({ folder: true, filters: [BY_FOLDER], when: 'staff.department_id == actor.department_id' }))).toEqual([
      'V26 error memo writes staff folder.department_id',
    ]);
    expect(lines(memoModel({ folder: true, filters: [BY_FOLDER], when: 'folder.department_id == actor.department_id' }))).toEqual([]);
  });

  it('行のテナントへの道が起案者しか無ければ、境界を書けない形として止める(黙らない)', () => {
    expect(lines(memoModel({ folder: false, filters: [BY_AUTHOR] }))).toEqual(['V20 error memo reads staff author_id unreachable']);
  });
});
