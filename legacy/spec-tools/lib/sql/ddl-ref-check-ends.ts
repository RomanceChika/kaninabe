/**
 * **参照の欄が指す行を読む条件の相手の端**(参照される表の書き込みで条件が破れる端)の制約トリガ(fix25s)。
 *
 * 自表の行の側の執行点(本文は `ddl-ref-check-body.ts`)は、作る・付け替える行しか見ない。読む行の列が後から変わると
 * (例: 部屋が閉じる・客の確認が外れる)、既に在る自表の行が条件を破る。ここは、その端の制約トリガの**本文**を生成する。
 * どの端を立てるか(名前・発火・掴む錨の行)の計画は前段の `model/data/ref-check-shape.ts` の `refCounterpartsOf` が持つ(文書の生成器も
 * 相手の端を数えるため。読み方はその冒頭「相手の端」)。
 *
 * - 本文はコミット時に、その行を指す自表の行と、読む行の全部を結合して読み直し、条件を破る組を数え、あれば不変条件の違反の語
 *   (`check_violation`・制約名はトリガ名)で断る。文面は宣言の表示名と件数から生成する(`model/data/ref-check-refusal.ts`。
 *   「{相手の欄}を変えられません。この決まりに合わない{自表}が N 件あります({言明})」。件数だけを出し、行の中身や id は出さない)。
 *   detail は `{トリガ名}: {不変条件 ID}: {件数}`(呼び出し側の写像が不変条件 ID と件数を引く)。read committed 以外(repeatable read・serializable)は検査の前に拒否する(`ddl-isolation-guard.ts`)。
 * - 定義者の権限で実行する(RLS が効いた接続から読むと 0 行になり、素通りする)。
 *
 * 片側しか見ない形を機械で見つける覆いの判定は `ddl-ref-check-edges.ts`(ここが生成する相手の端も覆いに数える)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { counterpartDetailPrefix, counterpartRefusalOf } from '../model/data/ref-check-refusal.js';
import { refCounterpartsOf, type CounterpartAnchor, type RefCounterpart } from '../model/data/ref-check-shape.js';
import type { DataTableSpec } from '../model/data/types.js';
import { firesClause } from '../model/trigger-fires.js';
import type { SpecModel } from '../model/types.js';
import { DDL_WORDS, REF_CHECK_WORDS } from '../messages/messages-ddl.js';
import { checkExpressionOf } from './check-expression.js';
import type { DdlTrigger } from './ddl-guards.js';
import { isolationGuardLines } from './ddl-isolation-guard.js';
import { sqlLiteral } from './guard-to-sql.js';

/** 本文が自表の行に付ける別名。 */
const HOST_ALIAS = 't';

/** 全テーブルが持つ主キー列(結合の鍵)。 */
const KEY = 'id';

/** 条件を破る自表の行の数を受ける変数。 */
const COUNT_VARIABLE = 'v_count';

/** 不変条件の違反の SQLSTATE(行の側の執行点と同じ)。 */
const CHECK_ERRCODE = 'check_violation';

/** 錨の行に付ける別名。 */
const ANCHOR_ALIAS = 'v_anchor';

/**
 * 発火の最初に、この行を指す自表の行が指す**錨の行**(読む行のうち表名のバイト順で最初の表の行)を id の順に掴む文(点検 D25s2-1)。
 *
 * 相手の端どうし(部屋を閉じる取引と、客の確認を外す取引)は互いの未コミットの変更を見ないので、直列化しないと両方の検査が通る
 * (書き込みの歪み)。直列化の点を錨の行にする: 錨の表の端は、自分の更新がその行を掴んだままコミットする(掴み直さない)。ほかの表の端は
 * ここで錨の行を掴むので、錨を書き換えた取引のコミットを待ち、次の文(新しい snapshot)で読み直して断る。逆に、先に錨の行を掴んだ側が
 * いれば、錨を書き換える取引の更新がそれを待つ。
 *
 * **錨の表の端は相手の端の掴みで待たない**ので、相手の端どうしの待ち合いは輪にならない(以前の advisory lock の鍵は、錨の側の 1 回の発火が
 * 演目を id の順に掴み、他方の側が発火ごと = 書いた順に掴むので、害のない更新どうしでも輪を作った。D25s-1 → D25s2-1)。残る輪は、
 * 2 本が同じ行を書く・掴むときに表名のバイト順に逆らう(錨より後ろの表を先に書いて、コミット時に錨を待つ)形だけで、定型 RPC は錨の行を
 * 先掴みに入れる(`rpc-closure-locks.ts`)。強さは共有である(読む行は 2 つまでで、錨でない端は 1 つ。3 つ以上は錨でない端が錨を
 * 発火ごとに書いた順で排他に掴む形が輪を作るので、判定 `refCheckOf` が生成を断る。点検 D25s3-1)。
 *
 * @param end 相手の端の計画
 * @param anchor 錨と強さ
 * @returns 本文の行
 */
