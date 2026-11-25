/**
 * V12(スナップショット写像)の規約網羅テスト。
 * 対象の要求（domain-spec-writing.md / ADR-0008）:
 *   ① 写像先のエンティティと列が実在し、型が一致する（必須列へ空になりうる値を写していない）
 *   ② 写像先の非 auto 列で写像に現れないものがあれば警告
 *   ③ 写像元のエンティティと列が実在する
 */

import { describe, expect, it } from 'vitest';
import type { EffectDef, SpecModel } from '../../../../lib/model/types.js';
import { snapshotMappingVerifier } from '../../../../lib/verify/verifiers/v12-snapshot-mapping.js';
import type { CopyAccept } from '../../../../lib/model/parse-copy-accept.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  loc,
  machine,
  readRule,
  role,
  specModel,
  stubContext,
} from '../../../helpers/model-builder-v8plus.js';

/** 写像 1 行（location はテストでは見ないので埋め草）。 */
function map(from: string, to: string) {
  return { from, to, location: loc('docs/specs/domain/workshop/states.md', `snapshot.${to}`) };
}

/** snapshot 付きの effects を 1 本だけ持つ機械を作る。 */
function effectWithSnapshot(target: string, fields: readonly ReturnType<typeof map>[]): EffectDef {
  return {
    on: 'publish_public',
    do: ['snapshot_public_workshop'],
    snapshot: {
      to: target,
      fields,
      location: loc('docs/specs/domain/workshop/states.md', 'effects[0].snapshot'),
    },
    location: loc('docs/specs/domain/workshop/states.md', 'effects[0]'),
  };
}

/**
 * 催し（写像元）と公開催し（写像先）を持つモデル。
 *
 * @param fields 写像の行
 * @param publicFields 写像先エンティティの列（省略時は写像がちょうど覆う 2 列）
 */
function model(
  fields: readonly ReturnType<typeof map>[],
  publicFields = [
    field('id', { kind: 'uuid' }, { auto: true }),
    field('title', { kind: 'string' }, { required: true }),
    field('published_at', { kind: 'datetime' }, { required: true }),
  ],
  mirror = true,
): SpecModel {
  const publication = {
    ...machine({
      machine: 'workshop_publication',
      states: ['unpublished', 'published'],
      initial: 'unpublished',
      events: [event({ id: 'publish_public', from: ['unpublished'], to: 'published' })],
    }),
    effects: [effectWithSnapshot('public_workshop', fields)],
  };
  return specModel({
    aggregates: [
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('title', { kind: 'string' }, { required: true }),
          field('description', { kind: 'text' }),
          field('online_url', { kind: 'string' }),
          field('capacity', { kind: 'integer' }, { required: true }),
          field('listing_kind', { kind: 'enum', values: ['full', 'program_sample'] }, { required: true }),
        ]),
        stateMachines: [publication],
      }),
      aggregate({ name: 'public_workshop', entity: { ...entitySpec('public_workshop', publicFields), ...(mirror ? { mirror: true as const } : {}) } }),
    ],
  });
}

const OK_FIELDS = [map('workshop.title', 'title'), map('now', 'published_at')];

describe('V12 ⑤ 写しの宣言(mirror)と写像先(snapshot.to)の双方向', () => {
  it('写像先が mirror: true を宣言していなければ error(snapshot.to を書くだけで削除の免除が付く穴)', () => {
    const findings = snapshotMappingVerifier.verify(model(OK_FIELDS, undefined, false), stubContext().ctx);
    expect(findings).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringContaining('の entity_spec が mirror: true を宣言していません') })]);
  });

  it('mirror: true なのにどの snapshot.to にも現れなければ error', () => {
    const lonely = specModel({
      aggregates: [aggregate({ name: 'public_entry', entity: { ...entitySpec('public_entry', []), mirror: true } })],
    });
    expect(snapshotMappingVerifier.verify(lonely, stubContext().ctx)).toEqual([
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('どの state_spec の snapshot.to にも現れません') }),
    ]);
  });
});

