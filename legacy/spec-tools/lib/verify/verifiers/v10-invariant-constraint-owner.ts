/**
 * V10 の 1 項 — **DB の執行点の名前から不変条件が 1 つに決まる**こと(集約をまたぐ検査)。
 *
 * `enforced_by`(`kind: db_constraint` / `trigger`)の `ref` は制約名・トリガ関数名であり、
 * 書き込み側はその名前を例外の本文から拾って `invariant_violated` に写す
 * (生成物 `app/src/domain/generated/constraint-invariants.ts` がその写像表)。したがって
 * **同じ名前を 2 つの不変条件が執行点として宣言すると、DB が拒否した理由を人に返せない**。
 *
 * 以前はこの前提を生成器(code-constraint-invariants.ts)が例外で守っていた —— `verify` は
 * 緑のまま `generate` がスタックトレースで落ちるので「仕様の問題」として読めなかった
 * (束 ⑱ の題材 D が実測。写しの列が 2 本ある集約で、1 つのトリガ関数が 2 つの不変条件を
 * 宣言した)。判定はここに移し、生成器は同じ表を素直に組み立てるだけにした。
 *
 * **判定は `constraintOwners()` の 1 本だけである**(意味解析の層 `lib/semantics/constraint-owners.ts`。
 * Y12 の `save-renderable.ts` と同じ形)。検査器は `clashes` を Finding に写し、生成器は `owner` の
 * 表を受け取って字面にするだけで、どちらも `DB_KINDS` も衝突の判定も持たない —— 片方だけに種別を
 * 足して「verify は緑のまま generate が preconditionFailure で止まる」を作れないようにするためである
 * (束 ⑲-1 のレビュー)。衝突の**文面**は共有の文言の層が 1 か所で持つ(`lib/messages/messages-owner-conflict.ts` の
 * `ownerConflictOf`。生成器も読む)。
 *
 * **集約をまたぐ**ので、集約ごとのループ(v10-invariant-enforcement.ts の `checkInvariant`)
 * ではなくモデル全体を 1 回見る形で置いてある。
 */

import type { SpecModel } from '../../model/types.js';
import { ownerConflictOf } from '../../messages/messages-owner-conflict.js';
import { constraintOwners } from '../../semantics/constraint-owners.js';
import type { Finding } from '../../kernel/finding.js';
import { finding } from './v10-invariant-index.js';

/**
 * 執行点の名前が 2 つ以上の不変条件から宣言されていないかを見る。
 *
 * @param model ドメイン仕様全体
 * @returns 違反のリスト(名前の重複 1 件ごとに 1 つ)
 */
export function checkConstraintOwners(model: SpecModel): Finding[] {
  return constraintOwners(model).clashes.map((clash) => {
    const entry = ownerConflictOf(clash);
    return finding(entry.invariant, entry.message, entry.suggestion, entry.counterexample);
  });
}
