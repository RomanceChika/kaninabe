/**
 * ガード式・ロールの **SQL 翻訳 ⇔ TS の評価器** の差分テスト(実 DB)。
 *
 * 仕様: docs/rules/decisions/common/ADR-0012-db-as-authority.md ⑤(束 ⑳-1 / ⑳-1b)
 *       docs/rules/process/common/specification/standards/domain-spec-writing.md §ガード式の文法
 *       翻訳器: legacy/spec-tools/lib/sql/{guard-to-sql,roles-to-sql}.ts
 *
 * **意味の正は TS 側**である(`@kaninabe/runtime/engine` の評価器と解決済みロール)。DB を権威に
 * すると同じ 1 つの宣言を 2 つの実行系が読むことになるので、「2 つが同じ判定を下す」は書いた人の
 * 気持ちではなく**実測**でなければならない —— fast-check が式と環境を振り、実 DB へ
 * `select <述語>` を実行して突き合わせる。
 *
 * 振るのは文法の全構成要素(比較 6 種・`in` / `not in` / `contains` / `and` / `or` / `not`・
 * 予約語 `now`・リテラルとパス右辺)と、**値が無い(NULL)**環境である。NULL は TS では
 * `'unknown'`(3 値)になり、最後に「不明 → 不成立」で畳まれる —— SQL の NULL 論理は同じ
 * Kleene 論理なので、**式全体を 1 回 `coalesce(…, false)` で閉じる**のが同じ写しになる。
 *
 * **boolean の欄には全ての演算子を振る**(束 ⑳-1b)。`doc.flag in [true]` / `doc.flag > false` は
 * TS が常に不明(= 不成立)にする一方、SQL に素直に写すと**DB だけが通す** —— これは仕様の誤りと
 * 決めたので、V2 が error にし、翻訳器も `ok: false` を返す。生成器はその組も振り、**翻訳器が
 * 断ることを固定する**(実行するのは断られなかった式だけ)。
 *
 * 実 DB を使うのは、文字列の照合順序・型の解決・NULL の伝播が Postgres の実装そのものであり、
 * 手元に模型を作ると「模型と本物が違う」という別の食い違いを抱えるためである。
 */

import { Client } from 'pg';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseGuard } from '../../lib/guard/parser.js';
import { guardToSql } from '../../lib/sql/guard-to-sql.js';
import type { GuardSqlResult } from '../../lib/sql/guard-to-sql.js';
import { rolesToSql } from '../../lib/sql/roles-to-sql.js';
import { impliedRoles } from '../../lib/model/role-hierarchy.js';
import { guardExprData } from '../../lib/guard/expr-data.js';
import type { RoleDef } from '../../lib/model/types.js';
import type { ValueKind } from '../../lib/model/field-values.js';
import { containsKey, evaluateGuard } from '@kaninabe/runtime/engine';
import type { GuardEnv, GuardExprData } from '@kaninabe/runtime/engine';

/** ガード式の環境を 1 行の CTE に開く(全列に型を付ける = NULL にも型がある)。 */
const ENV_CTE = `with g as (
  select $1::text as state, $2::text as kind, $3::boolean as flag, $4::integer as cnt,
         $5::timestamptz as opens_at, $6::uuid as owner_id, $7::integer as other_cnt,
         $8::timestamptz as other_opens_at, $9::uuid as actor_id,
         $10::boolean as tags_has_actor,
         clock_timestamp() as v_now
)`;

/**
 * パス → 列参照。
 *
 * **照合順序はここに書かない**(束 ⑳-1b)。text の順序比較に `collate "C"` を付けるのは
 * 翻訳器の仕事であり、呼び側が宣言するのは下の「欄の種別」だけである —— 呼び側の作法にすると
 * 与え忘れを誰も見ないまま DB だけが別の判定を下す(食い違いそのものは「既知の食い違い」で実測)。
 */
