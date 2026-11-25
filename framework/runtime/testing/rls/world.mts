import { randomUUID } from 'node:crypto';
import type { Client as PgClient } from 'pg';
import type { HarnessPorts, SeededUser } from '../harness/ports.mjs';
import { orderForInsert } from '../pg/insert-order.mjs';
import type { RlsWorld, RlsWorldRow } from './types.mjs';

/**
 * RLS の挙動テストの**world の作り方**(束 ⑳-4b)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 仕様: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md §RLS
 *       docs/specs/backend/guarantees.md(`policy_body_from_spec`)
 *
 * 生成テストが渡すのは設計図(製品の生成物)と**口**(`HarnessPorts`)だけである —— 集約名・
 * ロール名・列名はすべて設計図から来るので、**このファイルにアプリの語彙は 1 語も無い**。
 *
 * ## world を作る手順
 *
 * 1. 実行者の数だけ認証ユーザを作る(`auth.admin.createUser`)。id は先に決まる。
 * 2. 行の id を**全部先に決める**。実行者自身の行の id は認証ユーザの id であり、それ以外は
 *    ここで振る —— 参照が循環していても(互いの行を指す外部キーのように)全部の参照を先に解けるようにする。
 *    **実行者の集約の行だけは、実行者として実行しない行でも認証ユーザを作る**(その集約の行の id は
 *    `auth.uid()` そのものであり、認証ユーザの無い行は置けない)。
 * 3. 1 トランザクションで、設計図の順(遅延できない外部キーの参照先が先に来るよう、実 DB のカタログで
 *    並べ直したもの)に挿入する。`set constraints all deferred` を掛けるのは
 *    循環の 1 辺(遅延可能な外部キー)の検査をコミットまで遅らせるためである。
 * 4. `writeSessionProfile` でセッション属性(`app_metadata.profile`)を書き、ログインして
 *    アクセストークンを取る。写しは製品の実行計画の先読みが読むもので、**境界(`filters`)の判定は
 *    この枝を読まない** —— ポリシーは実行者自身の行を補助関数(`actor_{欄}()`)で読み、オラクルも行を見る。
 * 5. 入れた行を**読み直す**(`select *`)。列の既定値やトリガが決めた値まで含めて、オラクルは
 *    「実際にそこにある行」を見て判定する。
 *
 * 読み取りは画面と同じ経路(`api` スキーマのビュー + anon キー + ユーザ JWT)である。ビューは
 * `security_invoker = true` なので、`public` のテーブルに張った RLS と権限がそのまま効く。
 */

/** 実 DB に作った行 1 つ。 */
export interface BuiltRlsRow {
  readonly key: string;
  readonly table: string;
  readonly entity: string;
  readonly id: string;
  /** 読み直した列の値(既定値・トリガの結果を含む)。 */
  readonly values: Readonly<Record<string, unknown>>;
}

/** 実 DB に作った実行者 1 人。 */
export interface BuiltRlsActor {
  readonly key: string;
  /** 認証ユーザの id(未ログインなら `null`)。 */
  readonly id: string | null;
  /** アクセストークン(未ログインなら `null`)。 */
  readonly token: string | null;
  /** セッション属性(`app_metadata.profile` に書いたもの)。 */
  readonly claims: Readonly<Record<string, unknown>>;
}

/** 実 DB に作った world。 */
export interface BuiltRlsWorld {
  readonly rows: ReadonlyMap<string, BuiltRlsRow>;
  readonly actors: ReadonlyMap<string, BuiltRlsActor>;
}

/** 実 DB から読み取った結果。 */
export interface ReadResult {
  /** 権限が無く拒否された(0 行とは別物)。 */
  readonly denied: boolean;
  readonly ids: readonly string[];
}

/**
 * 設計図どおりの world を実 DB に作る。
 *
 * @param world 表 1 枚ぶんの設計図(生成物)
 * @param ports 製品が渡す口(実 DB とセッションに触る手)
 * @returns 行と実行者の実体(id・トークン・セッション属性)
 */
