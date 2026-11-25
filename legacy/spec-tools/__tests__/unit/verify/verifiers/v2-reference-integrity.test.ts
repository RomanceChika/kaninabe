import { describe, expect, it } from 'vitest';

import { referenceIntegrityVerifier } from '../../../../lib/verify/verifiers/v2-reference-integrity.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import {
  accessSpec,
  aggregate,
  create,
  del,
  effect,
  entitySpec,
  event,
  field,
  forbidden,
  machine,
  read,
  role,
  roleSpec,
  specModel,
  stubGuards,
  write,
} from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const ctx: VerifyContext = { guards: stubGuards(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

function run(model: SpecModel) {
  return referenceIntegrityVerifier.verify(model, ctx);
}

/** workshop 集約(entry の guard 参照先)。 */
function workshopAggregate() {
  return aggregate('workshop', {
    entity: entitySpec('workshop', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('organizer_ids', { kind: 'string' }),
        // 日時の欄。`now` と比べられる唯一の型である(V2 は比較の型一致も見る)。
        field('opens_at', { kind: 'datetime' }),
        field('state', { kind: 'state', machine: 'workshop' }),
      ],
    }),
    stateMachines: [
      machine('workshop', {
        states: ['accepting', 'closed'],
        initial: 'accepting',
        events: [event('close', { from: ['accepting'], to: 'closed' })],
      }),
    ],
  });
}

/**
 * 参照がすべて解決できる健全なモデル。
 * 個別テストは entry 集約だけを差し替えて壊す。
 */
function healthyModel(overrides: { readonly entryGuard?: string } = {}): SpecModel {
  const entry = aggregate('entry', {
    entity: entitySpec('entry', {
      context: { workshop: 'entry.workshop_id' },
      fields: [
        field('workshop_id', { kind: 'ref', entity: 'workshop' }, { required: true }),
        field('title', { kind: 'string' }),
        field('draft_flag', { kind: 'boolean' }),
        field('state', { kind: 'state', machine: 'entry' }),
      ],
    }),
    stateMachines: [
      machine('entry', {
        states: ['draft', 'submitted'],
        initial: 'draft',
        events: [
          event('submit', {
            from: ['draft'],
            to: 'submitted',
            guard: overrides.entryGuard ?? 'workshop.state == accepting',
          }),
        ],
        effects: [effect('submit', ['notify_discord_organizer'])],
      }),
    ],
    access: accessSpec('entry', { writes: [write('performer', ['title'], 'state == draft')] }),
  });
  return specModel(
    [entry, workshopAggregate()],
    roleSpec(['member', role('organizer', 'workshop.organizer_ids contains actor.id')]),
  );
}

/**
 * 親の列で境界を書くモデル(棚 → 店舗。棚は会社の列を持たず、店舗が持つ)。
 *
 * @param filters 棚の reads の境界
 */
function shelfModel(filters: Readonly<Record<string, string>>): SpecModel {
  const base = tenantModel({ filters: { company_id: 'company_id' } });
  const shelf = aggregate('shelf', {
    entity: entitySpec('shelf', {
      context: { shelf: 'shelf.id', store: 'shelf.store_id' },
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('store_id', { kind: 'ref', entity: 'store' }, { required: true }),
      ],
    }),
    access: accessSpec('shelf', { reads: [read('member', 'all', filters)] }),
  });
  return { ...base, aggregates: new Map([...base.aggregates, ['shelf', shelf]]) };
}

/**
 * テナント境界を宣言したモデル(会社 → 従業員 → 店舗)。
 *
 * `staff_member.company_id` だけが `session: true` であり、`nickname` はそうでない ——
 * 「セッションに載る欄だけが実行者の属性として引ける」という接地をこの 1 対で試す。
 */
