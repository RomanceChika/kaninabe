/**
 * **同じ行の日時列 ± 定数の幅**で列を埋めるトリガの本文を、宣言(`triggers[].derives`)から組み立てる。
 *
 * ## なぜ本文が生成物になるのか
 *
 * 「期限の 14 日前」「開始の前日」のような**業務の慣習から決まる既定の時刻**は、同じ行の別の列を
 * 読むので列の既定値(`defaults`)に倒せず(既定値の式は他の列を読めない)、祖先の列の写しでも
 * ない。値の決め方は**元の列・幅・方式**の 3 つで言い切れるので、それを仕様が宣言し、本文は
 * 定型の 1 文として生成する。幅の数が SQL・コメント・説明書きの 3 か所に住んでいた状態が、
 * 仕様の 1 か所になる。
 *
 * 判断の記録: `docs/design/triage-derived-columns.md`(形 A)。
 *
 * **親の下の末尾の番号**(`append_within`。点検 24 回目 B24-1)も同じ家族に置く —— 「作るときに DB が決める値で、決め方が宣言から
 * 言い切れる」点が同じで、違うのは読む先(同じ行ではなく同じ親の行)だけである。画面が読み取りから「次の番号」を導いて送ると、
 * 読みが古い回に一意の索引の拒否に化ける。番号を宣言の側に移せば、どの経路(画面・保存点・データ移行の空の値)でも同じ番号になる。
 *
 * ## 方式(`mode`)は 2 つで、宣言として区別させる
 *
 * | 方式 | 本文 | 契約 |
 * |---|---|---|
 * | `initial` | `if new.{列} is null then … end if;` | **初期値**。作ったとき空なら入れる(呼び手が渡した値は尊重する) |
 * | `follow` | `new.{列} := …;`(無条件) | **導出値**。`fires` のたびに引き直す(元の列と食い違わない) |
 *
 * 2 つは別の約束なので、書く人に選ばせる(初期値のままでよいのか、元の列に追随させたいのかは
 * 仕様の決定であって生成器が決めることではない)。`follow` は `fires` が元の列の更新を含まなければ
 * 嘘になるので T15 が止める。
 *
 * ## 全部が導出のトリガだけを生成する
 *
 * 判定(`derive-problems.ts` の `derivationProblemsOf`)は生成する側と検査する側(T15 / T17)が**同じ 1 本**を呼ぶ。
 * 1 つでも問題があれば本文は出さない —— 部分的な本文は宣言の嘘を黙って通す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { AppendDerivation, DataDerivation, DataTableSpec } from '../model/data/types.js';
import { APPEND_INSERT_AT, isAppendDerivation } from '../model/data/types.js';
import { bareParent } from './derive-append-problems.js';
import { APPEND_WORDS, DDL_WORDS } from '../messages/messages-ddl.js';
import { isolationGuardLines } from './ddl-isolation-guard.js';
import type { DdlTrigger } from './ddl-guards.js';
import { deriveIntervalText, parseDeriveOffset } from './derive-offset.js';
import { derivationProblemsOf } from './derive-problems.js';
import { firesClause } from '../model/trigger-fires.js';
import { REFUSAL_CODES, REFUSAL_MESSAGE_PREFIXES } from './refusal-codes.js';
import { sqlStringLiteral } from '../kernel/safe-text.js';

/**
 * 末尾の番号が列の範囲の上端を越えたときの**拒否の語**(点検 25 回目 B25-1。ガードの拒否 `UC412` の detail)。
 *
 * 語は仕組みが決める(製品の宣言に語を書かせない)。画面の文言の閉じた表は実行時パッケージの `FRAMEWORK_REFUSAL_TEXT` が持ち、
 * 実 DB の本文が上げうる語の全部に文言があることは製品の `refusal-words-parity` が見る。
 */
export const APPEND_FULL = 'append_full';

/**
 * その表のトリガのうち、**導出の宣言から本文を生成できるもの**の計画。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns 生成するトリガ(宣言順)。1 本も無ければ空
 */
export function deriveTriggersIn(table: DataTableSpec, domain: SpecModel): readonly DdlTrigger[] {
  const planned: DdlTrigger[] = [];
  for (const trigger of table.triggers) {
    const derives = trigger.derives;
    if (derives === undefined || derivationProblemsOf(trigger, table, domain).length > 0) continue;
    const clause = firesClause(trigger.fires ?? '');
    if (clause === null) continue;
    planned.push({
      name: trigger.name,
      ...clause,
      function: {
        name: trigger.functionName,
        comment: commentOf(derives),
        body: bodyOf(derives, table, domain),
        // 末尾の番号は自表の行を数える —— RLS の効いた接続から実行されても全部の行を数えるよう、定義者の権限で実行する。
        ...(derives.some(isAppendDerivation) ? { securityDefiner: true } : {}),
      },
    });
  }
  return planned;
}