describe('V12 スナップショット写像', () => {
  it('写像が写像先の非 auto 列をちょうど覆っていれば指摘は出ない', () => {
    expect(snapshotMappingVerifier.verify(model(OK_FIELDS), stubContext().ctx)).toEqual([]);
  });

  it('snapshot を持たず、副作用 ID も snapshot_ で始まらない effects は検査しない', () => {
    const bare = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          stateMachines: [
            {
              ...machine({ machine: 'entry', states: ['draft'], initial: 'draft' }),
              effects: [{ on: 'submit', do: ['notify'], location: loc() }],
            },
          ],
        }),
      ],
    });
    expect(snapshotMappingVerifier.verify(bare, stubContext().ctx)).toEqual([]);
  });

  // --- ④ snapshot_ を名前に使いながら snapshot を書いていない(逃げ道の穴。2026-09-04 拡張) ---

  it('副作用 ID が snapshot_ で始まるのに snapshot が無ければエラーにする', () => {
    const evading = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          stateMachines: [
            {
              ...machine({ machine: 'entry', states: ['draft'], initial: 'draft' }),
              effects: [{ on: 'submit', do: ['snapshot_public_entry'], location: loc() }],
            },
          ],
        }),
      ],
    });
    const findings = snapshotMappingVerifier.verify(evading, stubContext().ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('snapshot_public_entry');
    expect(findings[0]?.counterexample?.['do']).toBe('snapshot_public_entry');
  });

  it('同じ effects に snapshot_ で始まらない副作用が混ざっていても、宣言した側の欠落は指摘する', () => {
    const evading = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          stateMachines: [
            {
              ...machine({ machine: 'entry', states: ['draft'], initial: 'draft' }),
              effects: [
                { on: 'submit', do: ['notify_discord', 'snapshot_public_entry'], location: loc() },
              ],
            },
          ],
        }),
      ],
    });
    const findings = snapshotMappingVerifier.verify(evading, stubContext().ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['do']).toBe('snapshot_public_entry');
  });

  // --- ② 覆い漏れ（変異 #10 を塞ぐ観点） ---

  it('写像に現れない列が写像先にあれば警告する', () => {
    const findings = snapshotMappingVerifier.verify(
      model(OK_FIELDS, [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('title', { kind: 'string' }, { required: true }),
        field('published_at', { kind: 'datetime' }, { required: true }),
        field('venue_hire_cost', { kind: 'integer' }),
      ]),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('venue_hire_cost');
    expect(findings[0]?.counterexample?.['uncovered']).toBe('venue_hire_cost');
  });

  it('auto: true の列は覆いの対象から外す（採番・作成日時はシステムが供給する）', () => {
    const findings = snapshotMappingVerifier.verify(
      model(OK_FIELDS, [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('created_at', { kind: 'datetime' }, { auto: true }),
        field('title', { kind: 'string' }, { required: true }),
        field('published_at', { kind: 'datetime' }, { required: true }),
      ]),
      stubContext().ctx,
    );

    expect(findings).toEqual([]);
  });

  // --- ① 写像先 ---

  it('写像先のエンティティが実在しなければエラー', () => {
    // 写像先の集約ごと消したモデルを作る（`aggregates` は読み取り専用なので組み直す）。
    const full = model(OK_FIELDS);
    const broken: SpecModel = {
      roles: full.roles,
      aggregates: new Map([...full.aggregates].filter(([name]) => name !== 'public_workshop')),
    };
    const findings = snapshotMappingVerifier.verify(broken, stubContext().ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('public_workshop が実在しません');
  });

  it('写像先の列が実在しなければエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('workshop.title', 'headline'), map('workshop.title', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('public_workshop.headline が実在しません'),
    ]);
  });

  it('型が食い違えばエラー（列の対応表であって変換ではない）', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('workshop.capacity', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ from_type: 'integer', to_type: 'string' });
  });

  it('ref(entity) と uuid は同じ型として扱う', () => {
    const findings = snapshotMappingVerifier.verify(
      model(
        [map('workshop.id', 'workshop_id'), map('workshop.title', 'title'), map('now', 'published_at')],
        [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('workshop_id', { kind: 'ref', entity: 'workshop' }, { required: true }),
          field('title', { kind: 'string' }, { required: true }),
          field('published_at', { kind: 'datetime' }, { required: true }),
        ],
      ),
      stubContext().ctx,
    );

    expect(findings).toEqual([]);
  });

  it('enum は値の集合まで一致していないとエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model(
        [map('workshop.listing_kind', 'listing_kind'), map('workshop.title', 'title'), map('now', 'published_at')],
        [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('listing_kind', { kind: 'enum', values: ['full'] }, { required: true }),
          field('title', { kind: 'string' }, { required: true }),
          field('published_at', { kind: 'datetime' }, { required: true }),
        ],
      ),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('型が一致しません');
  });

  it('必須の写像先へ空になりうる値を写せばエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('workshop.online_url', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('空になりえます');
  });

  it('同じ列へ 2 本の写像が来ればエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('workshop.title', 'title'), map('workshop.description', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings.some((finding) => finding.message.includes('2 回宣言されています'))).toBe(true);
  });

  // --- ③ 写像元 ---

  it('写像元が 2 段でなければエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('title', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"{entity}.{field}" の形ではありません');
  });

  it('写像元のエンティティが実在しなければエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('venue.name', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('写像元のエンティティ venue が実在しません');
  });

  it('写像元の列が実在しなければエラー', () => {
    const findings = snapshotMappingVerifier.verify(
      model([map('workshop.headline', 'title'), map('now', 'published_at')]),
      stubContext().ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('列 headline が workshop にありません');
  });

  it('写像元は「実在」までを見て「接地」を要求しない（子の行の集まりから写せる）', () => {
    const findings = snapshotMappingVerifier.verify(
      model(
        [map('public_workshop.id', 'title'), map('now', 'published_at')],
        [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('title', { kind: 'uuid' }, { required: true }),
          field('published_at', { kind: 'datetime' }, { required: true }),
        ],
      ),
      stubContext().ctx,
    );

    // workshop の context に public_workshop への解決パスは無いが、実在するので通る。
    expect(findings).toEqual([]);
  });
});

