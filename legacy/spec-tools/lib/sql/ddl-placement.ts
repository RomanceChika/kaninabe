/**
 * **表をまたぐものを、どの表のファイルに出すか**の判定(**連番を読まない置き場**)。
 *
 * 表の DDL は表ごとに 1 ファイルで、空の DB には番号順に当たる。だから「2 つの表が揃って
 * いないと当たらないもの」は、どちらのファイルに出すかで通るかどうかが変わる。それを
 * **連番の大小**で決めていたのが根 1(`docs/design/ddl-reissue-free-changes.md` §1)である ——
 * 再発行は番号を必ず上げるので置き場が動き、**中身が 1 バイトも変わらない隣の表のファイルを
 * 付け替える連鎖**が起きた(実測 9 本中 8 本)。
 *
 * だからいまはどちらも**関係する全部のファイルに出し、当たるかどうかは冪等ガードで決める**。
 *
 * | 何を | どこに出すか | 何度出しても平気な理由 |
 * |---|---|---|
 * | 外部キー | **両側の表のファイル**(自表と参照先) | 両方の表が在って、その列にまだ外部キーが無いときだけ張る(`ddl-migration.ts` の `addForeignKey`)|
 * | 採番の器 | **名指す全表と宣言した表**のファイル | `create sequence if not exists` は元から冪等であり、表の既定値の式より前に出る |
 *
 * 引き換えは「**黙って張らない**経路」ができることである —— 参照先の表がどのファイルにも
 * 現れなければ外部キーは静かに欠ける。安全網は宣言 ⇔ 実 DB の閉世界(`data-table-parity` の
 * 外部キーの双方向突合)であり、fixture の実行(`npm run samples:db` の 3 段目)でも実行される。
 *
 * この規則は `ddl-plan.ts`(表の形)と `framework-tables.ts`(仕組みが持つ表)の両方が読む。
 * 形の計画(1 表の形)とは別に、ここは「表をまたぐ置き場」の規則だけを持つ。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { DdlForeignKey, DdlSequence } from './ddl-plan.js';
import { nextvalNames } from './sequence-names.js';

/** ON DELETE の宣言の語 → SQL の語。 */
const ON_DELETE_SQL: Readonly<Record<string, string>> = {
  cascade: 'cascade',
  no_action: 'no action',
  restrict: 'restrict',
  set_null: 'set null',
  set_default: 'set default',
};

/**
 * その器を出すファイルの表の名前(**宣言した表 + 名指す全表**)。
 *
 * 器を名指すのは列の既定値の式であり、`regclass` は **CREATE TABLE のときに解決される** ——
 * つまり器は「それを名指すどの表よりも前」に作られていなければならない。連番で「最小の側」を
 * 選ぶとその番号に置き場が縛られるので、**名指す表すべてに出す**(`create sequence if not
 * exists` は冪等なので、何本出ても結果は 1 つである)。宣言した表にも出すのは、誰も名指して
 * いない器(宣言だけがある器)を落とさないためである。
 *
 * @param owner 器を宣言した表
 * @param name 器の名前
 * @param tables 全 data_table
 * @returns その器を出す表の名前の集合
 */
function sequenceHostsOf(
  owner: DataTableSpec,
  name: string,
  tables: readonly DataTableSpec[],
): ReadonlySet<string> {
  const hosts = new Set<string>([owner.table]);
  for (const table of tables) {
    if (table.ddlMigration === undefined) continue;
    if (nextvalNames(table).includes(name)) hosts.add(table.table);
  }
  return hosts;
}

/**
 * このファイルが出す採番の器の全数(自表が宣言したものとは限らない)。
 *
 * 宣言は 1 か所にしか書けない(同名を 2 表が宣言したら T13 が error にする)ので、`start` は
 * 宣言した表から運ぶ —— 出す場所が変わっても中身は宣言のままである。
 *
 * @param table このファイルの表
 * @param tables 全 data_table
 * @returns 器の計画(名前順で安定)
 */
export function sequencesIn(table: DataTableSpec, tables: readonly DataTableSpec[]): DdlSequence[] {
  const plans: DdlSequence[] = [];
  for (const owner of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
    if (owner.ddlMigration === undefined) continue;
    for (const sequence of owner.sequences) {
      if (!sequenceHostsOf(owner, sequence.name, tables).has(table.table)) continue;
      plans.push({ name: sequence.name, start: sequence.start ?? null });
    }
  }
  return plans.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 外部キーの制約名(**自動命名の規約**。`{表}_{列}_fkey`)。
 *
 * data_table は外部キーに名前を書かない(同一性は 列 + 参照先 + on_delete)が、DDL は
 * 名前を付けるし、不変条件が `enforced_by: db_constraint` でその名前を指すこともある。
 * 規約を 2 か所に書かないよう、名前の正はここ 1 つに置く(引く側は T16)。
 *
 * @param table 制約を張る表
 * @param column 外部キーの列
 * @returns 制約名
 */
export function foreignKeyName(table: string, column: string): string {
  return `${table}_${column}_fkey`;
}

/**
 * このファイルが出す外部キーの全数(自表のものとは限らない)。
 *
 * **両側に出す** —— 自表のファイルと、参照先の表のファイルの両方である。どちらが先に
 * 当たっても、片方は「参照先がまだ無い」で通り過ぎ、もう片方で張られる(存在ガードは
 * `ddl-migration.ts` の `addForeignKey` が書く)。番号を読まないので、表を再発行しても
 * 隣の表のファイルの中身は動かない。
 *
 * 仕組みが自分で持つ表(`framework-tables.ts`)も置き場の規則は同じなので公開している。
 *
 * @param table このファイルの表
 * @param tables 全 data_table
 * @returns 制約を張る表つきの計画(表名・列名の順で安定)
 */
export function foreignKeysIn(table: DataTableSpec, tables: readonly DataTableSpec[]): DdlForeignKey[] {
  const keys: DdlForeignKey[] = [];
  for (const source of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
    if (source.ddlMigration === undefined) continue;
    for (const fk of source.foreignKeys) {
      if (source.table !== table.table && fk.references !== table.table) continue;
      keys.push({
        name: foreignKeyName(source.table, fk.column),
        table: source.table,
        column: fk.column,
        references: fk.references,
        onDelete: ON_DELETE_SQL[fk.onDelete] ?? fk.onDelete,
      });
    }
  }
  return keys;
}
