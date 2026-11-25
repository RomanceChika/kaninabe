import { withActorInputs } from './actor-inputs.mjs';
import { randomUUID } from 'node:crypto';
import type { Client as PgClient } from 'pg';
import { eqSubjectValues } from '@kaninabe/runtime/sql/eq-subject';
import type { HarnessPorts } from '../harness/ports.mjs';
import { orderForInsert } from '../pg/insert-order.mjs';
import type {
  EqActor,
  EqAxisValue,
  EqOperation,
  EqPlacement,
  EqRoleArray,
  EqWorld,
  EqWorldRow,
} from './types.mjs';

/**
 * engine ⇔ RPC の一致の証明の**world の作り方**(束 ⑳-5a)。生成物ではなく、仕組み側に 1 回だけ
 * 手で書く。
 *
 * 仕様: docs/rules/decisions/common/ADR-0012-db-as-authority.md ⑤
 *       docs/specs/backend/guarantees.md(`rpc_enforces_spec`)
 *
 * ⑳-4b の RLS の world(`rls/world.mts`)との違いは 2 つだけで、どちらも実行者の出どころから来る。
 *
 * - RLS の実行者は**ログインした人**(JWT)だが、RPC の実行者は**引数**である
 *   (`p_actor_id` + `p_actor_roles`)。だからログインもセッション属性の書き込みも要らない ——
 *   要るのは実行者の集約の行(`claim` の根拠)と、対象の行の列(`binding` の根拠)だけである。
 * - 対象の行は**動く**(状態が変わる・消える・生まれる)ので、world は「1 度置いて全部実行する」
 *   ではなく**実行する直前に置き直す**。置き直す値は設計図(`eq-worlds.ts`)が運ぶ。
 *
 * 生成テストが渡すのは設計図と操作 ID と**口**(`HarnessPorts`)だけである —— 集約名・ロール名・
 * 列名はすべて設計図から来るので、**このファイルにアプリの語彙は 1 語も無い**。
 *
 * 「設計図 → 置き直したあとの行の値」は**仕様側と同じ 1 本**(`@kaninabe/runtime/sql/eq-subject`)
 * である。ここが持つのはその 1 本に渡す**行の読み方**(実 DB から読み直した行)だけで、
 * ハンドブックの結果表は同じ 1 本に「設計図が入れると宣言した値」を渡す(束 ⑳-5b-b)。
 */

/**
 * **このテストファイル 1 本のあいだ開いたままにする接続。**
 *
 * 実行する組み合わせは 1 集約で数百〜数千あり、そのたびに `withPg` で開き直すと TCP と認証の
 * 往復だけが積み上がる(⑯c-1d で統合の setup を 278 秒から 1 秒にしたのと同じ話である)。
 * vitest はテストファイルごとにモジュールを読み直すので、ここが持つ 1 本はそのファイルに
 * 閉じている —— `resetEqWorld`(`afterAll`)が必ず閉じる。
 */
let shared: PgClient | null = null;

/**
 * 開いたままの接続を得る(無ければ開く)。
 *
 * @param ports 製品が渡す口
 * @returns 接続済みクライアント
 */
export async function eqPg(ports: HarnessPorts): Promise<PgClient> {
  const opened = shared ?? (await ports.connectPg());
  shared = opened;
  return opened;
}