const COLUMN_SQL: Readonly<Record<string, string>> = {
  'doc.state': 'g.state',
  'doc.kind': 'g.kind',
  'doc.flag': 'g.flag',
  'doc.cnt': 'g.cnt',
  'doc.opens_at': 'g.opens_at',
  'doc.owner_id': 'g.owner_id',
  'other.cnt': 'g.other_cnt',
  'other.opens_at': 'g.other_opens_at',
  'actor.id': 'g.actor_id',
};

/** パス → 欄の種別(呼び側の宣言。entity_spec の型からの写像にあたる)。 */
const VALUE_KIND: Readonly<Record<string, ValueKind>> = {
  'doc.state': 'text',
  'doc.kind': 'text',
  'doc.flag': 'boolean',
  'doc.cnt': 'number',
  'doc.opens_at': 'datetime',
  'doc.owner_id': 'opaque',
  'other.cnt': 'number',
  'other.opens_at': 'datetime',
  'actor.id': 'opaque',
};

/** 翻訳器に渡す解決(列参照・欄の種別・`contains`)。 */
const GUARD_BINDINGS = {
  // 生成 RPC と同じ形: 時刻は 1 度だけ取った値(ロック後の `v_now`)を `now` に当てる。
  now: 'g.v_now',
  column: (path: { readonly segments: readonly string[] }): string | null =>
    COLUMN_SQL[path.segments.join('.')] ?? null,
  valueKind: (path: { readonly segments: readonly string[] }): ValueKind | null =>
    VALUE_KIND[path.segments.join('.')] ?? null,
  contains: (): string => 'g.tags_has_actor',
};

const STATES = ['draft', 'published', 'closed'] as const;
const KINDS = ['alpha', 'beta', 'gamma'] as const;

/**
 * 環境に入れる日時(**正規形**)。
 *
 * **現在時刻の近傍を入れてはならない**。`now()` はマイクロ秒、pg が返す `Date` はミリ秒なので、
 * TS に渡る `now` は切り捨てられた値であり、境界そのものを狙った値は flaky になる。
 */
const TIMES = ['2020-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z'] as const;

/**
 * 式に書く日時リテラル(**正規形でない綴りを混ぜる**)。
 *
 * 仕様に `2026-01-01T00:00:00Z`(小数部なし)や `+09:00` 表記で書き、env に `…00.000Z` が来る
 * ことは普通に起こる。素朴な字句順ではそこで割れる(19 文字目で `.` < `Z`)ので、TS の評価器は
 * ISO 8601 を正規形に畳んでから比べる —— その契約をここで実測する(束 ⑳-1b)。
 */
const TIME_LITERALS = [
  '2020-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00Z',
  '2026-01-01T09:00:00+09:00',
  '2030-01-01T00:00:00Z',
] as const;

// 日付だけの綴り(`2030-01-01`)は入れない —— Postgres はそれをセッションのタイムゾーンで解釈し、
// JS は UTC で解釈するので、DB の設定によって割れる。境界に UTC オフセットを必ず書く規約
// (datetime.md)の下では、そもそも日付だけの日時リテラルは書かれない。

const UUIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] as const;

const EQ_OPS = ['==', '!='] as const;
const ORDER_ONLY_OPS = ['<', '<=', '>', '>='] as const;
const ALL_OPS = [...EQ_OPS, ...ORDER_ONLY_OPS] as const;

/** 原子 1 つ。`rejected` は「翻訳器が断る(= V2 が error にする)」ことの宣言。 */
interface Atom {
  readonly source: string;
  readonly rejected: boolean;
}

/** ガード式の環境(TS の env と SQL の引数の両方をこの 1 つから作る)。 */
interface EnvValues {
  readonly state: string | null;
  readonly kind: string | null;
  readonly flag: boolean | null;
  readonly cnt: number | null;
  readonly opensAt: string | null;
  readonly ownerId: string | null;
  readonly otherCnt: number | null;
  readonly otherOpensAt: string | null;
  readonly actorId: string | null;
  readonly tagsHasActor: boolean | null;
}