describe('V12 ⑥ 隠し列・個人列の約束は写し先でも保つ(点検 12 回目 A12-2)', () => {
  const pub = 'public_note';
  const accept = (on: CopyAccept['on'], role?: string, reader = role ?? ''): CopyAccept => ({ on, ...(role === undefined ? {} : { role, reader }), reason: '匿名化の変換を通した値が入る', location: loc() });
  const hide = (column: string, from: readonly string[]) => ({ field: column, from, location: loc() });

  interface Init {
    readonly mapped?: ReturnType<typeof map> & { readonly accept?: readonly CopyAccept[] };
    readonly hidden?: readonly string[];
    readonly personal?: boolean;
    readonly targetPersonal?: boolean;
    readonly reads?: ReturnType<typeof accessSpec>['reads'] | null;
    readonly targetHidden?: readonly string[];
    readonly roles?: readonly RoleDef[];
  }

  /** 催しの隠し列(`secret`)を公開の写しへ写すモデル。既定の写し先は未ログインだけが読める。 */
  function exposure(init: Init): SpecModel {
    const reads = init.reads === undefined ? [readRule('guest', { kind: 'all' })] : init.reads;
    const source = entitySpec('article', [field('id', { kind: 'uuid' }, { auto: true }), field('secret', { kind: 'string' }, { personal: init.personal ?? false })]);
    const target = entitySpec(pub, [field('id', { kind: 'uuid' }, { auto: true }), field('secret', { kind: 'string' }, { personal: init.targetPersonal ?? false })]);
    const flow = {
      ...machine({ machine: 'publication', states: ['a', 'b'], initial: 'a', events: [event({ id: 'publish', from: ['a'], to: 'b' })] }),
      effects: [effectWithSnapshot(pub, [init.mapped ?? map('article.secret', 'secret')])],
    };
    return specModel({
      ...(init.roles === undefined ? {} : { roles: init.roles }),
      aggregates: [
        aggregate({ name: 'article', entity: source, stateMachines: [flow], access: accessSpec('article', { reads: [], fieldsHidden: init.hidden === undefined ? [] : [hide('secret', init.hidden)] }) }),
        aggregate({
          name: pub,
          entity: { ...target, mirror: true },
          ...(reads === null ? {} : { access: accessSpec(pub, { reads, fieldsHidden: init.targetHidden === undefined ? [] : [hide('secret', init.targetHidden)] }) }),
        }),
      ],
    });
  }
  const run = (init: Init) => snapshotMappingVerifier.verify(exposure(init), stubContext().ctx);
  const ROLES: readonly RoleDef[] = [role('guest', undefined, undefined, 'anonymous'), role('member', undefined, undefined, 'authenticated_default'), role('staff', undefined, ['member']), role('owner', undefined, [])];

  it.each<{ name: string; init: Init; pattern: RegExp }>([
    { name: '隠した相手本人が写し先を読める(探り台本 S1 の形)', init: { hidden: ['member'], reads: [readRule('member', { kind: 'all' })] }, pattern: /member から隠した列を member の読める列へ写します/u },
    { name: '含意の先のロールで読める', init: { hidden: ['staff'], reads: [readRule('member', { kind: 'all' })], roles: ROLES }, pattern: /by: member で読めます/u },
    { name: '未ログインが読める写し先は誰にでも読める', init: { hidden: ['owner'], reads: [readRule('guest', { kind: 'all' })], roles: ROLES }, pattern: /by: guest で読めます/u },
    { name: 'context / own のスコープも読める', init: { hidden: ['member'], reads: [readRule('member', { kind: 'own' })] }, pattern: /member から隠した列/u },
    { name: '写し先に access_spec が無い(読めないと言えない)', init: { hidden: ['member'], reads: null }, pattern: /access_spec が無く読み手を決められません/u },
    { name: '写し先の隠しが別の相手', init: { hidden: ['member'], reads: [readRule('member', { kind: 'all' })], targetHidden: ['guest'] }, pattern: /member から隠した列/u },
    { name: '個人列を personal: false へ(探り台本 S3 の形)', init: { personal: true }, pattern: /個人列の値を personal: true でない列へ写します/u },
  ])('赤: $name', ({ init, pattern }) => {
    expect(run(init)).toEqual([expect.objectContaining({ severity: 'error', verifier: 'V12', message: expect.stringMatching(pattern) })]);
  });

  it('赤: 隠し列かつ個人列は 2 つとも言う(探り台本 S4 の形)', () => {
    expect(run({ hidden: ['member'], personal: true, reads: [readRule('member', { kind: 'all' })] })).toHaveLength(2);
  });

  it.each<{ name: string; init: Init }>([
    { name: '隠した相手が scope: none', init: { hidden: ['member'], reads: [readRule('member', { kind: 'none' })] } },
    { name: '隠した相手に読み取り規則が無い', init: { hidden: ['member'], reads: [readRule('staff', { kind: 'all' })], roles: [role('member', undefined, undefined, 'authenticated_default'), role('staff')] } },
    { name: '写し先も同じ相手から隠す', init: { hidden: ['member'], reads: [readRule('member', { kind: 'all' })], targetHidden: ['member'] } },
    { name: '含意しない向き(staff が読めても member は読めない)', init: { hidden: ['member'], reads: [readRule('staff', { kind: 'all' })], roles: ROLES } },
    { name: '個人列を personal: true へ(探り台本 S5 の形)', init: { personal: true, targetPersonal: true } },
    { name: '隠していない・個人列でない', init: {} },
  ])('緑: $name', ({ init }) => {
    expect(run(init)).toEqual([]);
  });

  it('受け入れは名指した約束 × 相手にだけ効く', () => {
    const readable = { hidden: ['member', 'staff'], reads: [readRule('member', { kind: 'all' }), readRule('staff', { kind: 'all' })], roles: ROLES };
    const one = run({ ...readable, mapped: { ...map('article.secret', 'secret'), accept: [accept('hidden', 'member')] } });
    expect(one).toEqual([expect.objectContaining({ message: expect.stringContaining('staff から隠した列') }), expect.objectContaining({ message: expect.stringContaining('staff から隠した列') })]);
    expect(run({ ...readable, mapped: { ...map('article.secret', 'secret'), accept: [accept('hidden', 'member'), accept('hidden', 'staff', 'member'), accept('hidden', 'staff', 'staff')] } })).toEqual([]);
    expect(run({ personal: true, mapped: { ...map('article.secret', 'secret'), accept: [accept('personal')] } })).toEqual([]);
    expect(run({ personal: true, hidden: ['guest'], mapped: { ...map('article.secret', 'secret'), accept: [accept('hidden', 'guest')] } })).toEqual([
      expect.objectContaining({ message: expect.stringContaining('個人列の値を') }),
    ]);
  });

  // 点検 13 回目 A13-4: 受け入れは読み手を名指す。後から足した読み手には効かない。
  it('受け入れは名指した読み手にだけ効く(C1: 受け入れの後で未ログインに開く)', () => {
    const accepted = { ...map('article.secret', 'secret'), accept: [accept('hidden', 'member')] };
    expect(run({ hidden: ['member'], reads: [readRule('member', { kind: 'all' })], roles: ROLES, mapped: accepted })).toEqual([]);
    expect(run({ hidden: ['member'], reads: [readRule('member', { kind: 'all' }), readRule('guest', { kind: 'all' })], roles: ROLES, mapped: accepted })).toEqual([
      expect.objectContaining({ message: expect.stringContaining('by: guest で読めます'), suggestion: expect.stringContaining('reader: guest') }),
    ]);
  });

  it.each<{ name: string; init: Init }>([
    { name: '実在しない読み手の受け入れ', init: { hidden: ['member'], reads: [readRule('member', { kind: 'all' })], roles: ROLES, mapped: { ...map('article.secret', 'secret'), accept: [accept('hidden', 'member'), accept('hidden', 'member', 'no_such_role')] } } },
    { name: '読み手の違う受け入れ', init: { hidden: ['member'], reads: [readRule('member', { kind: 'all' })], roles: ROLES, mapped: { ...map('article.secret', 'secret'), accept: [accept('hidden', 'member'), accept('hidden', 'member', 'guest')] } } },
    { name: '崩れていない行の受け入れ', init: { mapped: { ...map('article.secret', 'secret'), accept: [accept('personal')] } } },
    { name: '相手の違う受け入れ', init: { hidden: ['guest'], mapped: { ...map('article.secret', 'secret'), accept: [accept('hidden', 'guest'), accept('hidden', 'member')] } } },
  ])('赤: 腐った受け入れ — $name', ({ init }) => {
    expect(run(init)).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringContaining('崩れる約束を名指していません') })]);
  });

  it('赤: from: now の行の受け入れも腐っている', () => {
    const found = run({ reads: [readRule('guest', { kind: 'all' })], mapped: { ...map('now', 'secret'), accept: [accept('personal')] } });
    expect(found.some((finding) => finding.message.includes('崩れる約束を名指していません'))).toBe(true);
  });
});
