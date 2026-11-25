/**
 * **未ログインの作成の天井**を課す制約トリガの本文を、`creates[].abuse` から組み立てる(4 つ目の家族)。
 *
 * 設計: docs/design/security-audit-2026-10-18/r5-abuse-freeze.md §4-A と「B4-1b の裁定」。判定(出せるか・どの欄を数えるか)は
 * `model/data/ceiling-plan.ts` の 1 本で、ここは**計画を字面にするだけ**である(検査 R5-4 と同じ判定を呼ぶ)。
 *
 * ## 本文の順序(崩すと嘘になる)
 *
 * 1. **隔離の水準が read committed でなければ拒否する。** 取引の最初の snapshot は同時に確定した行を見ないので、表ごとの
 *    advisory lock で直列化しても、古い snapshot で数えれば先に確定した行を数え落とす。lock の後に新しい snapshot を取る
 *    read committed だけを支える(PostgREST の既定。serializable も、read committed の取引との交錯は SSI が検出しないので断る。点検 D25s-3)。
 * 2. **いまの行を読み直す。** 遅延トリガはコミット時に発火するので `new` は「その文の時点の姿」でしかない。行が無ければ何も課さない。
 * 3. **表ごとの advisory lock を取る**(数える前に)。鍵は表に 1 本で、鍵ごとの数えもこの下で行うのでデッドロックが無い。
 * 4. **期間の中の行を数える**(`{at} > now() - interval`)。自分を含めて `> max` で拒否する。**消された行は数えない**
 *    (スタッフが破棄済みを消せば枠は空く。スライドする期間であり、累計の受付の上限ではない)。
 * 5. 鍵ごとの天井があれば、読み直した行の鍵で同じ数えを行う。
 *
 * 拒否は `raise exception using message = …, errcode = 'check_violation', constraint = …`(文面は `using message` で渡す。書式文字列にしない)。
 * 隔離の拒否だけは `invalid_transaction_state` で(`ddl-isolation-guard.ts`)、トリガ名も不変条件 ID も載せない(天井の超過ではなく、環境の前提が破れている)。
 *
 * 実行は定義者の権限(`security definer`)—— RLS が効いた接続から実行されると数えが 0 件になり、天井が素通りする。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { CEILING_WORDS } from '../messages/messages-ddl.js';
import { CEILING_FIRES, ceilingPlanOf, type CeilingPlan } from '../model/data/ceiling-plan.js';
import type { DdlTrigger } from './ddl-guards.js';
import { isolationGuardLines } from './ddl-isolation-guard.js';
import { sqlLiteral } from './guard-to-sql.js';

/** 読み直す行の変数名。 */
const ROW = 'v_row';

/** `raise exception` の SQLSTATE(天井の超過 = 制約違反と同じ分類)。 */
const VIOLATION = 'check_violation';

/** 拒否の `raise exception` 文(文面は `using message` で渡す)。 */
function raise(name: string, errcode: string, text: string, indent: string): string[] {
  return [
    `${indent}raise exception using`,
    `${indent}    message = ${sqlLiteral(text)},`,
    `${indent}    errcode = ${sqlLiteral(errcode)},`,
    `${indent}    constraint = ${sqlLiteral(name)};`,
  ];
}

/** 拒否の文面の先頭(`{トリガ名}: {不変条件 ID}: `。不変条件が無ければトリガ名だけ)。 */
function prefixOf(plan: CeilingPlan): string {
  return plan.invariant === undefined ? `${plan.name}: ` : `${plan.name}: ${plan.invariant.id}: `;
}

/** 期間の中の行を数えて、天井を超えたら拒否する文(1 つ分)。 */
function countAndRefuse(plan: CeilingPlan, max: number, per: string, where: readonly string[], text: string): string[] {
  const conditions = [...where, `${plan.at} > now() - interval ${sqlLiteral(per)}`];
  return [
    'if (',
    `    select count(*) from public.${plan.table}`,
    ...conditions.map((condition, index) => `    ${index === 0 ? 'where' : '  and'} ${condition}`),
    `) > ${max} then`,
    ...raise(plan.name, VIOLATION, `${prefixOf(plan)}${text}`, '    '),
    'end if;',
  ];
}

/** 本文の中身(宣言部の `begin` と `end;` の内側)。 */
function steps(plan: CeilingPlan): readonly string[] {
  const perKey = plan.perKey;
  return [
    // 1. 隔離の水準(古い snapshot で数えれば先に確定した行を数え落とす。名前も不変条件 ID も載せない = ddl-isolation-guard.ts)。
    ...isolationGuardLines(CEILING_WORDS.isolationRefusal),
    // 2. いまの行を読み直す。
    `select * into ${ROW} from public.${plan.table} where id = new.id;`,
    'if not found then',
    '    return null;',
    'end if;',
    // 3. 表ごとの鍵(数える前に取る。txn の終わりで外れる)。
    `perform pg_advisory_xact_lock(hashtext(${sqlLiteral(plan.lockKey)}));`,
    // 4. 全体。
    ...countAndRefuse(plan, plan.global.max, plan.global.per, [], CEILING_WORDS.globalRefusal(plan.global.max, plan.global.per)),
    // 5. 鍵ごと。
    ...(perKey === undefined
      ? []
      : countAndRefuse(
          plan,
          perKey.max,
          perKey.per,
          [`${perKey.column} = ${ROW}.${perKey.column}`],
          CEILING_WORDS.perKeyRefusal(perKey.column, perKey.max, perKey.per),
        )),
    'return null;',
  ];
}

/** plpgsql の本文(変数を宣言するので、内側のブロックに包む)。 */
function bodyOf(plan: CeilingPlan): readonly string[] {
  return ['declare', `    ${ROW} public.${plan.table};`, 'begin', ...steps(plan).map((line) => `    ${line}`), 'end;'];
}

/**
 * その表の**天井の制約トリガ**の計画(宣言が無い・生成できない表では空)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns 生成するトリガ(0 本か 1 本)
 */
export function ceilingTriggersIn(table: DataTableSpec, domain: SpecModel): readonly DdlTrigger[] {
  const plan = ceilingPlanOf(table, domain);
  if (plan === null) return [];
  return [
    {
      name: plan.name,
      fires: CEILING_FIRES,
      deferred: true,
      function: {
        name: plan.name,
        comment: `${CEILING_WORDS.comment}${plan.invariant === undefined ? '' : `(${plan.invariant.id})`}`,
        body: bodyOf(plan),
        securityDefiner: true,
      },
    },
  ];
}