/** 実 DB に作った行 1 つ。 */
export interface BuiltEqRow {
  readonly key: string;
  readonly table: string;
  readonly entity: string;
  readonly id: string;
  /** 読み直した列の値(既定値・トリガの結果を含む)。 */
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * world を実 DB に作れる設計図の形(単発の操作と保存点が共有する)。
 *
 * 作るのに要るのは「実行者の集約の表名」「実行者の並び」「挿入順の行」だけであり、そこは
 * 単発の操作(`EqWorld`)と保存点(`EqSaveWorld`)で同じである —— 違うのは実行する単位の側だけなので、
 * world を作る関数を 2 つ持たない。
 */
export interface EqBuildableWorld {
  readonly actorTable: string;
  readonly actors: readonly { readonly key: string; readonly row: string | null }[];
  /** 挿入順の行(参照先が先)。 */
  readonly rows: readonly EqWorldRow[];
}

/** 実 DB に作った world。 */
export interface BuiltEqWorld {
  readonly rows: ReadonlyMap<string, BuiltEqRow>;
  /** 実行者の名前 → その人の id(行が無い人には実在しない id を振る)。 */
  readonly actorIds: ReadonlyMap<string, string>;
}

/** 実行する組み合わせ 1 つ(軸の直積の 1 点)。 */
export interface EqSelection {
  readonly operation: EqOperation;
  readonly actor: EqActor;
  readonly array: EqRoleArray;
  readonly state: string | null;
  readonly field: string | null;
  /** 軸ごとに選んだ値(宣言順)。 */
  readonly axis: readonly EqAxisValue[];
  /** 食い違いの報告に出る名前。 */
  readonly label: string;
  /** 作成が使う新しい id(それ以外の形では使わない)。 */
  readonly newId: string;
  /**
   * **他の系統の対象の行**で実行する組み合わせなら、その系統の対象の行の名前(自分の系統なら null)。
   *
   * world の系統は実行者ごとに別のテナントの根を持つ(系統の行はみな実行者の行から遡って作られる)ので、
   * 他の系統の行は「他のテナントの行」である。境界を結んだ操作(`EqOperation.crossTenant`)でだけ作る。
   */
  readonly branch: string | null;
}

/**
 * その組み合わせが実行する系統の対象の行の名前(他の系統を選んだならそれ・無ければ実行者の系統・行が無い人は最初の系統)。
 *
 * @param world 集約 1 つぶんの設計図
 * @param selection 組み合わせ
 * @returns 系統の対象の行の名前
 */
export function branchOf(world: EqWorld, selection: EqSelection): string {
  return selection.branch ?? selection.actor.target ?? world.actors.find((a) => a.target !== null)?.target ?? '';
}

/** その組み合わせで実行する相手(行の id と、置き直したあとの値)。 */
export interface EqSubject {
  readonly actorId: string;
  /** 対象の行の id(作成では新しく作る行の id)。 */
  readonly targetId: string;
  /** 集約 → その行の id。 */
  readonly ids: ReadonlyMap<string, string>;
  /** 集約 → 列 → 置き直したあとの値。 */
  readonly values: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** 実行者自身の行の値(`claim` の根拠)。行が無い人では空。 */
  readonly actorRow: Readonly<Record<string, unknown>>;
  /** 作成・編集が入力に載せる値(欄 → 値)。 */
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * 設計図どおりの world を実 DB に作る。
 *
 * @param world 集約 1 つぶんの設計図(生成物)
 * @param ports 製品が渡す口
 * @returns 行と実行者の実体(id と読み直した値)
 */
export async function createEqWorld(world: EqBuildableWorld, ports: HarnessPorts): Promise<BuiltEqWorld> {
  await ports.resetDatabase();
  // 実行者の集約の行は認証ユーザと 1 対 1 である(その id がそのまま実行者の id になる)。
  const ids = new Map<string, string>();
  for (const row of world.rows) {
    ids.set(row.key, row.table === world.actorTable ? (await ports.seedAuthUser()).id : randomUUID());
  }
  await insertRows(world, ids, ports);
  const actorIds = new Map<string, string>();
  for (const actor of world.actors) {
    // 行が無い人には**実在しない id** を振る(ログインはできるが実行者の集約に行が無い人)。
    actorIds.set(actor.key, actor.row === null ? randomUUID() : (ids.get(actor.row) ?? randomUUID()));
  }
  return { rows: await readBack(world, ids, ports), actorIds };
}

/**
 * world を片付け、開いたままの接続を閉じる(次のテストファイルが同じ実 DB を使う)。
 *
 * @param ports 製品が渡す口
 */
export async function resetEqWorld(ports: HarnessPorts): Promise<void> {
  await ports.resetDatabase();
  const pg = shared;
  shared = null;
  if (pg !== null) await pg.end();
}

/** 設計図の順に 1 トランザクションで挿入する(循環の 1 辺は遅延可能な外部キーなので検査がコミットまで遅れる)。 */
async function insertRows(
  world: EqBuildableWorld,
  ids: ReadonlyMap<string, string>,
  ports: HarnessPorts,
): Promise<void> {
  const pg = await eqPg(ports);
  await pg.query('begin');
  try {
    await pg.query('set constraints all deferred');
    for (const row of await orderForInsert(pg, world.rows)) await insertRow(pg, row, ids);
    await pg.query('commit');
  } catch (cause) {
    await pg.query('rollback');
    throw cause;
  }
}

/** 行 1 つの挿入(列名と値は設計図が決めている)。 */
async function insertRow(pg: PgClient, row: EqWorldRow, ids: ReadonlyMap<string, string>): Promise<void> {
  const values: Record<string, unknown> = { id: ids.get(row.key), ...row.values };
  for (const [column, key] of Object.entries(row.refs)) values[column] = ids.get(key);
  const columns = Object.keys(values);
  await pg.query(
    `insert into public.${row.table} (${columns.join(', ')}) ` +
      `values (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
    columns.map((column) => values[column]),
  );
}

/** 入れた行を読み直す(既定値・トリガが決めた値まで含めて期待の材料にする)。 */
async function readBack(
  world: EqBuildableWorld,
  ids: ReadonlyMap<string, string>,
  ports: HarnessPorts,
): Promise<ReadonlyMap<string, BuiltEqRow>> {
  const rows = new Map<string, BuiltEqRow>();
  const pg = await eqPg(ports);
  for (const row of world.rows) {
    const id = ids.get(row.key) ?? '';
    const found = (
      await pg.query<Record<string, unknown>>(`select * from public.${row.table} where id = $1`, [id])
    ).rows[0];
    if (found === undefined) continue;
    rows.set(row.key, { key: row.key, table: row.table, entity: row.entity, id, values: found });
  }
  return rows;
}

/** その組み合わせが置き直す値(軸ごとに選んだ値の並び)。 */
export function placementsOf(selection: EqSelection): readonly EqPlacement[] {
  return selection.axis.flatMap((value) => value.placements);
}

/**
 * その組み合わせで実行する相手を決める(実 DB は読まない)。
 *
 * 行が無い人は系統を持たないので、**最初に系統を持つ人の対象の行**を実行する相手にする ——
 * 「ログインはできるが自分の行が無い人が、他人の行を動かそうとする」という実在の形である。
 */
export function subjectOf(world: EqWorld, built: BuiltEqWorld, selection: EqSelection): EqSubject {
  const branch = branchOf(world, selection);
  const target = world.rows.find((row) => row.key === branch);
  const aggregate = world.aggregate;
  const stateColumn = selection.operation.stateColumn;
  const subject = eqSubjectValues({
    targets: target?.ancestry ?? {},
    rowOf: (key) => built.rows.get(key),
    actorRow: selection.actor.row,
    actorEntities: selection.operation.actorReads,
    placements: placementsOf(selection),
    state:
      stateColumn === null || selection.state === null
        ? null
        : { entity: aggregate, column: stateColumn, value: selection.state },
  });
  const ids = new Map(subject.ids);
  const input: Record<string, unknown> = {};
  for (const placement of placementsOf(selection)) {
    if (placement.into === 'input') input[placement.column] = placement.value;
  }
  const created = selection.operation.kind === 'create';
  if (created) ids.set(aggregate, selection.newId);
  const actorId = built.actorIds.get(selection.actor.key) ?? '';
  return {
    actorId,
    targetId: created ? selection.newId : (ids.get(aggregate) ?? ''),
    ids,
    values: subject.values,
    actorRow: subject.actorRow,
    input: withActorInputs({ ...inputOf(world, built, selection, target, ids), ...input }, selection, actorId, [
      ...built.actorIds.values(),
    ]),
  };
}

/**
 * 入力に載せる値(対象の行の雛形 → 型から決めた既定値の順に決まる)。
 *
 * 雛形が先なのは**束縛のため**である —— 作成の `binding` は「入れようとしている列の値が
 * 自分か」を見るので、その系統の雛形が指す相手がそのまま判定に効く。
 */
function inputOf(
  world: EqWorld,
  built: BuiltEqWorld,
  selection: EqSelection,
  target: EqWorldRow | undefined,
  ids: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = { ...selection.operation.inputs };
  for (const [column, value] of Object.entries(target?.values ?? {})) input[column] = value;
  for (const [column, key] of Object.entries(target?.refs ?? {})) {
    const row = built.rows.get(key);
    if (row !== undefined) input[column] = row.id;
  }
  // 作成は一意の鍵の欄を world の行と当たらない値に置き直す(雛形は既にある行なので、写したままだと索引に当たる)。
  if (selection.operation.kind === 'create') Object.assign(input, selection.operation.fresh ?? {});
  // 編集で動かす欄が参照の列なら、その系統に置いてある行を指す(無ければ雛形の値のまま)。
  const field = selection.field;
  if (field !== null && input[field] === undefined) input[field] = ids.get(world.aggregate) ?? null;
  return input;
}
