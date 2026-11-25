/**
 * **参照の欄が指す行の列を見る条件**の、自表の行の側の BEFORE の行トリガの**本文**(fix25s)。
 *
 * 判定(どの宣言がこの形か・どの行を読むか)は前段の `model/data/ref-check-shape.ts` の `refCheckOf` が持つ(文書の生成器も相手の端を
 * 数えるため。置き場の理由はその冒頭)。ここはその計画を字面にするだけである。
 *
 * - 別の集約の行は、表名のバイト順に `for share` で読む(条件を確かめた行が、この txn の間に動かない)。同じ表で発火が重なる別の
 *   BEFORE トリガが同じ親を排他で掴むなら、最初から `for update` で読む(名前の順の格上げを作らない。強さは
 *   `model/data/check-trigger-locks.ts` の `impliedLocksOf` が決め、定型 RPC の先掴みと同じ値を読む。点検 D25s-2)。行が無い・欄が空なら
 *   式全体を `COALESCE(…, false)` で閉じて**拒否する**(行の CHECK と同じ Kleene の規約)。
 * - 式の最上段の `or` に自表の真偽の欄を定数と比べる項があれば、それが成り立つ行は読まずに通す門を先頭に置く(`plan.gate`)。
 * - 相手の端(参照される表の更新で破れる端)の本文は `ddl-ref-check-ends.ts`。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { RefCheckPlan } from '../model/data/ref-check-shape.js';
import type { LockStrength } from '../model/data/types-locks.js';

/**
 * plpgsql の本文(入れ子の `declare` の塊。行を表名の順に `for share` で読み、条件が成り立たなければ断る)。
 *
 * @param plan 生成できる計画
 * @param expression 条件の式(`COALESCE(…, false)`。自表の欄は `new.`、別の集約の欄は行の変数で修飾したもの)
 * @param refusal 断りの文(`refusalLines`)
 * @param strengths 読む行の表 → 掴む強さ(載っていない表は共有)
 * @returns 本文の行
 */
export function refCheckBodyOf(plan: RefCheckPlan, expression: string, refusal: readonly string[], strengths: Readonly<Record<string, LockStrength>> = {}): readonly string[] {
  // 自表の真偽の欄だけで条件が言い切れるなら、別の集約の行を読まずに(掴まずに)通す(門は本文の先頭。掴む順の見張りも門として読む)。
  const gate = plan.gate === null ? [] : [`if new.${plan.gate.column} <> ${String(!plan.gate.passes)} then`, '    return new;', 'end if;'];
  return [
    ...gate,
    'declare',
    ...plan.rows.map((row) => `    ${row.variable} public.${row.table};`),
    'begin',
    ...plan.rows.map((row) => `    select * into ${row.variable} from public.${row.table} r where r.id = new.${row.column} for ${strengths[row.table] === 'update' ? 'update' : 'share'};`),
    `    if not (${expression}) then`,
    ...refusal.map((line) => `    ${line}`),
    '    end if;',
    'end;',
    'return new;',
  ];
}
