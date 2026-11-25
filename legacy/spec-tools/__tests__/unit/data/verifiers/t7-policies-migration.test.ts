/**
 * T7(RLS のポリシー本文の出どころ)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §RLS の仕様をどこに置くか / migrations.md §生成 migration):
 *   - `access_spec` を持つ表は `policies_migration` が必須、持たない表は宣言できない
 *   - 名前は `{14 桁}_policies_{テーブル名}.sql` で、`functions[].migration` とも衝突しない
 *   - ポリシーが要求する RLS 補助関数が `kind: helper` + `role` + `migration` で宣言され、
 *     名前が `is_{ロール}` である
 *   - 補助関数の連番が全ポリシーより前(ポリシーが関数を参照するため)
 *   - 宣言と要求が**両方向**で一致する(要求されないロールを書いた宣言・生成先だけを書いた宣言)
 *   - **生成の前提**(スコープと束縛の指す集約が一致する)—— 生成器が
 *     `preconditionFailure('T7')` で報告する前提を、verify の段で落とす
 *   - **状態の条件(`reads[].when`)が効く場所に書かれている**(束 §14)—— 刈り込まれる規則や
 *     `scope: none` の規則に書いた条件は 1 文字も効かないのに、期待表にも `spec:diff` にも
 *     出ないまま全検査が緑になる(「書いたのに効いていない宣言」と同型)
 */

import { describe, expect, it } from 'vitest';
import { verifyPoliciesMigration as verifyWithPlatform } from '../../../../lib/data/verifiers/t7-policies-migration.js';
import { TEST_PLATFORM } from '../../../helpers/platform.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';

/** T7 を本番と同じプラットフォームの設定で回す(設定は検査の入力であり、各ケースの関心事ではない)。 */
function verifyPoliciesMigration(domain: SpecModel, dataTables: DataTableSpecModel) {
  return verifyWithPlatform(domain, dataTables, TEST_PLATFORM);
}

/** 題材: 予約(booking)→ 会議室(room)。利用者(user)が実行者の集約。 */
const roles = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('user', undefined, undefined, 'authenticated_default'),
  role('system', undefined, undefined, 'system'),
  role('booking_owner', 'booking.user_id == actor.id', ['user']),
]);

/** ドメイン仕様(reads は呼び側が渡す)。 */
function domain(reads: Parameters<typeof read>[] = [['user', 'all']]): SpecModel {
  return specModel(
    [
      aggregate('booking', {
        entity: entitySpec('booking', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('user_id', { kind: 'ref', entity: 'user' }, { required: true }),
            // 状態の条件(`reads[].when`)が読む欄(束 §14)。
            field('state', { kind: 'enum', values: ['open', 'cancelled'] }),
          ],
        }),
        access: accessSpec('booking', { reads: reads.map((args) => read(...args)) }),
      }),
      aggregate('user', {
        entity: entitySpec('user', {
          fields: [field('id', { kind: 'uuid' }), field('is_admin', { kind: 'boolean' }, { session: true })],
        }),
      }),
    ],
    roles,
  );
}

/** 宣言を「落とす」ことを `null` で書ける形(exactOptionalPropertyTypes のため。T6 と同じ流儀)。 */
type HelperOverrides = Omit<Partial<DataFunctionDecl>, 'migration'> & { readonly migration?: string | null };

/** 表の上書き(`policiesMigration: null` で宣言を落とす)。 */
type TableOverrides = Omit<Partial<DataTableSpec>, 'policiesMigration'> & {
  readonly policiesMigration?: string | null;
};

/** 補助関数 1 本の宣言(既定は健全)。 */
function helper(overrides: HelperOverrides = {}): DataFunctionDecl {
  const { migration: declared, ...rest } = overrides;
  const migration = declared === undefined ? '20260912000001_helper_is_user.sql' : declared;
  return {
    name: 'is_user',
    args: [],
    params: [],
    kind: 'helper',
    role: 'user',
    alsoWrites: [],
    ...rest,
    ...(migration === null ? {} : { migration }),
  };
}

/** 上書きを data_table の引数に直す(`null` は宣言なし)。 */
function tableOpts(overrides: TableOverrides, fallback: string | null): Partial<DataTableSpec> {
  const { policiesMigration: declared, ...rest } = overrides;
  const migration = declared === undefined ? fallback : declared;
  return { ...rest, ...(migration === null ? {} : { policiesMigration: migration }) };
}

/** 予約の表と利用者の表(補助関数の持ち場)。 */
function model(opts: { booking?: TableOverrides; users?: TableOverrides } = {}) {
  return dataTableModel([
    dataTable('bookings', {
      entity: 'booking',
      ...tableOpts(opts.booking ?? {}, '20260912000101_policies_bookings.sql'),
    }),
    dataTable('users', { entity: 'user', functions: [helper()], ...tableOpts(opts.users ?? {}, null) }),
  ]);
}

