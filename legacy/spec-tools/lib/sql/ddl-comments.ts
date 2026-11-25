/**
 * 表の DDL が出す **`comment on`**(列の説明と、制約の由来の不変条件 ID)。
 *
 * `ddl-migration.ts` が「形を作る文」を出し、ここは「形に由来を書き残す文」を出す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { guarded } from './ddl-guards.js';
import { sqlLiteral } from './guard-to-sql.js';
import type { TableDdlPlan } from './ddl-plan.js';

/**
 * 列の説明と、**由来を宣言する制約すべて**のコメント。
 *
 * `invariant` を宣言した CHECK は、この DDL が作るもの(導出 / `rule` つき)だけでなく
 * **`invariant` だけを宣言するもの**にも付ける —— 名前は宣言にあるので、条件式の正が
 * invariant_spec にあっても「どの不変条件の執行点か」は書ける(`database-guards.md` の MUST)。
 * ただしその制約は**この DDL が作らない**(手書きの migration が作る)ので、まだ無い DB でも
 * 流せるように存在を確かめてから付ける。
 *
 * @param plan その表の DDL の計画
 * @param target スキーマ修飾された表名
 * @returns SQL の行
 */
export function comments(plan: TableDdlPlan, target: string): readonly string[] {
  const checks = [...plan.derivedChecks, ...plan.declaredChecks].filter((check) => check.invariant !== null);
  return [
    ...plan.columns
      .filter((column) => column.comment !== null)
      .map((column) => `comment on column ${target}.${column.name} is ${sqlLiteral(column.comment ?? '')};`),
    ...checks.flatMap((check) =>
      check.expression === null
        ? guardedComment(check.name, check.invariant ?? '', target)
        : [constraintComment(check.name, check.invariant ?? '', target)],
    ),
    ...plan.exclusions
      .filter((exclusion) => exclusion.invariant !== null)
      .map((exclusion) => constraintComment(exclusion.name, exclusion.invariant ?? '', target)),
  ];
}

/** 制約 1 本の由来のコメント。 */
function constraintComment(name: string, invariant: string, target: string): string {
  return `comment on constraint ${name} on ${target} is ${sqlLiteral(invariant)};`;
}

/** この DDL が作らない制約のコメント(まだ無い DB でも流せるように存在を確かめる)。 */
function guardedComment(name: string, invariant: string, target: string): readonly string[] {
  return guarded(
    [
      `select 1 from pg_constraint c`,
      `where c.conrelid = '${target}'::regclass and c.conname = ${sqlLiteral(name)}`,
    ],
    [constraintComment(name, invariant, target)],
    true,
  );
}