/** そのトリガ関数の説明(何を、どこから、どれだけずらして導くか / どの親の下の末尾の番号か)。 */
function commentOf(derives: readonly DataDerivation[]): string {
  const pairs = derives.map((derivation) => {
    if (isAppendDerivation(derivation)) return `${derivation.column} = max(${derivation.column}) + 1 within ${derivation.within} (${derivation.mode})`;
    const offset = parseDeriveOffset(derivation.offset);
    const shift = offset === null ? derivation.offset : `${offset.sign} ${deriveIntervalText(offset)}`;
    return `${derivation.column} = ${derivation.from} ${shift} (${derivation.mode})`;
  });
  const words = derives.some(isAppendDerivation) ? DDL_WORDS.appendTrigger : DDL_WORDS.deriveTrigger;
  return `${words}(${pairs.join(' / ')})`;
}

/** 導出の plpgsql の本文(1 列 1 文。`initial` は空のときだけ)。 */
function bodyOf(derives: readonly DataDerivation[], table: DataTableSpec, domain: SpecModel): readonly string[] {
  const lines = derives.flatMap((derivation) => {
    if (isAppendDerivation(derivation)) return appendLines(derivation, table, appendCeilingOf(derivation, table, domain));
    const offset = parseDeriveOffset(derivation.offset);
    if (offset === null) return [];
    const assign = `new.${derivation.column} := new.${derivation.from} ${offset.sign} interval '${deriveIntervalText(offset)}';`;
    return derivation.mode === 'initial'
      ? [`if new.${derivation.column} is null then`, `    ${assign}`, 'end if;']
      : [assign];
  });
  return [...lines, 'return new;'];
}

/** 末尾の番号の列の範囲の上端(entity_spec の `max`。判定が通った宣言なら必ずある)。 */
function appendCeilingOf(derivation: AppendDerivation, table: DataTableSpec, domain: SpecModel): number | undefined {
  const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
  return entity?.fields.find((field) => field.name === derivation.column)?.max;
}

/**
 * 末尾の番号の本文(点検 24 回目 B24-1)。空のときだけ、**親の行を排他で掴んでから**同じ親の最大 + 1 を入れる ——
 * 同じ親への同時の作成は親の行で 1 本ずつになり、後の 1 本はコミット済みの番号を数える(read committed の文ごとの snapshot)。
 * 掴むのは数える前の 1 回だけで、書き込む RPC は同じ行を表名の順の先掴みで既に掴んでいる(`rpc-closure-locks.ts` の `locks`)。
 *
 * **振った番号が列の範囲の上端を越えたら、閉じた語 `append_full` で断る**(点検 25 回目 B25-1)。並べ替えの口(`writes`)で最後の番号を
 * 上端にすると、次の作成は上端 + 1 を振って範囲の CHECK(23514)に当たり、想定外の失敗(「書けたか分からない」)になっていた。
 * ガードの拒否(`UC412`・`usecase_guard:`)にすると、仕組みの分類が業務の拒否として運び(落ちた操作は呼び手の計画が補う)、
 * 画面は「これ以上追加できません。並び順を見直してください」の趣旨の文言を出す。番号を「最小の空き」にする案は、末尾の意味を
 * 変えるので取らない。
 *
 * **数える前に、同じ「数える」家族の共有の拒否(`ddl-isolation-guard.ts` の `isolationGuardLines`)で read committed 以外(repeatable read・serializable)を断る**
 * (点検 25 回目 A25-2)。repeatable read の txn は親を掴んでも古い snapshot で max を数え、先にコミットされた番号と同じ番号を振る
 * (一意の索引があれば 23505 = 不変条件の違反に見え、無ければ黙って重なる)。値を入れてきた行は数えないので拒まない。
 */
