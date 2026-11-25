import type { Client as PgClient } from 'pg';
import type { HarnessPorts } from '../harness/ports.mjs';
import type { EqValue } from '../equivalence/types.mjs';
import { eqPg } from '../equivalence/world.mjs';
import type { EqSaveWorld } from './types.mjs';
import type { BuiltEqWorld, EqSaveSelection, EqSaveSubject } from './world.mjs';
import { targetsOf } from './world.mjs';

/**
 * 保存点の一致の証明が**実行する直前に world を置き直し、実行したあとに作られた行を消す**部分
 * (束 ⑳-5a2)。world の設計図を持つ `save/world.mts` とは別に、ここは実行する直前の置き直しと
 * 実行したあとの後片付けだけを持つ。
 *
 * 接続は**テストファイル 1 本につき 1 本**である(`equivalence/world.mts` の
 * `eqPg`)—— 組み合わせごとに開き直すと、TCP と認証の往復だけが積み上がる。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * 実行する直前に world を設計図の姿に戻し、その組み合わせの値を置く(集約ごとに 1 文)。
 *
 * 1 集約 1 文なのは、日時の欄どうしの順序(行内比較の不変条件)が 1 列ずつ動かすと途中で
 * 崩れるからである。
 *
 * @param world その保存点の設計図
 * @param built 実 DB に作った world
 * @param selection 実行する組み合わせ
 * @param subject 実行する相手
 * @param ports 製品が渡す口
 */
export async function placeSaveCase(
  world: EqSaveWorld,
  built: BuiltEqWorld,
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  ports: HarnessPorts,
): Promise<void> {
  const pg = await eqPg(ports);
  const chosen = new Map<string, EqValue>();
  for (const value of selection.axis) {
    for (const placement of value.placements) {
      if (placement.into === 'row') chosen.set(`${placement.entity}.${placement.column}`, placement.value);
    }
  }
  for (const [entity, key] of Object.entries(targetsOf(world, selection.actor))) {
    const template = world.rows.find((row) => row.key === key);
    const id = subject.ids.get(entity);
    const table = world.tables[entity];
    if (template === undefined || id === undefined || table === undefined) continue;
    const restored: Record<string, EqValue> = { ...template.values };
    for (const [column, ref] of Object.entries(template.refs)) {
      restored[column] = built.rows.get(ref)?.id ?? null;
    }
    for (const [path, value] of chosen) {
      if (path.startsWith(`${entity}.`)) restored[path.slice(entity.length + 1)] = value;
    }
    const columns = Object.keys(restored);
    if (columns.length === 0) continue;
    await pg.query(
      `update public.${table} set ` +
        `${columns.map((column, index) => `${column} = $${index + 2}`).join(', ')} where id = $1`,
      [id, ...columns.map((column) => restored[column] ?? null)],
    );
  }
}

/**
 * 保存点が作った行を消して、設計図の行だけに戻す。
 *
 * 消す相手も順も**設計図が決める**(`cleanup.tables`)—— 保存点が作る集約の表だけでは足りない。
 * 手順の RPC は `also_writes` に宣言した表(副作用の台帳・監査ログ)にも書くので、そこに一意の
 * 宣言があると**2 回目の許可**が 23505 で落ち、それが「許可 + 制約違反 = 一致」として飲まれる
 * (独立レビュー ⑳-5a2 の直す 4)。設計図が置いた行は id で残す。
 *
 * 追記専用を宣言した表(`cleanup.appendOnly`)は消せないので触らない —— 飛ばしたことは設計図が
 * 報告しており、ここが黙って決めているのではない。
 *
 * @param world その保存点の設計図
 * @param built 実 DB に作った world
 * @param ports 製品が渡す口
 */
export async function clearSaveWrites(
  world: EqSaveWorld,
  built: BuiltEqWorld,
  ports: HarnessPorts,
): Promise<void> {
  const pg = await eqPg(ports);
  for (const table of world.cleanup.tables) await clearTable(pg, built, table);
}

/** その表から、設計図の行以外を消す。 */
async function clearTable(pg: PgClient, built: BuiltEqWorld, table: string): Promise<void> {
  const keep = [...built.rows.values()].filter((row) => row.table === table).map((row) => row.id);
  await pg.query(`delete from public.${table} where not (id = any($1::uuid[]))`, [keep]);
}
