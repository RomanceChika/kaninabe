/**
 * V11(ロール接地)の規約網羅テスト。
 * 対象の要求: by / reads.by / creates.by / writes.by / deletes.by のロールが roles.md に定義済みであること、
 * 文脈依存ロールを使う集約から binding 参照先へ context を 2 段までで辿れること、
 * binding が `actor.id` 以外の実行者の属性と比べていないこと(束 ⑲-2a)。
 */

import { describe, expect, it } from 'vitest';
import { roleGroundingVerifier } from '../../../../lib/verify/verifiers/v11-role-grounding.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
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

const ORGANIZER_BINDING = 'workshop.organizer_ids contains actor.id';
const PERFORMER_BINDING = 'entry.performer_id == actor.id';

/** entry 集約に「イベントの by / reads / writes」を差し込むモデル。 */
function model(init: {
  by?: readonly string[];
  reads?: readonly ReturnType<typeof readRule>[];
  creates?: readonly ReturnType<typeof createRule>[];
  deletes?: readonly ReturnType<typeof deleteRule>[];
  writes?: readonly ReturnType<typeof writeRule>[];
  context?: Readonly<Record<string, string>>;
  withEntity?: boolean;
}) {
  const entity = entitySpec(
    'entry',
    [field('performer_id', { kind: 'ref', entity: 'member' })],
    init.context ?? {},
  );
  return specModel({
    roles: [role('member'), role('organizer', ORGANIZER_BINDING), role('performer', PERFORMER_BINDING)],
    aggregates: [
      aggregate({
        name: 'entry',
        ...((init.withEntity ?? true) ? { entity } : {}),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: init.by ?? ['member'] }),
            ],
          }),
        ],
        access: accessSpec('entry', {
          ...(init.reads === undefined ? {} : { reads: init.reads }),
          ...(init.creates === undefined ? {} : { creates: init.creates }),
          ...(init.deletes === undefined ? {} : { deletes: init.deletes }),
          ...(init.writes === undefined ? {} : { writes: init.writes }),
        }),
      }),
    ],
  });
}