/** 値か NULL か(どの欄も「無い」を取り得る)。 */
function nullable<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null> {
  return fc.option(arb, { nil: null, freq: 4 });
}

const envArb: fc.Arbitrary<EnvValues> = fc.record({
  state: nullable(fc.constantFrom(...STATES)),
  kind: nullable(fc.constantFrom(...KINDS)),
  flag: nullable(fc.boolean()),
  cnt: nullable(fc.integer({ min: -2, max: 2 })),
  opensAt: nullable(fc.constantFrom(...TIMES)),
  ownerId: nullable(fc.constantFrom(...UUIDS)),
  otherCnt: nullable(fc.integer({ min: -2, max: 2 })),
  otherOpensAt: nullable(fc.constantFrom(...TIMES)),
  actorId: nullable(fc.constantFrom(...UUIDS)),
  tagsHasActor: nullable(fc.boolean()),
});

/** 写せる原子(翻訳器が断らない組)。 */
function allowed(source: string): Atom {
  return { source, rejected: false };
}

/** 原子 1 つの字面(文法の全構成要素をここで尽くす)。 */
const atomArb: fc.Arbitrary<Atom> = fc.oneof(
  fc.tuple(fc.constantFrom(...EQ_OPS), fc.constantFrom(...STATES)).map(([op, v]) => allowed(`doc.state ${op} ${v}`)),
  fc
    .uniqueArray(fc.constantFrom(...STATES), { minLength: 1, maxLength: 3 })
    .map((vs) => allowed(`doc.state in [${vs.join(', ')}]`)),
  fc
    .uniqueArray(fc.constantFrom(...STATES), { minLength: 1, maxLength: 2 })
    .map((vs) => allowed(`doc.state not in [${vs.join(', ')}]`)),
  fc.tuple(fc.constantFrom(...ALL_OPS), fc.constantFrom(...KINDS)).map(([op, v]) => allowed(`doc.kind ${op} ${v}`)),
  // boolean の欄には**全ての演算子**を振る。順序比較は TS が常に不明にするので翻訳器が断る。
  fc
    .tuple(fc.constantFrom(...ALL_OPS), fc.constantFrom('true', 'false'))
    .map(([op, v]) => ({ source: `doc.flag ${op} ${v}`, rejected: !EQ_OPS.includes(op as '==' | '!=') })),
  fc
    .tuple(fc.constantFrom('in', 'not in'), fc.constantFrom('true', 'false'))
    .map(([op, v]) => ({ source: `doc.flag ${op} [${v}]`, rejected: true })),
  fc
    .tuple(fc.constantFrom(...ALL_OPS), fc.integer({ min: -2, max: 2 }))
    .map(([op, v]) => allowed(`doc.cnt ${op} ${v}`)),
  fc.constantFrom(...ALL_OPS).map((op) => allowed(`doc.cnt ${op} other.cnt`)),
  fc.constantFrom(...ALL_OPS).map((op) => allowed(`now ${op} doc.opens_at`)),
  fc.constantFrom(...ALL_OPS).map((op) => allowed(`doc.opens_at ${op} other.opens_at`)),
  fc
    .tuple(fc.constantFrom(...ALL_OPS), fc.constantFrom(...TIME_LITERALS))
    .map(([op, v]) => allowed(`doc.opens_at ${op} ${v}`)),
  fc.constantFrom(...EQ_OPS).map((op) => allowed(`doc.owner_id ${op} actor.id`)),
  fc.constant(allowed('doc.tags contains actor.id')),
);

/** clause := [ not ] atom。 */
const clauseArb: fc.Arbitrary<Atom> = fc
  .tuple(fc.boolean(), atomArb)
  .map(([negated, atom]) => ({ ...atom, source: negated ? `not ${atom.source}` : atom.source }));