function anchorLines(end: RefCounterpart, anchor: CounterpartAnchor): readonly string[] {
  return [
    'perform 1',
    `from public.${end.hostTable} ${HOST_ALIAS}, public.${anchor.row.table} ${ANCHOR_ALIAS}`,
    `where ${HOST_ALIAS}.${end.row.column} = new.${KEY}`,
    `  and ${ANCHOR_ALIAS}.${KEY} = ${HOST_ALIAS}.${anchor.row.column}`,
    `order by ${ANCHOR_ALIAS}.${KEY}`,
    `for ${anchor.strength} of ${ANCHOR_ALIAS};`,
  ];
}

/**
 * plpgsql の本文(コミット時に、この行を指す自表の行と読む行の全部を結合して読み直す)。
 *
 * @param end 相手の端の計画
 * @param expression 条件の式(自表の欄は `t.`、読む行の欄は行の別名で修飾し `COALESCE(…, false)` で閉じたもの)
 * @returns 本文の行
 */
export function refCounterpartBodyOf(end: RefCounterpart, expression: string): readonly string[] {
  const from = [
    `from public.${end.hostTable} ${HOST_ALIAS}`,
    ...end.plan.rows.map((row) => `join public.${row.table} ${row.variable} on ${row.variable}.${KEY} = ${HOST_ALIAS}.${row.column}`),
  ];
  const where = `where ${HOST_ALIAS}.${end.row.column} = new.${KEY}`;
  const lock = end.anchor === null ? [] : anchorLines(end, end.anchor);
  const refusal = counterpartRefusalOf(end);
  return [
    ...isolationGuardLines(REF_CHECK_WORDS.isolationRefusal),
    ...lock,
    'declare',
    `    ${COUNT_VARIABLE} integer;`,
    'begin',
    `    select count(*) into ${COUNT_VARIABLE}`,
    ...from.map((line) => `    ${line}`),
    `    ${where} and not (${expression});`,
    `    if ${COUNT_VARIABLE} > 0 then`,
    '        raise exception using',
    `            message = ${sqlLiteral(refusal.before)} || ${COUNT_VARIABLE}::text || ${sqlLiteral(refusal.after)},`,
    `            errcode = ${sqlLiteral(CHECK_ERRCODE)},`,
    `            constraint = ${sqlLiteral(end.name)},`,
    `            detail = ${sqlLiteral(counterpartDetailPrefix(end))} || ${COUNT_VARIABLE}::text;`,
    '    end if;',
    'end;',
    'return null;',
  ];
}

/**
 * その表に立てる相手の端のトリガ(本文が生成物。`ddl-triggers.ts` が並べる)。
 *
 * @param table 相手の端の表
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns トリガの計画(式を写せない端は出さない。覆いの検査が名指す)
 */
export function refCounterpartTriggersIn(table: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): readonly DdlTrigger[] {
  return refCounterpartsOf(table, domain, tables).flatMap((end): DdlTrigger[] => {
    const written = checkExpressionOf(end.invariant.id, end.hostEntity, domain, {
      alias: HOST_ALIAS,
      related: end.plan.rows.map((row) => ({ entity: row.entity, alias: row.variable })),
      implication: true,
    });
    const clause = firesClause(end.fires);
    if (!written.ok || clause === null) return [];
    return [
      {
        name: end.name,
        ...clause,
        deferred: true,
        function: {
          name: end.name,
          comment: `${DDL_WORDS.checkTrigger}(${end.invariant.id}・相手の端)`,
          body: refCounterpartBodyOf(end, written.expression),
          securityDefiner: true,
        },
      },
    ];
  });
}
