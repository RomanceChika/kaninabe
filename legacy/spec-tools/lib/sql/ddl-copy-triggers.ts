/**
 * **祖先の列の写し**を埋めるトリガの本文を、宣言から組み立てる。
 *
 * ## なぜ本文が生成物になるのか
 *
 * `kind: trigger` の関数は `migration`(本文は生成物)を宣言できず、本文は手書きの migration の
 * 中にしか無かった。題材の製品はそれで回るが、**生成物だけで空の DB から立ち上げる系では誰も
 * 値を埋めない** —— 束 ③-2 の 1 往復で 親から写す列と貸出期限の列が NOT NULL に
 * 当たって落ちたのがその実測である。
 *
 * ただし「トリガ本文」一般を生成できるわけではない。生成できるのは**値の決め方が宣言から
 * 完全に読める**ものだけで、それが「祖先の列の写し」である ——
 * `{自集約}.{列} == {別の集約}.{列}` という不変条件が、値の出どころを言い切っている
 * (判定は `copied-columns.ts` の 1 本。world が「この列は置かない」と決めるのと同じ判定)。
 *
 * ## 全部が写しのトリガだけを生成する
 *
 * `supplies` に 1 つでも導出できない列が混じっていたら、そのトリガの本文は生成しない ——
 * 部分的に生成された本文は、残りを埋める手書きの本文と衝突する。免除リストではなく、
 * 宣言から読める構造の線である(この線そのものの実例は fixture にもホストにも今は無く、
 * 単体テストが固定している)。
 *
 * **題材の製品の 2 本が外れるのは、この線ではなく「不変条件を宣言していない」ことによる。**
 * `apply_program_item_snapshot` も `fill_workshop_reminders` も `invariant:` を持たないので
 * 解ける写しは **0 列**であり、5 列 / 2 列とも手書きの本文のままである(T15 が warning で
 * 名指す)。前者の `workshop_id` は等値そのものは別の不変条件が宣言しているが、**その宣言を
 * 宣言しているのは別のトリガ**(条件を課す側)なので、供給する側からは読めない。
 *
 * ## 代入は無条件である
 *
 * 写しのトリガは不変条件の**執行点**として宣言されている(`enforced_by: kind: trigger`)ので、
 * 「空のときだけ埋める」ではその不変条件を守れない —— 呼び手が別の値を渡せば、等値が破れた行が
 * そのまま入る。`supplied_by: db` は「渡す口が無い」の宣言でもある(V17 が作成 RPC の引数まで
 * 見る)ので、上書きされて困る値は最初から来ない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec, DataTriggerDecl } from '../model/data/types.js';
import { DDL_WORDS } from '../messages/messages-ddl.js';
import { type CopiedColumn, copiedColumnsOf } from '../world/index.js';
import type { DdlTrigger } from './ddl-guards.js';
import { triggerFires } from '../model/trigger-fires.js';

/** 写し元の行に付ける別名の前置(`a1` / `a2` …。1 段目から数える)。 */
const ALIAS_PREFIX = 'a';

/** 全テーブルが持つ主キー列(辿るときの受け手はいつもここ)。 */
const KEY = 'id';

/**
 * その表のトリガのうち、**本文を生成できるもの**の計画。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様(写しの宣言と参照の連鎖を引く)
 * @param tables 全 data_table(写し元の集約の物理テーブル名を引く)
 * @returns 生成するトリガ(宣言順)。1 本も無ければ空
 */
export function copyTriggersIn(
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): readonly DdlTrigger[] {
  const entity = table.entity;
  if (entity === undefined) return [];
  const planned: DdlTrigger[] = [];
  for (const trigger of table.triggers) {
    const copies = generatedCopiesOf(trigger, entity, domain);
    if (copies === null) continue;
    const body = bodyOf(copies, tables);
    if (body === null) continue;
    planned.push({
      name: trigger.name,
      ...triggerFires(trigger.fires ?? ''),
      function: { name: trigger.functionName, comment: commentOf(copies), body },
    });
  }
  return planned;
}

/**
 * そのトリガが供給する列が**全部**写しとして解けるか。
 *
 * @param trigger トリガの宣言
 * @param entity 自集約
 * @param domain ドメイン仕様
 * @returns 解けた写し(宣言順)。1 列でも解けない / 供給しないトリガなら null
 */
export function generatedCopiesOf(
  trigger: DataTriggerDecl,
  entity: string,
  domain: SpecModel,
): readonly CopiedColumn[] | null {
  if (trigger.supplies.length === 0 || trigger.derives !== undefined) return null;
  const copies = copiedColumnsOf(domain, entity, trigger.invariant);
  const supplied = trigger.supplies.map((column) => copies.find((copy) => copy.column === column));
  if (supplied.some((copy) => copy === undefined) || nameTheTable(trigger.fires)) return null;
  return supplied.filter((copy): copy is CopiedColumn => copy !== undefined);
}

/**
 * `fires` の宣言が表名まで書いているか(書いてあると生成が `on {表}` を二重に付ける)。
 *
 * @param fires 発火の宣言
 * @returns 表名を含むなら true
 */
export function nameTheTable(fires: string | undefined): boolean {
  return / on /i.test(fires ?? '');
}

/** そのトリガ関数の説明(何を、どこから写すか)。 */
function commentOf(copies: readonly CopiedColumn[]): string {
  const pairs = copies.map((copy) => `${copy.column} = ${copy.fromEntity}.${copy.fromColumn}`);
  return `${DDL_WORDS.copyTrigger}(${pairs.join(' / ')})`;
}

/**
 * 写しを埋める plpgsql の本文。
 *
 * 1 列につき 1 文である(写し元が違えば辿る道も違うので、束ねる意味が無い)。
 *
 * @param copies 解けた写し
 * @param tables 全 data_table(集約 → 物理テーブル名)
 * @returns 本文の行。表名が引けない集約が道に居れば null
 */
function bodyOf(copies: readonly CopiedColumn[], tables: readonly DataTableSpec[]): readonly string[] | null {
  const lines: string[] = [];
  for (const copy of copies) {
    const statement = selectInto(copy, tables);
    if (statement === null) return null;
    lines.push(...statement);
  }
  return [...lines, 'return new;'];
}

/** 写し 1 列ぶんの `select … into new.{列}`(道を join でたどる)。 */
function selectInto(copy: CopiedColumn, tables: readonly DataTableSpec[]): readonly string[] | null {
  const steps = copy.path.map((hop, index) => ({
    alias: `${ALIAS_PREFIX}${index + 1}`,
    table: tables.find((candidate) => candidate.entity === hop.entity)?.table,
    refColumn: hop.refColumn,
  }));
  if (steps.some((step) => step.table === undefined) || steps.length === 0) return null;
  const last = steps[steps.length - 1];
  const first = steps[0];
  if (last === undefined || first === undefined) return null;
  const joins = steps
    .slice(1)
    .map((step, index) => `join public.${step.table ?? ''} ${step.alias} on ${step.alias}.${KEY} = ${steps[index]?.alias ?? ''}.${step.refColumn}`);
  return [
    `select ${last.alias}.${copy.fromColumn} into new.${copy.column}`,
    `from public.${first.table ?? ''} ${first.alias}`,
    ...joins,
    `where ${first.alias}.${KEY} = new.${first.refColumn};`,
  ];
}