/** expr := clause ( ("and" | "or") clause )*。式全体は 1 つでも断られる節があれば断られる。 */
const exprArb: fc.Arbitrary<Atom> = fc
  .tuple(clauseArb, fc.array(fc.tuple(fc.constantFrom('and', 'or'), clauseArb), { maxLength: 3 }))
  .map(([head, rest]) =>
    rest.reduce(
      (acc, [op, clause]) => ({
        source: `${acc.source} ${op} ${clause.source}`,
        rejected: acc.rejected || clause.rejected,
      }),
      head,
    ),
  );

let client: Client;

beforeAll(async () => {
  const connectionString = process.env['SUPABASE_DB_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('環境変数 SUPABASE_DB_URL が設定されていません(@kaninabe/runtime/testing/local/local-supabase.mts)。');
  }
  client = new Client({ connectionString });
  await client.connect();
  await setupRoleTables(client);
});

afterAll(async () => {
  await client.end();
});

/** 環境を SQL の引数の並びにする(ENV_CTE の $1..$10 と同じ順)。 */
function envParams(env: EnvValues): readonly unknown[] {
  return [
    env.state,
    env.kind,
    env.flag,
    env.cnt,
    env.opensAt,
    env.ownerId,
    env.otherCnt,
    env.otherOpensAt,
    env.actorId,
    env.tagsHasActor,
  ];
}

/** 環境を TS の評価器の env にする(`now` は DB が使った現在時刻をそのまま渡す)。 */
function guardEnv(env: EnvValues, now: string): GuardEnv {
  return {
    'doc.state': env.state,
    'doc.kind': env.kind,
    'doc.flag': env.flag,
    'doc.cnt': env.cnt,
    'doc.opens_at': env.opensAt,
    'doc.owner_id': env.ownerId,
    'other.cnt': env.otherCnt,
    'other.opens_at': env.otherOpensAt,
    'actor.id': env.actorId,
    now,
    [containsKey('doc.tags', 'actor.id')]: env.tagsHasActor,
  };
}

/** 式 1 本を翻訳する(パースは通る前提)。 */
function translate(source: string): GuardSqlResult {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(`ガード式をパースできません: ${source} (${parsed.error.message})`);
  return guardToSql(parsed.expr, GUARD_BINDINGS);
}

