import type { Client as PgClient } from 'pg';
import type { HarnessPorts } from '../harness/ports.mjs';
import type { EqWorld, EqWorldRow } from './types.mjs';
import type { BuiltEqWorld, EqSelection, EqSubject } from './world.mjs';
import { branchOf, eqPg } from './world.mjs';
import { anyRowOf, columnsToPlace, recordedColumns, recordedValue } from './place-columns.mjs';

/**
 * 一致の証明が**実行する直前に world を置き直す**部分(束 ⑳-5a)。world の設計図を持つ
 * `equivalence/world.mts` とは別に、ここは実行する直前の置き直しだけを持つ。
 *
 * 接続は**テストファイル 1 本につき 1 本**である(`equivalence/world.mts` の `eqPg`)—— 組み合わせごとに
 * 開き直すと、TCP と認証の往復だけが数千回積み上がる。
 *
 * 対象の行は動く(状態が変わる・消える・生まれる)ので、組み合わせを 1 つ実行するたびに**world を
 * 設計図の姿に戻してから**その組み合わせの値を置く。戻さないと、前の組み合わせが置いた値が
 * 残って「設計図とは違う world」で実行することになる(実測: `claim` の欄を偽にしたまま次の操作へ
 * 持ち越し、役が立たないまま全部が拒否された)。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * 実行する直前に対象の行を置き直す(状態とガード変数の境界値)。
 *
 * 作成は**対象の行を消してから**実行する —— その系統の雛形の行が残っていると、一意の宣言
 * (同じ親に同じ人が 2 つ作れない、など)に当たって「規則で拒否された」と区別が付かない。
 * それ以外の形は雛形の値で上書きする(前の組み合わせが状態を動かした・行を消したあとでも
 * 同じ world から始まる)。
 *
 * 同じ集約の列は**1 文でまとめて**置く —— 日時の欄どうしの順序(行内比較の不変条件)は、
 * 1 列ずつ動かすと途中で必ず崩れる。
 */
export async function placeCase(
  world: EqWorld,
  built: BuiltEqWorld,
  selection: EqSelection,
  subject: EqSubject,
  ports: HarnessPorts,
): Promise<void> {
  const branch = branchOf(world, selection);
  const template = world.rows.find((row) => row.key === branch);
  const pg = await eqPg(ports);
  if (selection.operation.kind === 'create') {
    await clearTarget(pg, world, built, branch);
  } else if (template !== undefined) {
    await restoreRow(pg, world, built, template, selection);
  }
  for (const { entity, id, columns } of columnsToPlace(world, built, selection, subject)) {
    const table = world.rows.find((row) => row.entity === entity)?.table;
    if (table === undefined || columns.length === 0) continue;
    const sets = columns.map((column, index) => `${column.column} = $${index + 2}`);
    const sql = `update public.${table} set ${sets.join(', ')} where id = $1`;
    try {
      await pg.query(sql, [id, ...columns.map((column) => column.value)]);
    } catch (error) {
      // 落ちた文と値を報告する —— 「置き直しが制約に当たった」だけでは、どの列に何を置こうと
      // したのかが分からず、設計図の側を直せない(実測: 状態と対の欄で 1 往復無駄にした)。
      throw new Error(
        `${selection.label}: 置き直しが落ちました: ${sql} / ${JSON.stringify(columns)} / ${String(error)}`,
      );
    }
  }
}

/**
 * 作成の前に、雛形の対象の行を**一意の宣言の範囲から外す**。
 *
 * その行を指す参照が world に無ければ消す —— いちばん確実に「同じ親に同じものが 2 つ」を
 * 避けられる。**指す参照があるときは消せない**(外部キーが必須の列なら空にもできない)ので、
 * 代わりに状態の欄を動かす —— 一意の宣言は部分一意(`where state = …`)で状態に絞られて
 * いることが多く、範囲から外れれば新しい行と並び立つ。状態の欄が無い集約では何もしない
 * (一意に当たるかどうかは DB が答え、当たれば制約違反として結末に出る)。
 */
async function clearTarget(
  pg: PgClient,
  world: EqWorld,
  built: BuiltEqWorld,
  branch: string,
): Promise<void> {
  const id = built.rows.get(branch)?.id ?? null;
  const referenced = world.rows.some((row) => Object.values(row.refs).includes(branch));
  if (!referenced) {
    await pg.query(`delete from public.${world.table} where id = $1`, [id]);
    return;
  }
  const stated = world.operations.find((operation) => operation.stateColumn !== null);
  const column = stated?.stateColumn;
  if (stated === undefined || column === undefined || column === null) return;
  const current = built.rows.get(branch)?.values[column];
  const other = stated.states.find((state) => state !== null && state !== current);
  if (other === undefined || other === null) return;
  await pg.query(`update public.${world.table} set ${column} = $1 where id = $2`, [other, id]);
}

/**
 * 対象の行を雛形の値に戻す(状態はその組み合わせのもの)。
 *
 * **状態を動かすなら、その状態が要求する欄も同じ 1 文で動かす** —— 遷移が書き留めると
 * 宣言した欄(`records_actor` / `records_time`)は状態と対で意味を持つので、状態だけを
 * 動かすと「状態 ⇔ 欄の有無」を結びつける不変条件が破れた行ができる(設計図の `records`)。
 */
async function restoreRow(
  pg: PgClient,
  world: EqWorld,
  built: BuiltEqWorld,
  template: EqWorldRow,
  selection: EqSelection,
): Promise<void> {
  const values: Record<string, unknown> = { id: built.rows.get(template.key)?.id, ...template.values };
  for (const [column, key] of Object.entries(template.refs)) values[column] = built.rows.get(key)?.id;
  const stateColumn = selection.operation.stateColumn;
  if (stateColumn !== null && selection.state !== null) {
    values[stateColumn] = selection.state;
    for (const recorded of recordedColumns(world, stateColumn, selection.state)) {
      values[recorded.column] = recordedValue(recorded, built, selection, (entity) =>
        built.rows.get(template.ancestry[entity] ?? '')?.id ?? anyRowOf(world, built, entity),
      );
    }
  }
  const columns = Object.keys(values);
  const sets = columns.filter((column) => column !== 'id').map((column) => `${column} = excluded.${column}`);
  await pg.query(
    `insert into public.${world.table} (${columns.join(', ')}) ` +
      `values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) ` +
      `on conflict (id) do update set ${sets.join(', ')}`,
    columns.map((column) => values[column]),
  );
}

/**
 * 作成が実際に作った行を消す(次の組み合わせが同じ一意の宣言に当たらないようにする)。
 *
 * @param world 集約 1 つぶんの設計図
 * @param selection 実行した組み合わせ
 * @param ports 製品が渡す口
 */
export async function clearCreated(
  world: EqWorld,
  selection: EqSelection,
  ports: HarnessPorts,
): Promise<void> {
  if (selection.operation.kind !== 'create') return;
  const pg = await eqPg(ports);
  await pg.query(`delete from public.${world.table} where id = $1`, [selection.newId]);
}