function tenantModel(overrides: {
  readonly filters?: Readonly<Record<string, string>>;
  readonly actorField?: string;
  /** 読み取りに足す行の状態の条件(`reads[].when`。束 §14)。 */
  readonly when?: string;
}): SpecModel {
  const staff = aggregate('staff_member', {
    entity: entitySpec('staff_member', {
      fields: [
        field('id', { kind: 'uuid' }),
        field('company_id', { kind: 'ref', entity: 'company' }, { session: true }),
        field('nickname', { kind: 'string' }),
      ],
    }),
    access: accessSpec('staff_member', { reads: [read('member', 'all')] }),
  });
  const storeAccess =
    overrides.filters === undefined && overrides.when === undefined
      ? accessSpec('store', {
          reads: [read('member', 'all')],
          creates: [create('member', `store.company_id == actor.${overrides.actorField ?? 'company_id'}`)],
        })
      : accessSpec('store', { reads: [read('member', 'all', overrides.filters, overrides.when)] });
  const store = aggregate('store', {
    entity: entitySpec('store', {
      fields: [
        field('id', { kind: 'uuid' }),
        field('company_id', { kind: 'ref', entity: 'company' }),
        field('closed', { kind: 'boolean' }),
        field('opened_at', { kind: 'datetime' }),
        // 可視性の条件(`reads[].when`)が読む状態の欄(束 §14)。
        field('state', { kind: 'state', machine: 'store' }),
      ],
    }),
    stateMachines: [machine('store', { states: ['open', 'closed'], initial: 'open' })],
    access: storeAccess,
  });
  const company = aggregate('company', {
    entity: entitySpec('company', { fields: [field('id', { kind: 'uuid' })] }),
  });
  return specModel([staff, store, company], roleSpec(['member']));
}