describe('roleGroundingVerifier', () => {
  it('未定義ロールを by に書いたらエラーにする', () => {
    const { ctx } = stubContext({});

    const findings = roleGroundingVerifier.verify(model({ by: ['reviewer'] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V11');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('reviewer');
    expect(findings[0]?.message).toContain('roles.md に定義されていません');
    expect(findings[0]?.location.pointer).toBe('events.submit');
    expect(findings[0]?.suggestion).toContain('reviewer');
    expect(findings[0]?.counterexample).toMatchObject({ role: 'reviewer', used_at: 'entry.submit の by' });
  });

  it('未定義ロールを reads / writes に書いたらエラーにする', () => {
    const { ctx } = stubContext({});
    const target = model({
      reads: [readRule('ghost', { kind: 'all' })],
      writes: [writeRule('phantom', ['title'])],
    });

    const findings = roleGroundingVerifier.verify(target, ctx);

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.counterexample?.role)).toEqual(['ghost', 'phantom']);
  });

  it('未定義ロールを creates に書いたらエラーにする', () => {
    const { ctx } = stubContext({});

    const findings = roleGroundingVerifier.verify(model({ creates: [createRule('ghost')] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ role: 'ghost', used_at: 'entry の creates' });
  });

  it('creates は権限を与えるので文脈依存ロールの context 解決を要求する', () => {
    const { ctx } = stubContext({});

    const findings = roleGroundingVerifier.verify(model({ creates: [createRule('organizer')] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({
      used_at: 'entry の creates',
      missing_context: 'workshop',
    });
  });

  it('未定義ロールを deletes に書いたらエラーにする', () => {
    const { ctx } = stubContext({});

    const findings = roleGroundingVerifier.verify(model({ deletes: [deleteRule('ghost')] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ role: 'ghost', used_at: 'entry の deletes' });
  });

  it('deletes は権限を与えるので文脈依存ロールの context 解決を要求する', () => {
    const { ctx } = stubContext({});

    const findings = roleGroundingVerifier.verify(model({ deletes: [deleteRule('organizer')] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({
      used_at: 'entry の deletes',
      missing_context: 'workshop',
    });
  });

  it('定義済みロールのみを使い、context も揃っていれば違反なし', () => {
    const { ctx } = stubContext({});
    const target = model({
      by: ['organizer', 'performer'],
      context: { workshop: 'entry.workshop_id' },
      reads: [readRule('organizer', { kind: 'context', entity: 'workshop' })],
    });

    expect(roleGroundingVerifier.verify(target, ctx)).toEqual([]);
  });

  it('文脈依存ロールを使うのに context に解決パスが無ければエラー', () => {
    const { ctx } = stubContext({});

    const findings = roleGroundingVerifier.verify(model({ by: ['organizer'] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('entry から workshop へ context を 2 段までで辿れません');
    expect(findings[0]?.suggestion).toContain('workshop');
    expect(findings[0]?.counterexample).toMatchObject({
      role: 'organizer',
      binding: ORGANIZER_BINDING,
      missing_context: 'workshop',
    });
  });

  it('**2 段先**の context でも辿れれば通る(中継の宣言を辿る。束 ⑲-2a)', () => {
    const { ctx } = stubContext({});
    // entry は workshop を直接持たないが、slot を経由して 2 段で届く。
    const target = specModel({
      roles: [role('member'), role('organizer', ORGANIZER_BINDING)],
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec('entry', [field('slot_id', { kind: 'ref', entity: 'slot' })], {
            slot: 'entry.slot_id',
          }),
          stateMachines: [
            machine({
              machine: 'entry',
              states: ['draft', 'submitted'],
              events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['organizer'] })],
            }),
          ],
        }),
        aggregate({
          name: 'slot',
          entity: entitySpec('slot', [field('workshop_id', { kind: 'ref', entity: 'workshop' })], {
            workshop: 'slot.workshop_id',
          }),
        }),
        aggregate({ name: 'workshop', entity: entitySpec('workshop', [field('organizer_ids', { kind: 'string' })], {}) }),
      ],
    });

    expect(roleGroundingVerifier.verify(target, ctx)).toEqual([]);
  });

  it('**2 段先へ 2 通りの経路**があればエラー(中継が違えば指す行も違う。束 ⑲-2a)', () => {
    const { ctx } = stubContext({});
    // entry は workshop を直接持たないが、slot 経由でも venue 経由でも 2 段で届く。
    const target = specModel({
      roles: [role('member'), role('organizer', ORGANIZER_BINDING)],
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec(
            'entry',
            [
              field('slot_id', { kind: 'ref', entity: 'slot' }),
              field('venue_id', { kind: 'ref', entity: 'venue' }),
            ],
            { slot: 'entry.slot_id', venue: 'entry.venue_id' },
          ),
          stateMachines: [
            machine({
              machine: 'entry',
              states: ['draft', 'submitted'],
              events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['organizer'] })],
            }),
          ],
        }),
        aggregate({
          name: 'slot',
          entity: entitySpec('slot', [field('workshop_id', { kind: 'ref', entity: 'workshop' })], {
            workshop: 'slot.workshop_id',
          }),
        }),
        aggregate({
          name: 'venue',
          entity: entitySpec('venue', [field('workshop_id', { kind: 'ref', entity: 'workshop' })], {
            workshop: 'venue.workshop_id',
          }),
        }),
        aggregate({ name: 'workshop', entity: entitySpec('workshop', [field('organizer_ids', { kind: 'string' })], {}) }),
      ],
    });

    const findings = roleGroundingVerifier.verify(target, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('context を辿る経路が 2 通りあります');
    expect(findings[0]?.counterexample?.['routes']).toBe('entry → slot → workshop / entry → venue → workshop');
  });

  it('直接の宣言があれば 2 段先の経路があっても曖昧にならない(名指しが勝つ)', () => {
    const { ctx } = stubContext({});
    const target = specModel({
      roles: [role('member'), role('organizer', ORGANIZER_BINDING)],
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec(
            'entry',
            [
              field('slot_id', { kind: 'ref', entity: 'slot' }),
              field('workshop_id', { kind: 'ref', entity: 'workshop' }),
            ],
            { slot: 'entry.slot_id', workshop: 'entry.workshop_id' },
          ),
          stateMachines: [
            machine({
              machine: 'entry',
              states: ['draft', 'submitted'],
              events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['organizer'] })],
            }),
          ],
        }),
        aggregate({
          name: 'slot',
          entity: entitySpec('slot', [field('workshop_id', { kind: 'ref', entity: 'workshop' })], {
            workshop: 'slot.workshop_id',
          }),
        }),
        aggregate({ name: 'workshop', entity: entitySpec('workshop', [field('organizer_ids', { kind: 'string' })], {}) }),
      ],
    });

    expect(roleGroundingVerifier.verify(target, ctx)).toEqual([]);
  });

  it('binding が actor.{id 以外} を参照していたらエラー(スコープ条件も `permit` も写せない)', () => {
    const { ctx } = stubContext({});
    const target = specModel({
      roles: [role('member'), role('tenant_staff', 'entry.company_id == actor.company_id')],
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec('entry', [field('company_id', { kind: 'ref', entity: 'company' })], {}),
        }),
      ],
    });

    const findings = roleGroundingVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V11');
    expect(findings[0]?.message).toContain('binding が actor.company_id を参照しています');
    expect(findings[0]?.suggestion).toContain('reads[].filters');
  });

  it('binding が自エンティティのみを参照する文脈依存ロールは context 不要(境界)', () => {
    const { ctx } = stubContext({});

    expect(roleGroundingVerifier.verify(model({ by: ['performer'] }), ctx)).toEqual([]);
  });

  it('グローバルロール(binding 無し)は context を要求しない', () => {
    const { ctx } = stubContext({});

    expect(roleGroundingVerifier.verify(model({ by: ['member'] }), ctx)).toEqual([]);
  });

  it('scope: none の reads は権限を与えないので context 解決を要求しない(境界)', () => {
    const { ctx } = stubContext({});
    const target = model({ reads: [readRule('organizer', { kind: 'none' })] });

    expect(roleGroundingVerifier.verify(target, ctx)).toEqual([]);
  });

  it('scope: none でない reads は context 解決を要求する', () => {
    const { ctx } = stubContext({});
    const target = model({ reads: [readRule('organizer', { kind: 'context', entity: 'workshop' })] });

    const findings = roleGroundingVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ used_at: 'entry の reads' });
  });

  it('entity_spec が無い集約で文脈依存ロールを使えばエラー', () => {
    const { ctx } = stubContext({});
    const target = model({ by: ['organizer'], withEntity: false });

    const findings = roleGroundingVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing_context: 'workshop' });
  });

  it('パースできない binding は接地判定を保留する', () => {
    const { ctx } = stubContext({ unparsable: { [ORGANIZER_BINDING]: '構文エラー' } });

    expect(roleGroundingVerifier.verify(model({ by: ['organizer'] }), ctx)).toEqual([]);
  });

  it('binding が複数エンティティを参照するなら不足分だけ報告する', () => {
    const { ctx } = stubContext({
      paths: { [ORGANIZER_BINDING]: ['workshop.organizer_ids', 'venue.owner_id', 'actor.id'] },
    });
    const target = model({ by: ['organizer'], context: { workshop: 'entry.workshop_id' } });

    const findings = roleGroundingVerifier.verify(target, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ missing_context: 'venue' });
  });
});