function appendLines(derivation: AppendDerivation, table: DataTableSpec, ceiling: number | undefined): readonly string[] {
  const key = table.foreignKeys.find((candidate) => candidate.column === derivation.within);
  if (key === undefined || ceiling === undefined) return [];
  const { column, within } = derivation;
  const message = sqlStringLiteral(REFUSAL_MESSAGE_PREFIXES.guard);
  const tail = `(select coalesce(max(s.${column}), 0) from public.${table.table} s where s.${within} = new.${within})`;
  const refuse = `raise exception using errcode = '${REFUSAL_CODES.guard}', message = ${message}, detail = ${sqlStringLiteral(APPEND_FULL)};`;
  const head = [
    ...isolationGuardLines(APPEND_WORDS.isolationRefusal),
    `perform 1 from public.${bareParent(key.references)} p where p.id = new.${within} for update;`,
  ];
  if (derivation.mode === APPEND_INSERT_AT) return insertAtLines(derivation, table, { head, tail, refuse, ceiling });
  return [
    `if new.${column} is null then`,
    ...head.map((line) => `    ${line}`),
    `    new.${column} := (select coalesce(max(s.${column}), 0) + 1 from public.${table.table} s where s.${within} = new.${within});`,
    `    if new.${column} > ${ceiling} then`,
    `        ${refuse}`,
    '    end if;',
    'end if;',
  ];
}

/** 位置の差し込みの本文の部品(末尾に足す本文と共有する先頭・最大の式・上端の断り)。 */
interface InsertAtParts {
  /** 隔離の水準の拒否と親の排他の掴み。 */
  readonly head: readonly string[];
  /** 同じ親の下のいまの最大(行が無ければ 0)の式。 */
  readonly tail: string;
  /** 上端を越えたときの断りの 1 文。 */
  readonly refuse: string;
  /** 列の範囲の上端。 */
  readonly ceiling: number;
}

/** 位置の差し込みの本文で、ずらす行を数える整数の変数(plpgsql の整数の `for` は変数を自分で宣言する)。 */
const SHIFT_CURSOR = 'shifted';

/**
 * `mode: insert_at` の本文(fix25s)。入れてきた値を**位置**と読む —— 空か末尾 + 1 を越えるなら末尾(最大 + 1)、それ以外ならその位置以降の
 * 同じ親の行を 1 つずつ後ろにずらしてから、その位置に入れる。
 *
 * - **親の行を排他で掴んでから**数えて動かす(`initial` と同じ線)。同じ親への同時の作成・差し込みは親の行で 1 本ずつになり、後の 1 本は
 *   コミット済みの並びを数える。数える前に repeatable read を断る(同じ「数える」家族の共有の拒否)のは、値を入れてきた行も数えるので無条件。
 * - **上端**: ずらした後の最後の番号は「いまの最大 + 1」なので、それが列の範囲の上端を越えるなら、何も動かす前に `append_full` で断る
 *   (末尾に足すときと同じ条件・同じ語。並べ替えで最後を上端にした親に差し込むと、範囲の CHECK(23514)の想定外の失敗になる形を閉じる)。
 * - **ずらす順**: (親, 番号) の一意の索引は行ごとに即時に確かめられるので、1 文の `+ 1` は途中で重なりうる。**後ろの番号から 1 行ずつ**
 *   動かす(整数の `for … reverse`)。一時の負の値は範囲の CHECK(下端)に当たるので取らない。1 行は (親, 番号) の一意の索引の全部の列を
 *   1 つの値で名指すが、ループの変数の値は掴む順の読みで 1 つと言い切れないので、その前に**同じ親の行の全部を id の昇順で排他に掴む**
 *   (同じ表の複数の行を掴む順の約束。親の行を既に排他で掴んでいるので、同じ親への作成・差し込みは先に親で待つ)。
 * - 範囲の下端より小さい位置(0 以下)は丸めない —— 作成の入力の検査(entity_spec の `min`)が分かる語で断る線で、直に入れる経路は
 *   範囲の CHECK が最後に止める(並びは何も動かない。同じ文の中で取り消される)。
 */
function insertAtLines(derivation: AppendDerivation, table: DataTableSpec, parts: InsertAtParts): readonly string[] {
  const { column, within } = derivation;
  const { head, tail, refuse, ceiling } = parts;
  return [
    ...head,
    `if ${tail} + 1 > ${ceiling} then`,
    `    ${refuse}`,
    'end if;',
    `if new.${column} is null or new.${column} > ${tail} then`,
    `    new.${column} := ${tail} + 1;`,
    'else',
    `    perform 1 from public.${table.table} s where s.${within} = new.${within} order by s.id for update;`,
    `    for ${SHIFT_CURSOR} in reverse ${tail} .. new.${column} loop`,
    `        update public.${table.table} s set ${column} = ${SHIFT_CURSOR} + 1 where s.${within} = new.${within} and s.${column} = ${SHIFT_CURSOR};`,
    '    end loop;',
    'end if;',
  ];
}