export async function createRlsWorld(world: RlsWorld, ports: HarnessPorts): Promise<BuiltRlsWorld> {
  await ports.resetDatabase();

  // ① 認証ユーザを先に作る(実行者自身の行の id は認証ユーザの id である)。
  const users = new Map<string, SeededUser>();
  const ids = new Map<string, string>();
  for (const actor of world.actors) {
    if (actor.anonymous) continue;
    const user = await ports.seedAuthUser();
    users.set(actor.key, user);
    if (actor.row !== null) ids.set(actor.row, user.id);
  }
  // ② 残りの行の id も先に振る(循環した参照も先に解けるようにする)。
  for (const row of world.rows) {
    if (ids.has(row.key)) continue;
    // **実行者の集約の行は認証ユーザと 1 対 1 である**(その id がそのまま `auth.uid()` になる)。
    // だから実行者として実行しない行でも認証ユーザを作る —— 束縛の列のために分けた「別人」の行も、
    // その集約の行である限り、ログインできる人でなければ置けない。
    const id = row.table === world.actorTable ? (await ports.seedAuthUser()).id : randomUUID();
    ids.set(row.key, id);
  }

  await insertRows(world, ids, ports);

  // ③ セッション属性を書いてログインする(写しは先読みのため。境界の判定は実行者の行を読む)。
  const actors = new Map<string, BuiltRlsActor>();
  for (const actor of world.actors) {
    const user = users.get(actor.key);
    if (user === undefined) {
      actors.set(actor.key, { key: actor.key, id: null, token: null, claims: {} });
      continue;
    }
    await ports.writeSessionProfile(user.id);
    const token = await ports.signIn(user);
    actors.set(actor.key, {
      key: actor.key,
      id: user.id,
      token,
      claims: claimsOf(await ports.readSessionProfile(user.id), ports.sessionFields),
    });
  }
  return { rows: await readBack(world, ids, ports), actors };
}

/**
 * world を片付ける(次のテストファイルが同じ実 DB を使う)。
 *
 * @param ports 製品が渡す口
 */
export async function resetRlsWorld(ports: HarnessPorts): Promise<void> {
  await ports.resetDatabase();
}

/** 読み直したセッション属性を、宣言された欄の表に写す。 */
function claimsOf(
  profile: Readonly<Record<string, unknown>> | undefined,
  sessionFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const claims: Record<string, unknown> = {};
  for (const field of sessionFields) claims[field] = profile?.[field];
  return claims;
}

/**
 * 設計図の順に 1 トランザクションで挿入する。
 *
 * `set constraints all deferred` は循環の 1 辺のためである —— 参照先が先に来る並びにしても、
 * 循環していれば 1 本だけは「まだ無い行」を指す。その 1 本が遅延可能な外部キーとして宣言されて
 * いれば(D-8 の出生の循環はそう宣言されている)、コミット時には両方が揃っている。
 */
async function insertRows(
  world: RlsWorld,
  ids: ReadonlyMap<string, string>,
  ports: HarnessPorts,
): Promise<void> {
  await ports.withPg(async (pg) => {
    await pg.query('begin');
    try {
      await pg.query('set constraints all deferred');
      for (const row of await orderForInsert(pg, world.rows)) await insertRow(pg, row, ids);
      await pg.query('commit');
    } catch (cause) {
      await pg.query('rollback');
      throw cause;
    }
  });
}

/** 行 1 つの挿入(列名と値は設計図が決めている)。 */
async function insertRow(
  pg: PgClient,
  row: RlsWorldRow,
  ids: ReadonlyMap<string, string>,
): Promise<void> {
  const values: Record<string, unknown> = { id: ids.get(row.key), ...row.values };
  for (const [column, key] of Object.entries(row.refs)) values[column] = ids.get(key);
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  await pg.query(
    `insert into public.${row.table} (${columns.join(', ')}) values (${placeholders.join(', ')})`,
    columns.map((column) => values[column]),
  );
}

/** 入れた行を読み直す(既定値・トリガが決めた値まで含めてオラクルに渡す)。 */
async function readBack(
  world: RlsWorld,
  ids: ReadonlyMap<string, string>,
  ports: HarnessPorts,
): Promise<ReadonlyMap<string, BuiltRlsRow>> {
  const rows = new Map<string, BuiltRlsRow>();
  await ports.withPg(async (pg) => {
    for (const row of world.rows) {
      const id = ids.get(row.key) ?? '';
      const result = await pg.query<Record<string, unknown>>(
        `select * from public.${row.table} where id = $1`,
        [id],
      );
      const found = result.rows[0];
      if (found === undefined) continue;
      rows.set(row.key, { key: row.key, table: row.table, entity: row.entity, id, values: found });
    }
  });
  return rows;
}

/**
 * その実行者として `api` のビューを読む(画面と同じ経路)。
 *
 * ビューは `security_invoker = true` なので、`public` のテーブルの RLS と権限がそのまま効く ——
 * 「権限が無い」は 0 行ではなくエラーとして返る(そこが宣言の `scope: none` と `grant` の差である)。
 *
 * @param world 設計図
 * @param built 実 DB の world
 * @param actorKey 実行者の名前
 * @param ports 製品が渡す口
 * @returns 拒否されたか、見えた id
 */
export async function readAsActor(
  world: RlsWorld,
  built: BuiltRlsWorld,
  actorKey: string,
  ports: HarnessPorts,
): Promise<ReadResult> {
  const token = built.actors.get(actorKey)?.token;
  const client = ports.createRlsClient(token ?? undefined);
  const { data, error } = await client.from(world.table).select('id');
  if (error !== null && error !== undefined) return { denied: true, ids: [] };
  return { denied: false, ids: (data as readonly { readonly id: string }[]).map((row) => row.id) };
}