/**
 * `claim`(実行者自身の行の欄が根拠のロール)の接地。束 ⑰。
 *
 * 指せるのは「`session: true` を宣言した boolean の欄」だけである —— セッションに載る値でなければ
 * 実行器が DB を読まずに解決できず、boolean でなければ「立つ / 立たない」を仕組み側が推測で決める。
 */
describe('V11 claim ロールの接地', () => {
  /** `claim` を持つロール 1 つと、その欄を持つ member 集約。 */
  function claimModel(claim: string, sessionField: ReturnType<typeof field>) {
    return specModel({
      roles: [role('anonymous'), role('member'), role('system'), { id: 'staff', claim, location: { file: 'r.md' } }],
      aggregates: [aggregate({ name: 'member', entity: entitySpec('member', [sessionField]) })],
    });
  }

  it('session: true の boolean の欄を指していれば通す', () => {
    const { ctx } = stubContext();
    const model = claimModel('member.is_staff', field('is_staff', { kind: 'boolean' }, { session: true }));

    expect(roleGroundingVerifier.verify(model, ctx)).toEqual([]);
  });

  it('実在しない欄を指していれば落とす', () => {
    const { ctx } = stubContext();
    const model = claimModel('member.nowhere', field('is_staff', { kind: 'boolean' }, { session: true }));
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('という欄がありません');
  });

  it('session: true を宣言していない欄は落とす(DB を読まずに解決できない)', () => {
    const { ctx } = stubContext();
    const model = claimModel('member.is_staff', field('is_staff', { kind: 'boolean' }));
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('session: true を宣言していません');
  });

  it('boolean でない欄は落とす(真偽の作り方を仕組みが発明しない)', () => {
    const { ctx } = stubContext();
    const model = claimModel('member.display_name', field('display_name', { kind: 'string' }, { session: true }));
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('boolean / enum / state ではありません');
  });
});

/**
 * 対象の行から立つロール(`binding` / `claim`)の**含意先**。束 ⑳-3b。
 *
 * DB が見るのは「実行者が渡すロールの配列」だけであり、その配列は保存点では手順ごとの和に
 * なる —— 行から立ったロールが素の特権ロールを含意すると、後段の手順で成立した束縛が前段の
 * 手順のロール判定を通す(⑳-3 の独立レビュー 2-A)。
 */