/** 指摘の文面。 */
function messages(findings: readonly { readonly message: string }[]): readonly string[] {
  return findings.map((finding) => finding.message);
}

describe('T7 RLS のポリシー本文の出どころ', () => {
  it('宣言が揃っていれば健全', () => {
    // users は access_spec を持たないので policies_migration も要らない。
    expect(verifyPoliciesMigration(domain(), model())).toEqual([]);
  });

  it('access_spec を持つ表に宣言が無ければエラー', () => {
    const found = verifyPoliciesMigration(domain(), model({ booking: { policiesMigration: null } }));
    expect(messages(found)).toEqual([
      'bookings は access_spec を持つ表ですが policies_migration の宣言がありません',
    ]);
  });

  it('access_spec を持たない表が宣言していたらエラー', () => {
    const found = verifyPoliciesMigration(
      domain(),
      model({ users: { functions: [helper()], policiesMigration: '20260912000102_policies_users.sql' } }),
    );
    expect(messages(found)).toEqual([
      'users は access_spec を持たない表なので policies_migration を宣言できません',
    ]);
  });

  it('名前が表から導かれる形でなければエラー', () => {
    const found = verifyPoliciesMigration(
      domain(),
      model({ booking: { policiesMigration: '20260912000101_policies_booking.sql' } }),
    );
    expect(messages(found)).toEqual([
      'policies_migration 20260912000101_policies_booking.sql が表 bookings から導かれる名前になっていません',
    ]);
  });

  it('連番が 14 桁でなければエラー', () => {
    const found = verifyPoliciesMigration(
      domain(),
      model({ booking: { policiesMigration: '1_policies_bookings.sql' } }),
    );
    expect(messages(found)[0]).toContain('導かれる名前になっていません');
  });

  it('関数の生成 migration と名前が衝突したらエラー', () => {
    const found = verifyPoliciesMigration(
      domain(),
      model({
        booking: { policiesMigration: '20260912000001_helper_is_user.sql' },
        users: { functions: [helper()] },
      }),
    );
    expect(messages(found)).toEqual([
      'policies_migration 20260912000001_helper_is_user.sql が表 bookings から導かれる名前になっていません',
      'policies_migration 20260912000001_helper_is_user.sql が function is_user と重複しています',
      // 名前が壊れている = 連番が読めないので、順序の検査も同じ宣言を指して鳴る。
      'RLS 補助関数 is_user の migration の連番がポリシーより後です',
    ]);
  });

  it('ポリシーが要求する補助関数が宣言されていなければエラー', () => {
    const found = verifyPoliciesMigration(domain(), model({ users: { functions: [] } }));
    expect(messages(found)).toEqual(['ポリシーが要求する RLS 補助関数(ロール user)が宣言されていません']);
  });

  it('補助関数の名前がロールから導かれる形でなければエラー', () => {
    const found = verifyPoliciesMigration(domain(), model({ users: { functions: [helper({ name: 'is_member' })] } }));
    expect(messages(found)).toEqual([
      'RLS 補助関数 is_member の名前がロール user から導かれる形(is_user)と一致しません',
    ]);
  });

  it('補助関数が role を宣言して migration が無ければエラー', () => {
    const found = verifyPoliciesMigration(
      domain(),
      model({ users: { functions: [helper({ migration: null })] } }),
    );
    expect(messages(found)).toEqual(['RLS 補助関数 is_user は role を宣言していますが migration がありません']);
  });

  it('補助関数の連番がポリシーより後ならエラー', () => {
    const found = verifyPoliciesMigration(
      domain(),
      model({ users: { functions: [helper({ migration: '20260912000999_helper_is_user.sql' })] } }),
    );
    expect(messages(found)).toEqual(['RLS 補助関数 is_user の migration の連番がポリシーより後です']);
  });

  it('束縛の指す集約とスコープが食い違っていたらエラー(生成器の前提)', () => {
    // booking_owner の束縛は booking を指すので、`context(room)` とは別のことを言っている。
    // このモデルのポリシーは束縛のロール 1 本だけなので、補助関数は 1 つも要求されない。
    const found = verifyPoliciesMigration(
      domain([['booking_owner', 'context(room)']]),
      model({ users: { functions: [] } }),
    );
    expect(messages(found)).toEqual([
      'ポリシー bookings_select_booking_owner_context のスコープ(context(room))がロール booking_owner の根拠と食い違います',
    ]);
  });

  it('対象に依らず立つロールに own / context を書いたらエラー(述語が全件になる)', () => {
    // **一番危ない形**である —— 述語は補助関数だけになり、宣言より広いポリシーが黙って出る。
    const found = verifyPoliciesMigration(domain([['user', 'own']]), model());
    expect(messages(found)).toEqual([
      'ポリシー bookings_select_user_own のスコープ(own)がロール user の根拠と食い違います',
    ]);
  });

  it('対象の行との関係で立つロールに all を書いたらエラー(述語が束縛で狭まる)', () => {
    const found = verifyPoliciesMigration(domain([['booking_owner', 'all']]), model({ users: { functions: [] } }));
    expect(messages(found)).toEqual([
      'ポリシー bookings_select_booking_owner_all のスコープ(all)がロール booking_owner の根拠と食い違います',
    ]);
  });

  it('境界の列が実在しなければエラー(生成器の前提)', () => {
    const found = verifyPoliciesMigration(domain([['user', 'all', { tenant_id: 'is_admin' }]]), model());
    expect(messages(found)).toEqual([
      'ポリシー bookings_select_user_all_within_tenant_id の境界(tenant_id = actor.is_admin)を SQL に写せません(unknown_field)',
      '境界(actor.is_admin)が要求する補助関数 actor_is_admin が宣言されていません',
    ]);
  });

  describe('境界の補助関数(actor_field。値の正は実行者の行)', () => {
    /** 境界の補助関数 1 本の宣言(既定は健全)。 */
    function boundaryHelper(overrides: HelperOverrides = {}): DataFunctionDecl {
      const { actorField, ...rest } = overrides;
      const { role: _role, ...base } = helper({
        name: 'actor_company_id',
        migration: '20260912000002_helper_actor_company_id.sql',
        ...rest,
      });
      return { ...base, actorField: actorField ?? 'company_id' };
    }

    /** 会社の列を持つ予約と、会社を session に載せる利用者。 */
    function tenantDomain(reads: Parameters<typeof read>[]): SpecModel {
      const base = domain(reads);
      const booking = base.aggregates.get('booking');
      const user = base.aggregates.get('user');
      return {
        ...base,
        aggregates: new Map([
          ...base.aggregates,
          [
            'booking',
            {
              ...booking!,
              entity: { ...booking!.entity!, fields: [...booking!.entity!.fields, field('company_id', { kind: 'uuid' })] },
            },
          ],
          [
            'user',
            {
              ...user!,
              entity: {
                ...user!.entity!,
                fields: [...user!.entity!.fields, field('company_id', { kind: 'uuid' }, { session: true })],
              },
            },
          ],
        ]),
      };
    }

    const bounded: Parameters<typeof read>[] = [['user', 'all', { company_id: 'company_id' }]];

    it('境界が要求する補助関数を宣言していれば通る', () => {
      expect(verifyPoliciesMigration(tenantDomain(bounded), model({ users: { functions: [helper(), boundaryHelper()] } }))).toEqual([]);
    });

    it('境界があるのに補助関数の宣言が無ければエラー(ポリシーが存在しない関数を呼ぶ)', () => {
      const found = verifyPoliciesMigration(tenantDomain(bounded), model());
      expect(messages(found)).toEqual(['境界(actor.company_id)が要求する補助関数 actor_company_id が宣言されていません']);
    });

    it('関数名が欄から導かれる形でなければエラー', () => {
      const found = verifyPoliciesMigration(
        tenantDomain(bounded),
        model({ users: { functions: [helper(), boundaryHelper({ name: 'current_company' })] } }),
      );
      expect(messages(found)).toEqual([
        '境界の補助関数 current_company の名前が実行者の欄 company_id から導かれる形(actor_company_id)と一致しません',
      ]);
    });

    it('migration が無ければエラー(本文は生成物という宣言なのに書き出し先が無い)', () => {
      const found = verifyPoliciesMigration(
        tenantDomain(bounded),
        model({ users: { functions: [helper(), boundaryHelper({ migration: null })] } }),
      );
      expect(messages(found)).toEqual(['境界の補助関数 actor_company_id は actor_field を宣言していますが migration がありません']);
    });

    it('どの境界も要求しない補助関数はエラー(宣言だけが残って生成物が出ない)', () => {
      const found = verifyPoliciesMigration(
        tenantDomain([['user', 'all']]),
        model({ users: { functions: [helper(), boundaryHelper()] } }),
      );
      expect(messages(found)).toEqual(['境界の補助関数 actor_company_id(実行者の欄 company_id)を要求する境界がありません']);
    });

    it('補助関数の連番がポリシーより後ならエラー(ポリシーが関数を参照する)', () => {
      const found = verifyPoliciesMigration(
        tenantDomain(bounded),
        model({
          users: { functions: [helper(), boundaryHelper({ migration: '20260912000201_helper_actor_company_id.sql' })] },
        }),
      );
      expect(messages(found)).toEqual(['RLS 補助関数 actor_company_id の migration の連番がポリシーより後です']);
    });

    it('境界の両辺の値の種別が違えば述語を写さない(エラー)', () => {
      const found = verifyPoliciesMigration(
        tenantDomain([['user', 'all', { company_id: 'is_admin' }]]),
        model({ users: { functions: [helper(), boundaryHelper({ name: 'actor_is_admin', actorField: 'is_admin' })] } }),
      );
      // is_admin は boolean なので境界の列(uuid)と種別が違う —— 述語も写さない(V2 と二重に閉じる)。
      expect(messages(found)).toEqual([
        'ポリシー bookings_select_user_all_within_company_id の境界(company_id = actor.is_admin)を SQL に写せません(kind_mismatch)',
      ]);
    });
  });

  it('要求されないロールを宣言する補助関数はエラー(宣言だけが残って生成物が出ない)', () => {
    // 読み取りが束縛のロール 1 本だけなら、グローバルに立つロールの補助関数は 1 本も要らない。
    const found = verifyPoliciesMigration(domain([['booking_owner', 'own']]), model());
    expect(messages(found)).toEqual(['RLS 補助関数 is_user(ロール user)を要求するポリシーがありません']);
  });

  it('生成先(migration)だけを宣言して role が無ければエラー', () => {
    const orphan: DataFunctionDecl = {
      name: 'is_user',
      args: [],
      params: [],
      kind: 'helper',
      alsoWrites: [],
      migration: '20260912000001_helper_is_user.sql',
    };
    const found = verifyPoliciesMigration(domain(), model({ users: { functions: [orphan] } }));
    expect(messages(found)).toEqual([
      // ポリシーは user の補助関数を要求しているが、role を書いた宣言が無い(要求の側)。
      'ポリシーが要求する RLS 補助関数(ロール user)が宣言されていません',
      // 生成先だけが残っている(宣言の側)。
      'RLS 補助関数 is_user は migration を宣言していますが role も actor_field もありません',
    ]);
  });

  it('宣言が 1 つ足りないだけで「要求されない補助関数」が連鎖して鳴らない', () => {
    // policies_migration の宣言が無い表でも、その表が何を要求するかは母集合に入る。
    const found = verifyPoliciesMigration(domain(), model({ booking: { policiesMigration: null } }));
    expect(messages(found)).toEqual([
      'bookings は access_spec を持つ表ですが policies_migration の宣言がありません',
    ]);
  });

  it('刈り込まれる規則に書いた状態の条件はエラー(書いても効かない)', () => {
    // `user: all`(無条件)が同じ行を見せているので、`booking_owner: own` のポリシーは
    // 刈り込まれて 1 本も出ない —— そこに条件を書いても 1 文字も効かない。
    const found = verifyPoliciesMigration(
      domain([
        ['user', 'all'],
        ['booking_owner', 'own', undefined, 'booking.state != cancelled'],
      ]),
      model(),
    );
    expect(messages(found)).toEqual([
      'booking の reads(by: booking_owner)の when "booking.state != cancelled" は効きません' +
        '(ロール user が無条件で同じ行を見せています)',
    ]);
    expect(found[0]?.suggestion).toContain('上界の規則');
    expect(found[0]?.counterexample?.['covered_by']).toBe('user');
  });

  it('上界の規則に書けば効く(同じ条件でもエラーにならない)', () => {
    // 条件を持つ `scope: all` は刈り込みの根拠を失うので、狭い規則のポリシーも一緒に生える。
    expect(
      verifyPoliciesMigration(
        domain([
          ['user', 'all', undefined, 'booking.state != cancelled'],
          ['booking_owner', 'own'],
        ]),
        model(),
      ),
    ).toEqual([]);
  });

  it('scope: none の規則に書いた状態の条件もエラー(ポリシーがそもそも無い)', () => {
    const found = verifyPoliciesMigration(
      domain([
        ['user', 'all'],
        ['anonymous', 'none', undefined, 'booking.state != cancelled'],
      ]),
      model(),
    );
    expect(messages(found)).toEqual([
      'booking の reads(by: anonymous)の when "booking.state != cancelled" は効きません' +
        '(scope: none なのでそのロールのポリシーがそもそもありません)',
    ]);
  });

  it('data_table を持たない環境では何も見ない', () => {
    expect(verifyPoliciesMigration(domain(), dataTableModel([], false))).toEqual([]);
  });
});