describe('V2 参照整合', () => {
  it('参照がすべて解決できるモデルでは違反を出さない', () => {
    expect(run(healthyModel())).toEqual([]);
  });

  describe('state(machine) / ref(entity) の実在', () => {
    it('未定義の状態機械を指す state(...) を検出する', () => {
      const model = specModel([
        aggregate('entry', {
          entity: entitySpec('entry', {
            fields: [field('state', { kind: 'state', machine: 'unknown_machine' })],
          }),
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('状態機械 unknown_machine が未定義');
      expect(findings[0]?.suggestion).toContain('unknown_machine');
      expect(findings[0]?.counterexample).toEqual({
        entity: 'entry',
        field: 'state',
        machine: 'unknown_machine',
      });
      expect(findings[0]?.location.pointer).toBe('fields.state');
    });

    it('未定義のエンティティを指す ref(...) を検出する', () => {
      const model = specModel([
        aggregate('entry', {
          entity: entitySpec('entry', {
            fields: [field('member_id', { kind: 'ref', entity: 'member' })],
          }),
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('エンティティ member が未定義');
      expect(findings[0]?.counterexample?.ref).toBe('member');
    });
  });

  describe('guard / when / binding の path 解決', () => {
    it('context に無いエンティティを参照する guard を検出する', () => {
      const findings = run(healthyModel({ entryGuard: 'venue.state == open' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe(
        'entry.submit の guard が参照する venue.state: entry の context に venue がありません' +
          '(参照できるのは 起点 のフィールドと context で解決できるパスだけです)',
      );
      expect(findings[0]?.suggestion).toContain('context');
      expect(findings[0]?.counterexample).toEqual({
        owner: 'entry.submit',
        kind: 'guard',
        path: 'venue.state',
      });
      expect(findings[0]?.location.pointer).toBe('events.submit');
    });

    it('参照先エンティティに存在しないフィールドを検出する', () => {
      const findings = run(healthyModel({ entryGuard: 'workshop.deadline_at < now' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('workshop にフィールド deadline_at がありません');
    });

    it('予約語 actor / now と自エンティティのフィールドは解決できる', () => {
      const findings = run(
        healthyModel({
          entryGuard: 'entry.title != none and now > workshop.opens_at or state == draft',
        }),
      );

      expect(findings).toEqual([]);
    });

    it('比較の右辺に現れるパスも解決対象にする', () => {
      const findings = run(healthyModel({ entryGuard: 'now < workshop.deadline_at' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe(
        'entry.submit の guard が参照する workshop.deadline_at: workshop にフィールド deadline_at がありません',
      );
      expect(findings[0]?.counterexample?.path).toBe('workshop.deadline_at');
    });

    it('解決できる右辺パス(context 経由 / actor)は違反にしない', () => {
      const findings = run(
        healthyModel({
          entryGuard: 'now >= workshop.opens_at and entry.workshop_id == actor.id',
        }),
      );

      expect(findings).toEqual([]);
    });

    it('集約ディレクトリ名がエンティティ名と違っても、ディレクトリ名を起点にした自己参照が解決できる(resolveEntityPath への統合で修正)', () => {
      // 集約ディレクトリ名(第 1 引数 'entry_aggregate')と entity.entity('entry')が食い違う形。
      // resolveEntityPath へ寄せる前は、ここが entity.entity しか自エンティティ扱いしておらず、
      // V10 / S5 / semantics/query-filter-path.ts(origin も自エンティティ扱いにする)と可否が反転していた。
      const model = specModel([
        aggregate('entry_aggregate', {
          entity: entitySpec('entry', {
            fields: [
              field('title', { kind: 'string' }),
              field('state', { kind: 'state', machine: 'entry' }),
            ],
          }),
          stateMachines: [
            machine('entry', {
              states: ['draft', 'submitted'],
              initial: 'draft',
              events: [
                event('submit', {
                  from: ['draft'],
                  to: 'submitted',
                  // 起点(集約ディレクトリ名)を冠した完全形での自己参照。
                  guard: 'entry_aggregate.title != none',
                }),
              ],
            }),
          ],
        }),
      ]);

      expect(run(model)).toEqual([]);
    });

    it('access_spec の when に現れる未知フィールドを検出する', () => {
      const model = specModel([
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('title', { kind: 'string' })] }),
          access: accessSpec('entry', { writes: [write('performer', ['title'], 'stage == final')] }),
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('entry の writes(by: performer) の when');
      expect(findings[0]?.counterexample?.kind).toBe('when');
    });

    it('access_spec の creates.when に現れる未知フィールドを検出する', () => {
      const model = specModel([
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('title', { kind: 'string' })] }),
          access: accessSpec('entry', { creates: [create('member', 'stage == accepting')] }),
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('entry の creates(by: member) の when');
      expect(findings[0]?.counterexample?.path).toBe('stage');
    });

    it('access_spec の deletes.when に現れる未知フィールドを検出する', () => {
      const model = specModel([
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('title', { kind: 'string' })] }),
          access: accessSpec('entry', { deletes: [del('performer', 'stage == draft')] }),
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('entry の deletes(by: performer) の when');
      expect(findings[0]?.counterexample?.path).toBe('stage');
    });

    it('roles.md の binding が未定義エンティティを参照する場合を検出する', () => {
      const model = specModel(
        [],
        roleSpec([role('organizer', 'venue.owner_ids contains actor.id')]),
      );

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('ロール organizer の binding が参照する venue.owner_ids');
      expect(findings[0]?.counterexample?.kind).toBe('binding');
    });

    it('3 段以上のパスは解決できないものとして報告する', () => {
      const findings = run(healthyModel({ entryGuard: 'workshop.state.bogus == accepting' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('workshop の context に state がありません');
      expect(findings[0]?.counterexample?.path).toBe('workshop.state.bogus');
    });

    it('パースできない式を報告する', () => {
      const findings = run(healthyModel({ entryGuard: 'workshop.state ~~ accepting' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('guard をパースできません');
      expect(findings[0]?.counterexample?.expression).toBe('workshop.state ~~ accepting');
    });
  });

  describe('予約語 actor の閉域', () => {
    it('actor.id は通る', () => {
      expect(run(healthyModel({ entryGuard: 'entry.workshop_id == actor.id' }))).toEqual([]);
    });

    it('actor.{id 以外} を検出する', () => {
      const findings = run(healthyModel({ entryGuard: 'entry.title == actor.idd' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.message).toContain('予約語 actor に idd はありません');
      expect(findings[0]?.counterexample?.path).toBe('actor.idd');
    });

    it('binding の actor.{id 以外} も検出する', () => {
      const model = specModel(
        [workshopAggregate()],
        roleSpec([role('organizer', 'workshop.organizer_ids == actor.role')]),
      );

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('予約語 actor に role はありません');
    });

    it('actor.{session: true の欄} は通る(実行者の属性。束 ⑲-2a)', () => {
      expect(run(tenantModel({ actorField: 'company_id' }))).toEqual([]);
    });

    it('session: true でない欄を actor.{欄} として参照したら検出する', () => {
      const findings = run(tenantModel({ actorField: 'nickname' }));

      expect(findings.some((finding) => finding.message.includes('予約語 actor に nickname はありません'))).toBe(
        true,
      );
    });

    it('単独の actor を検出する（実行者について書けるのは同一性だけ）', () => {
      const findings = run(healthyModel({ entryGuard: 'entry.title == actor' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('予約語 actor は単独では使えません');
    });
  });

  describe('reads[].filters(実行者の属性で狭める境界。テナント)', () => {
    it('列が実在し、右辺の欄が session: true なら通る', () => {
      expect(run(tenantModel({ filters: { company_id: 'company_id' } }))).toEqual([]);
    });

    it('実在しない列で絞っていたら検出する(綴り違いで「絞ったつもり」を残さない)', () => {
      const findings = run(tenantModel({ filters: { compny_id: 'company_id' } }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.message).toContain('compny_id で絞っていますが、その列はありません');
    });

    it('session: true でない欄を右辺にしていたら検出する(RLS も実行計画も引けない)', () => {
      const findings = run(tenantModel({ filters: { company_id: 'nickname' } }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('actor.nickname を参照していますが');
      expect(findings[0]?.message).toContain('session: true を宣言していません');
    });

    it('左辺と実行者の欄の値の種別が違えば検出する(RLS は行の値をそのまま比べる)', () => {
      const findings = run(tenantModel({ filters: { closed: 'company_id' } }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('値の種別が違います');
      expect(findings[0]?.counterexample?.column_kind).toBe('boolean');
    });

    it('親の列({集約}.{列})で絞る境界は、context で届けば通る', () => {
      expect(run(shelfModel({ 'store.company_id': 'company_id' }))).toEqual([]);
    });

    it('context で届かない集約の列で絞っていたら検出する(生成器が辿れない左辺を残さない)', () => {
      const findings = run(shelfModel({ 'staff_member.company_id': 'company_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('その集約へ context で届きません');
      expect(findings[0]?.counterexample?.problem).toBe('unreachable');
    });

    it('届く親に無い列で絞っていたら検出する', () => {
      const findings = run(shelfModel({ 'store.compny_id': 'company_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('store.compny_id で絞っていますが、その列はありません');
    });

    it('存在しない集約の名前で絞っていたら検出する', () => {
      const findings = run(shelfModel({ 'warehouse.company_id': 'company_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('その集約はありません');
    });
  });

  describe('reads[].when(行の状態で見え方を絞る条件。束 §14)', () => {
    it('自集約の状態の欄を比べる条件は通る', () => {
      expect(run(tenantModel({ when: 'store.state != closed' }))).toEqual([]);
    });

    it('実在しない欄を読んでいたら検出する(同じ式言語なので checkExpr がそのまま当たる)', () => {
      const findings = run(tenantModel({ when: 'store.stete != closed' }));

      // 参照の解決と「見えない行を決められない」の 2 件が出る(どちらも直す先は同じ 1 か所)。
      expect(findings[0]?.message).toContain('store の reads(by: member) の when が参照する store.stete');
    });

    it('状態の欄を比べていない条件は検出する(world が「見えない行」を決められない。束 §14)', () => {
      const findings = run(tenantModel({ when: 'store.closed == false' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.message).toContain('「見えない行」を決められません');
      expect(findings[0]?.suggestion).toContain('state');
    });

    it('時刻(now)の比較も検出する(状態ではないので偽にする行を選べない)', () => {
      const findings = run(tenantModel({ when: 'store.state != closed and now > store.opened_at' }));

      expect(findings.map((finding) => finding.message).join('\n')).toContain('時刻(now)は比べられません');
    });

    it('実行者の属性を読んでいたら検出する(それは filters の役である)', () => {
      const findings = run(tenantModel({ when: 'store.state != closed and store.company_id == actor.company_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.message).toContain('when が actor.company_id を参照しています');
      expect(findings[0]?.suggestion).toContain('filters');
    });
  });

  describe('比較の型一致(束 ⑳-1b)', () => {
    it('boolean の欄を順序で比べたら落とす(TS は常に不明 = 不成立、DB だけが通す)', () => {
      const findings = run(healthyModel({ entryGuard: 'entry.draft_flag > false' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.message).toContain('boolean の欄は順序で比べられません');
      expect(findings[0]?.suggestion).toContain('== true');
      expect(findings[0]?.counterexample?.op).toBe('>');
    });

    it('boolean の欄を in で比べたら落とす', () => {
      const findings = run(healthyModel({ entryGuard: 'entry.draft_flag in [true]' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('in で比べられません');
    });

    it('種別の違う欄どうしの比較を落とす(SQL は実行時に型変換で落ちる)', () => {
      const findings = run(healthyModel({ entryGuard: 'entry.title == workshop.opens_at' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('種別が違う');
    });

    it('値域が閉じた欄の綴り違いは 1 件だけ出す(リテラル接地と二重に鳴らさない)', () => {
      const findings = run(healthyModel({ entryGuard: 'state == publik' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('その値はありません');
    });
  });

  describe('予約語 now の閉域', () => {
    it('単独の now は通る（左辺でも右辺でも）', () => {
      expect(run(healthyModel({ entryGuard: 'now >= workshop.opens_at' }))).toEqual([]);
      expect(run(healthyModel({ entryGuard: 'workshop.opens_at < now' }))).toEqual([]);
    });

    it('now.{任意名} を検出する（now は値であってオブジェクトではない）', () => {
      const findings = run(healthyModel({ entryGuard: 'now.foo >= workshop.organizer_ids' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.message).toContain('予約語 now に foo はありません');
      expect(findings[0]?.counterexample?.path).toBe('now.foo');
    });

    it('比較の右辺の now.{任意名} も検出する', () => {
      const findings = run(healthyModel({ entryGuard: 'workshop.organizer_ids < now.date' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('予約語 now に date はありません');
      expect(findings[0]?.counterexample?.path).toBe('now.date');
    });

    it('binding の now.{任意名} も検出する', () => {
      const model = specModel(
        [workshopAggregate()],
        roleSpec([role('organizer', 'workshop.organizer_ids == now.year')]),
      );

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('予約語 now に year はありません');
    });
  });

  describe('比較リテラルの接地（値域が閉じた左辺）', () => {
    it('宣言済みの状態・enum 値との比較は通る', () => {
      expect(
        run(healthyModel({ entryGuard: 'state == draft and workshop.state == accepting' })),
      ).toEqual([]);
    });

    it('状態機械に無い状態との比較を検出する', () => {
      const findings = run(healthyModel({ entryGuard: 'workshop.state == acceptng' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain(
        'workshop.state を acceptng と比べています: workshop.state にその値はありません',
      );
      expect(findings[0]?.suggestion).toContain('accepting / closed');
      expect(findings[0]?.counterexample).toMatchObject({
        path: 'workshop.state',
        value: 'acceptng',
      });
    });

    it('他の節が生きている式でも綴り違いを名指しする（恒偽判定では捕まらない形）', () => {
      const findings = run(healthyModel({ entryGuard: 'state == draft or state == publik' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.counterexample?.value).toBe('publik');
    });

    it('in の並びに混ざった綴り違いも検出する', () => {
      const findings = run(healthyModel({ entryGuard: 'state in [draft, submited]' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.counterexample?.value).toBe('submited');
    });

    it('when（creates / writes / deletes）のリテラルも見る', () => {
      const model = specModel([
        aggregate('entry', {
          entity: entitySpec('entry', {
            fields: [field('kind', { kind: 'enum', values: ['performance', 'audience'] })],
          }),
          access: accessSpec('entry', { creates: [create('member', 'kind == audiense')] }),
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('kind を audiense と比べています');
      expect(findings[0]?.suggestion).toContain('performance / audience');
    });

    it('値域が開いている左辺（文字列・参照)は照合しない', () => {
      expect(run(healthyModel({ entryGuard: 'entry.title == anything' }))).toEqual([]);
    });

    it('右辺がパスの比較は照合しない', () => {
      expect(run(healthyModel({ entryGuard: 'state == workshop.state' }))).toEqual([]);
    });
  });

  describe('entity_spec の context の値', () => {
    /** context だけを差し替えた entry(workshop への外部キーと自分の id を持つ)。 */
    function contextModel(context: Readonly<Record<string, string>>) {
      return specModel([
        aggregate('entry', {
          entity: entitySpec('entry', {
            context,
            fields: [
              field('id', { kind: 'uuid' }, { auto: true }),
              field('workshop_id', { kind: 'ref', entity: 'workshop' }),
              field('title', { kind: 'string' }),
            ],
          }),
        }),
        workshopAggregate(),
      ]);
    }

    it('存在しないフィールドを指す context を検出する', () => {
      const findings = run(contextModel({ workshop: 'entry.consert_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('V2');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('エンティティ entry にフィールド consert_id がありません');
      expect(findings[0]?.suggestion).toContain('ref(workshop)');
      expect(findings[0]?.counterexample).toMatchObject({
        entity: 'entry',
        context_key: 'workshop',
        path: 'entry.consert_id',
      });
    });

    it('前方参照(自分の ref フィールド)と自己参照は通る', () => {
      expect(run(contextModel({ workshop: 'entry.workshop_id', entry: 'entry.id' }))).toEqual([]);
    });

    it('自己参照が主キーでない列(外部キー)を指していれば検出する', () => {
      const findings = run(contextModel({ entry: 'entry.workshop_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('主キー相当の列(uuid かつ auto: true)ではありません');
      expect(findings[0]?.counterexample).toMatchObject({
        context_key: 'entry',
        path: 'entry.workshop_id',
        field_type: 'ref(workshop)',
      });
    });

    it('相手側の列から自分を指す逆参照を検出する', () => {
      const findings = run(contextModel({ workshop: 'workshop.entry_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('参照パスの起点が entry ではありません');
      expect(findings[0]?.suggestion).toContain('逆参照');
      expect(findings[0]?.counterexample).toMatchObject({ path: 'workshop.entry_id' });
    });

    it('ref(相手) でないフィールドを指す context を検出する', () => {
      const findings = run(contextModel({ workshop: 'entry.title' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('ref(workshop) 型ではありません');
      expect(findings[0]?.counterexample).toMatchObject({ field_type: 'string' });
    });

    it('未定義のエンティティをキーに持つ context を検出する', () => {
      const findings = run(contextModel({ venue: 'entry.workshop_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('エンティティ venue が未定義です');
      expect(findings[0]?.counterexample).toMatchObject({ context_key: 'venue' });
    });

    it('2 段でないパスは形式エラーにする(境界)', () => {
      const findings = run(contextModel({ workshop: 'entry.session.workshop_id' }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('形式ではありません');
    });
  });

  describe('effects.on / forbidden.event の実在', () => {
    it('存在しないイベントを指す effects.on を検出する', () => {
      const model = specModel([
        aggregate('entry', {
          stateMachines: [
            machine('entry', {
              states: ['draft', 'submitted'],
              initial: 'draft',
              events: [event('submit', { from: ['draft'], to: 'submitted' })],
              effects: [effect('accept', ['notify_performer'])],
            }),
          ],
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('イベント accept が events に存在しません');
      expect(findings[0]?.counterexample).toEqual({ machine: 'entry', on: 'accept' });
    });

    it('存在しないイベントを指す forbidden.event を検出する', () => {
      const model = specModel([
        aggregate('entry', {
          stateMachines: [
            machine('entry', {
              states: ['draft', 'submitted'],
              initial: 'draft',
              events: [event('submit', { from: ['draft'], to: 'submitted' })],
              forbidden: [forbidden('revise', ['submitted'], '確定後の修正は不可')],
            }),
          ],
        }),
      ]);

      const findings = run(model);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('forbidden.event');
      expect(findings[0]?.counterexample).toEqual({ machine: 'entry', event: 'revise' });
    });
  });

  describe('遷移が参照する状態 ID の実在', () => {
    /** states = [draft, submitted] の状態機械を、events / forbidden だけ差し替えて作る。 */
    function machineModel(opts: Parameters<typeof machine>[1]): SpecModel {
      return specModel([aggregate('entry', { stateMachines: [machine('entry', opts)] })]);
    }

    it('states に無い状態を from に持つイベントを検出する', () => {
      const findings = run(
        machineModel({
          states: ['draft', 'submitted'],
          initial: 'draft',
          events: [event('submit', { from: ['typo_draft'], to: 'submitted' })],
        }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toBe(
        'entry の events.submit.from: 状態 typo_draft が states に存在しません',
      );
      expect(findings[0]?.suggestion).toContain('draft / submitted');
      expect(findings[0]?.counterexample).toEqual({
        machine: 'entry',
        owner: 'events.submit',
        kind: 'from',
        state: 'typo_draft',
      });
      expect(findings[0]?.location.pointer).toBe('events.submit');
    });

    it('states に無い状態を to に持つイベントを検出する', () => {
      const findings = run(
        machineModel({
          states: ['draft', 'submitted'],
          initial: 'draft',
          events: [event('submit', { from: ['draft'], to: 'sumbitted' })],
        }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('events.submit.to: 状態 sumbitted');
      expect(findings[0]?.counterexample?.kind).toBe('to');
    });

    it('states に無い状態を from に持つ forbidden ブロックを検出する', () => {
      const findings = run(
        machineModel({
          states: ['draft', 'submitted'],
          initial: 'draft',
          events: [event('submit', { from: ['draft'], to: 'submitted' })],
          forbidden: [forbidden('submit', ['archived'], 'アーカイブ済みは提出できない')],
        }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('forbidden.submit.from: 状態 archived');
      expect(findings[0]?.counterexample).toEqual({
        machine: 'entry',
        owner: 'forbidden.submit',
        kind: 'from',
        state: 'archived',
      });
    });

    it('全ての from / to / forbidden.from が states にあれば違反ゼロ', () => {
      const findings = run(
        machineModel({
          states: ['draft', 'submitted', 'withdrawn'],
          initial: 'draft',
          final: ['withdrawn'],
          events: [
            event('submit', { from: ['draft'], to: 'submitted' }),
            event('withdraw', { from: ['draft', 'submitted'], to: 'withdrawn' }),
          ],
          forbidden: [forbidden('submit', ['submitted'], '提出済みの再提出は不可')],
        }),
      );

      expect(findings).toEqual([]);
    });
  });
});