describe('V11 binding / claim ロールの含意先', () => {
  /** 素のロール(`kind` を持たない)1 つと、それを含意する行由来のロール。 */
  function impliesModel(init: { readonly binding?: string; readonly claim?: string; readonly implies: readonly string[] }) {
    const rowRole: ReturnType<typeof role> = {
      id: 'row_role',
      ...(init.binding === undefined ? {} : { binding: init.binding }),
      ...(init.claim === undefined ? {} : { claim: init.claim }),
      implies: init.implies,
      location: { file: 'roles.md' },
    };
    return specModel({
      roles: [
        role('anonymous'),
        role('member'),
        role('system'),
        // `kind` も `binding` も `claim` も持たない素の特権ロール。
        { id: 'privileged', implies: ['member'], location: { file: 'roles.md' } },
        rowRole,
      ],
      aggregates: [
        aggregate({ name: 'member', entity: entitySpec('member', [field('is_staff', { kind: 'boolean' }, { session: true })]) }),
      ],
    });
  }

  it('kind を持つロールだけを含意していれば通す', () => {
    const { ctx } = stubContext();
    const model = impliesModel({ binding: 'member.id == actor.id', implies: ['member'] });

    expect(roleGroundingVerifier.verify(model, ctx)).toEqual([]);
  });

  it('binding のロールが素の特権ロールを含意していれば落とす', () => {
    const { ctx } = stubContext();
    const model = impliesModel({ binding: 'member.id == actor.id', implies: ['privileged'] });
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('privileged');
    expect(findings[0]?.message).toContain('含意できるのは kind を持つロールだけです');
  });

  it('claim のロールでも同じ(根拠が対象の行か実行者自身の行かは問わない)', () => {
    const { ctx } = stubContext();
    const model = impliesModel({ claim: 'member.is_staff', implies: ['privileged'] });
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ role: 'row_role', implies: 'privileged' });
  });

  it('2 段先で素のロールに届く宣言も落とす(配列は推移閉包で閉じる)', () => {
    const { ctx } = stubContext();
    // row_role → member(kind あり)→ …ではなく、privileged を経由する形を作る。
    const base = impliesModel({ binding: 'member.id == actor.id', implies: ['relay'] });
    const model = specModel({
      roles: [...base.roles.roles, { id: 'relay', kind: 'system', implies: ['privileged'], location: { file: 'roles.md' } }],
      aggregates: [...base.aggregates.values()].map((specs) => aggregate({ name: 'member', ...(specs.entity === undefined ? {} : { entity: specs.entity }) })),
    });
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('privileged');
  });
});

/**
 * `claim` が state / enum の値の集合を指す形(ADR-0018 の E1)。
 *
 * 値は欄の値域になければならない —— 綴りが違うと**誰にも立たないロール**になり、黙って全員を締め出す。
 */