/** 式 1 本を翻訳し、実 DB で実行する。戻り値は判定と、DB が使った現在時刻。 */
async function evaluateInDatabase(
  source: string,
  env: EnvValues,
): Promise<{ readonly result: boolean; readonly now: string }> {
  const translated = translate(source);
  if (!translated.ok) {
    throw new Error(`SQL に写せません: ${source} (${[...translated.unresolved, ...translated.rejected].join(', ')})`);
  }
  const rows = await client.query<{ result: boolean; at: Date }>(
    `${ENV_CTE}\nselect ${translated.sql} as result, g.v_now as at from g`,
    [...envParams(env)],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error('述語の評価結果が返りませんでした');
  return { result: row.result, now: row.at.toISOString() };
}

/** 同じ式を TS の評価器で判定する(不明は不成立に畳む = canFire と同じ扱い)。 */
function evaluateInTypeScript(source: string, env: EnvValues, now: string): boolean {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(`ガード式をパースできません: ${source}`);
  const data = guardExprData(parsed.expr) as unknown as GuardExprData;
  return evaluateGuard(data, guardEnv(env, now)) === true;
}

describe('ガード式の SQL 翻訳(束 ⑳-1)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-GUARDSQL-001
  it('文法の全構成要素と NULL を振っても実 DB の述語と TS の評価器が同じ判定を下す', async () => {
    await fc.assert(
      fc.asyncProperty(exprArb, envArb, async (expr, env) => {
        if (expr.rejected) {
          // TS が常に不明にする組(boolean への in / 順序比較)は、そもそも SQL に写さない。
          expect(translate(expr.source).ok).toBe(false);
          return;
        }
        const inDatabase = await evaluateInDatabase(expr.source, env);
        expect(evaluateInTypeScript(expr.source, env, inDatabase.now)).toBe(inDatabase.result);
      }),
      { numRuns: 300 },
    );
  });

  it('原子ごとに NULL を偽へ潰すと not の下で DB だけが通す(式全体を 1 回だけ閉じる根拠)', async () => {
    const env: EnvValues = {
      state: null,
      kind: null,
      flag: null,
      cnt: null,
      opensAt: null,
      ownerId: null,
      otherCnt: null,
      otherOpensAt: null,
      actorId: null,
      tagsHasActor: null,
    };
    const rows = await client.query<{ atom_first: boolean; whole: boolean }>(
      `${ENV_CTE}\nselect coalesce(not coalesce(g.state = 'draft', false), false) as atom_first,` +
        `\n       coalesce((not (g.state = 'draft')), false) as whole from g`,
      [...envParams(env)],
    );
    const row = rows.rows[0];
    expect(row?.atom_first).toBe(true);
    expect(row?.whole).toBe(false);
    const inDatabase = await evaluateInDatabase('not doc.state == draft', env);
    expect(inDatabase.result).toBe(false);
    expect(evaluateInTypeScript('not doc.state == draft', env, inDatabase.now)).toBe(false);
  });

  it('既知の食い違い: text の順序比較は照合順序に依るので、翻訳器が collate を付けて閉じる', async () => {
    const parsed = parseGuard('doc.kind < beta');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const translated = guardToSql(parsed.expr, GUARD_BINDINGS);
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;
    expect(translated.sql).toContain('collate "C"');
    const rows = await client.query<{ naive: boolean; translated: boolean }>(
      `with g as (select 'Beta'::text as kind)\nselect (g.kind < 'beta') as naive, ${translated.sql} as translated from g`,
    );
    // JS の文字列比較(コード単位順)では 'Beta' < 'beta' は真。DB 既定の照合順序では偽。
    expect('Beta' < 'beta').toBe(true);
    expect(rows.rows[0]?.naive).toBe(false);
    expect(rows.rows[0]?.translated).toBe(true);
  });

  it('欄の種別を宣言しない呼び側には写さない(照合順序を誰も見ないまま実行しない)', () => {
    const parsed = parseGuard('doc.kind < beta');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = guardToSql(parsed.expr, { ...GUARD_BINDINGS, valueKind: () => null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved).toEqual(['doc.kind']);
  });

  it('boolean の欄への in / 順序比較は翻訳せず理由を返す(V2 が同じ組を error にする)', () => {
    for (const source of ['doc.flag in [true]', 'doc.flag > false', 'doc.flag <= true']) {
      const result = translate(source);
      expect(result.ok, source).toBe(false);
      if (result.ok) continue;
      expect(result.unresolved).toEqual([]);
      expect(result.rejected).toHaveLength(1);
    }
  });
});

/** 差分テストのためだけのロール定義(このリポジトリの roles.md ではなく、3 種の根拠を 1 つずつ持つ最小形)。 */
const ROLE_LOCATION = { file: 'legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts' } as const;

/** 文脈依存ロール(1 段の束縛)。 */
const OWNER_ROLE = 'parity_doc_owner';
/** 文脈依存ロール(2 段の束縛 = 参照を 1 つ辿る)。 */
const MANAGER_ROLE = 'parity_folder_manager';
/** 文脈依存ロール(配列の列に実行者が入っているか = `contains` の束縛)。 */
const TAGGED_ROLE = 'parity_doc_tagged';
/** 実行者自身の行の欄が根拠のロール(claim)。 */
const CLAIM_ROLE = 'parity_person_staff';

/** 未ログインの実行者が渡すロール。 */
const ANONYMOUS_ROLE = 'parity_anonymous';
/** ログイン済みの実行者が必ず渡すロール。 */
const MEMBER_ROLE = 'parity_member';
/** 管理者。**`member` を含意する**(渡すのは自分だけ = 含意を閉じないと DB だけが落とす)。 */
const ADMIN_ROLE = 'parity_admin';

const ROLE_DEFS: readonly RoleDef[] = [
  { id: ANONYMOUS_ROLE, kind: 'anonymous', location: ROLE_LOCATION },
  { id: MEMBER_ROLE, kind: 'authenticated_default', location: ROLE_LOCATION },
  { id: ADMIN_ROLE, implies: [MEMBER_ROLE], location: ROLE_LOCATION },
  { id: 'parity_system', kind: 'system', location: ROLE_LOCATION },
  { id: OWNER_ROLE, binding: 'doc.owner_id == actor.id', location: ROLE_LOCATION },
  { id: MANAGER_ROLE, binding: 'folder.manager_id == actor.id', location: ROLE_LOCATION },
  { id: TAGGED_ROLE, binding: 'doc.tag_ids contains actor.id', location: ROLE_LOCATION },
  { id: CLAIM_ROLE, claim: 'person.is_staff', location: ROLE_LOCATION },
];

/** ロールの翻訳に渡す解決(引数名・対象の行・辿る先の表・実行者自身の行・欄の種別)。 */
const ROLE_BINDINGS = {
  actorId: '$1::uuid',
  actorRoles: '$2::text[]',
  reach: (entity: string) => {
    if (entity === 'doc') return { kind: 'row', alias: 'd' } as const;
    if (entity === 'folder') {
      return { kind: 'join', table: 'parity_folder', alias: 'f', on: 'f.id = d.folder_id' } as const;
    }
    return null;
  },
  actorRow: (entity: string) => (entity === 'person' ? { table: 'parity_person' } : null),
  valueKind: (): ValueKind => 'opaque',
};

/** 実行者の行(id → staff の宣言)。`null` は「欄が空」、行そのものが無い実行者も混ぜる。 */
const PERSONS: readonly { readonly id: string; readonly isStaff: boolean | null }[] = [
  { id: '33333333-3333-4333-8333-333333333331', isStaff: true },
  { id: '33333333-3333-4333-8333-333333333332', isStaff: false },
  { id: '33333333-3333-4333-8333-333333333333', isStaff: null },
];

/** 行の無い実行者(招待直後など、対象の表に行が無い実行者)。 */
const STRANGER = '44444444-4444-4444-8444-444444444444';

/** 辿る先の行(2 段の束縛)。 */
const FOLDERS: readonly { readonly id: string; readonly managerId: string | null }[] = [
  { id: '55555555-5555-4555-8555-555555555551', managerId: null },
  { id: '55555555-5555-4555-8555-555555555552', managerId: PERSONS[0]?.id ?? '' },
  { id: '55555555-5555-4555-8555-555555555553', managerId: PERSONS[1]?.id ?? '' },
];

/** 配列の列に入る実行者の組(`contains` の束縛)。空配列と NULL の両方を混ぜる。 */
const TAG_SETS: readonly (readonly string[] | null)[] = [
  [],
  [PERSONS[0]?.id ?? ''],
  [PERSONS[1]?.id ?? '', PERSONS[2]?.id ?? ''],
  null,
];

/** 対象の行(所有者 × 辿る先の全組み合わせ)。 */
interface DocRow {
  readonly id: string;
  readonly ownerId: string | null;
  readonly folderId: string | null;
  readonly tagIds: readonly string[] | null;
}

/** 対象の行の一覧(所有者 3 通り × 辿る先 4 通り)。 */
const DOCS: readonly DocRow[] = [null, PERSONS[0]?.id ?? '', PERSONS[1]?.id ?? ''].flatMap(
  (ownerId, ownerIndex) =>
    [null, ...FOLDERS.map((folder) => folder.id)].map((folderId, folderIndex) => ({
      id: `66666666-6666-4666-8666-6666666666${ownerIndex}${folderIndex}`,
      ownerId,
      folderId,
      tagIds: TAG_SETS[folderIndex] ?? null,
    })),
);

/** 差分テスト専用の一時表(接続ローカル)を作り、全組み合わせの行を入れる。 */
async function setupRoleTables(connection: Client): Promise<void> {
  await connection.query(
    'create temporary table parity_person (id uuid primary key, is_staff boolean)',
  );
  await connection.query(
    'create temporary table parity_folder (id uuid primary key, manager_id uuid)',
  );
  await connection.query(
    'create temporary table parity_doc (id uuid primary key, owner_id uuid, folder_id uuid, tag_ids uuid[])',
  );
  for (const person of PERSONS) {
    await connection.query('insert into parity_person values ($1, $2)', [person.id, person.isStaff]);
  }
  for (const folder of FOLDERS) {
    await connection.query('insert into parity_folder values ($1, $2)', [folder.id, folder.managerId]);
  }
  for (const doc of DOCS) {
    await connection.query('insert into parity_doc values ($1, $2, $3, $4)', [
      doc.id,
      doc.ownerId,
      doc.folderId,
      doc.tagIds,
    ]);
  }
}

/**
 * 実行者が**自分で渡す**グローバルロール(まだ含意で閉じていない生の集合)。
 *
 * 1 人目は `parity_admin` しか渡さない —— `parity_admin implies parity_member` なので、
 * 閉じずに渡すと `by: [parity_member]` を **DB だけが落とす**。
 */
function declaredRolesOf(actorId: string | null): readonly string[] {
  if (actorId === null) return [ANONYMOUS_ROLE];
  return actorId === PERSONS[0]?.id ? [ADMIN_ROLE] : [MEMBER_ROLE];
}

/**
 * `p_actor_roles` に渡す集合(**含意の推移閉包で閉じたもの**)。
 *
 * これが仕組みの契約であり(domain-spec-writing.md §role_spec / roles-to-sql.ts の docstring)、
 * app の `resolveActorRoles` が生成物 `ROLE_IMPLICATIONS` を読んで作る集合と同じ形である。
 * 閉包を外すとこのテストが落ちる —— それが契約の実測になる。
 */
function actorRolesParam(actorId: string | null): readonly string[] {
  const closed = new Set<string>(declaredRolesOf(actorId));
  for (const role of declaredRolesOf(actorId)) {
    for (const implied of impliedRoles(ROLE_DEFS, role)) closed.add(implied);
  }
  return [...closed];
}

/**
 * 実行者がそのロールを持つか(TS 側)。
 *
 * **文脈依存ロールの根拠はガード式そのもの**なので、判定は上と同じ評価器に委ねる
 * (`binding` は `guard` と同じ文法・同じ意味論である)。グローバルロールは実行者が渡す
 * 宣言とその**含意**、`claim` は実行者自身の行の欄 —— どちらも式ではなく構造の宣言である。
 */
function holdsRole(role: RoleDef, actorId: string | null, doc: DocRow): boolean {
  if (role.claim !== undefined) {
    return PERSONS.find((person) => person.id === actorId)?.isStaff === true;
  }
  if (role.binding === undefined) {
    const declared = declaredRolesOf(actorId);
    return declared.includes(role.id) || declared.some((id) => impliedRoles(ROLE_DEFS, id).has(role.id));
  }
  const parsed = parseGuard(role.binding);
  if (!parsed.ok) throw new Error(`binding をパースできません: ${role.binding}`);
  const folder = FOLDERS.find((candidate) => candidate.id === doc.folderId);
  const env: GuardEnv = {
    'doc.owner_id': doc.ownerId,
    'folder.manager_id': folder?.managerId ?? null,
    'actor.id': actorId,
    [containsKey('doc.tag_ids', 'actor.id')]:
      doc.tagIds === null || actorId === null ? null : doc.tagIds.includes(actorId),
  };
  return evaluateGuard(guardExprData(parsed.expr) as unknown as GuardExprData, env) === true;
}

/** TS 側の判定(engine が `by` と解決済みロールを突き合わせるのと同じ「どれか 1 つ」)。 */
function allowedInTypeScript(by: readonly string[], actorId: string | null, doc: DocRow): boolean {
  return by.some((id) => {
    const role = ROLE_DEFS.find((candidate) => candidate.id === id);
    return role !== undefined && holdsRole(role, actorId, doc);
  });
}

/** DB 側の判定(翻訳した述語を対象の行に対して実行する)。 */
async function allowedInDatabase(
  by: readonly string[],
  actorId: string | null,
  doc: DocRow,
): Promise<boolean> {
  const translated = rolesToSql(by, ROLE_DEFS, ROLE_BINDINGS);
  if (!translated.ok) {
    throw new Error(`SQL に写せません: ${[...translated.unresolved, ...translated.rejected].join(', ')}`);
  }
  // 使われない引数があると Postgres が型を決められないので、両方を select 句にも置いて型を固定する
  // (`by` がグローバルロールだけなら `$1` が、束縛だけなら `$2` が述語に現れない)。
  const rows = await client.query<{ result: boolean }>(
    `select ${translated.sql} as result, $1::uuid as actor_id, $2::text[] as actor_roles` +
      '\n  from parity_doc d where d.id = $3::uuid',
    [actorId, actorRolesParam(actorId), doc.id],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error('対象の行が見つかりませんでした');
  return row.result;
}

describe('ロールの by の SQL 翻訳(束 ⑳-1)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-GUARDSQL-002
  it('グローバル・claim・1 段と 2 段の束縛・contains・implies を振っても実 DB の述語と解決済みロールが一致する', async () => {
    const byArb = fc.uniqueArray(fc.constantFrom(...ROLE_DEFS.map((role) => role.id)), {
      minLength: 1,
      maxLength: 3,
    });
    const actorArb = fc.constantFrom<string | null>(
      null,
      PERSONS[0]?.id ?? '',
      PERSONS[1]?.id ?? '',
      PERSONS[2]?.id ?? '',
      STRANGER,
    );
    await fc.assert(
      fc.asyncProperty(byArb, actorArb, fc.constantFrom(...DOCS), async (by, actorId, doc) => {
        expect(allowedInTypeScript(by, actorId, doc)).toBe(await allowedInDatabase(by, actorId, doc));
      }),
      { numRuns: 300 },
    );
  });

  it('空の by は誰も通さない', () => {
    expect(rolesToSql([], ROLE_DEFS, ROLE_BINDINGS)).toEqual({ ok: true, sql: 'false' });
  });

  it('含意を閉じずに渡すと DB だけが落とす(p_actor_roles の契約の実測)', async () => {
    const admin = PERSONS[0]?.id ?? '';
    const doc = DOCS[0];
    expect(doc).toBeDefined();
    if (doc === undefined) return;
    const translated = rolesToSql([MEMBER_ROLE], ROLE_DEFS, ROLE_BINDINGS);
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;
    const shoot = async (roles: readonly string[]): Promise<boolean> => {
      const rows = await client.query<{ result: boolean }>(
        `select ${translated.sql} as result, $1::uuid as actor_id, $2::text[] as actor_roles` +
          '\n  from parity_doc d where d.id = $3::uuid',
        [admin, roles, doc.id],
      );
      return rows.rows[0]?.result === true;
    };
    // TS は「admin は implies で member である」と判定する。
    expect(allowedInTypeScript([MEMBER_ROLE], admin, doc)).toBe(true);
    expect(await shoot(declaredRolesOf(admin))).toBe(false);
    expect(await shoot(actorRolesParam(admin))).toBe(true);
  });
});