describe('V11 claim ロールの接地 — state / enum の値', () => {
  const STATES: readonly string[] = ['guest', 'active', 'suspended'];

  /** state / enum の欄を持つ member 集約と、`claim` を持つロール。 */
  function stateModel(claim: { claim: string; claimValues?: readonly string[]; kind?: 'authenticated_default' }, type: 'state' | 'enum' = 'enum') {
    const fieldType = type === 'enum' ? { kind: 'enum' as const, values: STATES } : { kind: 'state' as const, machine: 'member' };
    return specModel({
      roles: [
        role('anonymous'),
        role('member'),
        role('system'),
        { id: 'active_member', ...claim, location: { file: 'r.md' } },
      ],
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [field('state', fieldType, { session: true })]),
          stateMachines: [machine({ machine: 'member', states: STATES, initial: 'guest' })],
        }),
      ],
    });
  }

  it('enum の欄の値が値域にあれば通す', () => {
    const { ctx } = stubContext();
    expect(roleGroundingVerifier.verify(stateModel({ claim: 'member.state', claimValues: ['active'] }), ctx)).toEqual([]);
  });

  it('state の欄でも、集合のどの値も状態機械の状態にあれば通す', () => {
    const { ctx } = stubContext();
    const model = stateModel({ claim: 'member.state', claimValues: ['active', 'suspended'] }, 'state');
    expect(roleGroundingVerifier.verify(model, ctx)).toEqual([]);
  });

  it('kind: authenticated_default と併記しても通す', () => {
    const { ctx } = stubContext();
    const model = stateModel({ claim: 'member.state', claimValues: ['active'], kind: 'authenticated_default' });
    expect(roleGroundingVerifier.verify(model, ctx).filter((finding) => finding.message.includes('claim'))).toEqual([]);
  });

  it('値域にない値(綴り違い)は落とす', () => {
    const { ctx } = stubContext();
    const findings = roleGroundingVerifier.verify(stateModel({ claim: 'member.state', claimValues: ['activ'] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('activ は member.state の値域(guest / active / suspended)にありません');
    expect(findings[0]?.counterexample).toMatchObject({ claim: 'member.state == activ' });
  });

  it('値が 1 つでも値域になければ、その値だけを名指す', () => {
    const { ctx } = stubContext();
    const findings = roleGroundingVerifier.verify(stateModel({ claim: 'member.state', claimValues: ['active', 'gone'] }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('(gone は member.state の値域');
  });

  it('enum / state の欄に値を添えない claim は落とす(真偽の作り方を仕組みが発明しない)', () => {
    const { ctx } = stubContext();
    const findings = roleGroundingVerifier.verify(stateModel({ claim: 'member.state' }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('enum の欄なので、立つ値を添えます');
  });

  it('boolean の欄に値を添えたら落とす', () => {
    const { ctx } = stubContext();
    const model = specModel({
      roles: [role('anonymous'), role('member'), role('system'), { id: 'staff', claim: 'member.is_staff', claimValues: ['true'], location: { file: 'r.md' } }],
      aggregates: [aggregate({ name: 'member', entity: entitySpec('member', [field('is_staff', { kind: 'boolean' }, { session: true })]) })],
    });
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('boolean の欄なので値は書けません');
  });

  it('状態機械が定義されていない state の欄は落とす', () => {
    const { ctx } = stubContext();
    const model = specModel({
      roles: [role('anonymous'), role('member'), role('system'), { id: 'active_member', claim: 'member.state', claimValues: ['active'], location: { file: 'r.md' } }],
      aggregates: [aggregate({ name: 'member', entity: entitySpec('member', [field('state', { kind: 'state', machine: 'ghost' }, { session: true })]) })],
    });
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('状態機械が定義されていません');
  });

  it('値の集合を持つ claim ロールも、素のロールを含意すれば含意先の検査で落ちる(条件つきでも同じ穴)', () => {
    const { ctx } = stubContext();
    const base = stateModel({ claim: 'member.state', claimValues: ['active'] });
    const model = {
      ...base,
      roles: {
        ...base.roles,
        roles: [...base.roles.roles.map((r) => (r.id === 'active_member' ? { ...r, implies: ['privileged'] } : r)), role('privileged')],
      },
    };
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings.some((finding) => finding.message.includes('含意できるのは kind を持つロールだけ'))).toBe(true);
  });

  it('値の集合が値域を全部含む条件は、常に真で何も絞らず負例を立てられないので落とす', () => {
    const { ctx } = stubContext();
    const findings = roleGroundingVerifier.verify(
      stateModel({ claim: 'member.state', claimValues: ['guest', 'active', 'suspended'] }),
      ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('値域(guest / active / suspended)を全部含むので、条件が常に真です');
  });

  it('自分の claim と含意の先の claim が同じ欄で矛盾する(共通の値が無い)ロールは、誰にも立たないので落とす', () => {
    const { ctx } = stubContext();
    const base = stateModel({ claim: 'member.state', claimValues: ['suspended'] });
    const login = { ...role('member'), kind: 'authenticated_default' as const, claim: 'member.state', claimValues: ['active'] };
    const model = {
      ...base,
      roles: {
        ...base.roles,
        roles: [
          ...base.roles.roles.filter((r) => r.id !== 'member').map((r) => (r.id === 'active_member' ? { ...r, implies: ['member'] } : r)),
          login,
        ],
      },
    };
    const findings = roleGroundingVerifier.verify(model, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('active_member の条件(suspended)と member の条件(active)が欄 state で矛盾しています');
  });

  it('共通の値があれば矛盾ではない(含意の先の条件を狭めるだけ)・欄が違えば矛盾しない', () => {
    const { ctx } = stubContext();
    const base = stateModel({ claim: 'member.state', claimValues: ['active', 'suspended'] });
    const login = { ...role('member'), kind: 'authenticated_default' as const, claim: 'member.state', claimValues: ['active', 'guest'] };
    const model = {
      ...base,
      roles: {
        ...base.roles,
        roles: [
          ...base.roles.roles.filter((r) => r.id !== 'member').map((r) => (r.id === 'active_member' ? { ...r, implies: ['member'] } : r)),
          login,
        ],
      },
    };
    expect(roleGroundingVerifier.verify(model, ctx)).toEqual([]);
  });
});
