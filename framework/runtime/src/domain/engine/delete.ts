/**
 * 削除規則の解釈（削除可否の判定）。
 *
 * 作成の判定（`create.ts` の `canCreate`）と対になる。ロール × ガードの判定は**すべてここに集約**され、
 * Server Action にも operation にも `if` として書かれない（ARCH-BE-0013）。エンジンは表を持たず、
 * `access_spec` の `deletes` から生成された `DeleteTable` を読むだけの純粋関数である（ADR-0004）。
 *
 * 作成との違いは 1 つだけである。作成の時点では対象が存在しないためガードが参照できるのは
 * 親（例: `workshop.state`）に限られるが、削除では**対象自身の状態**（`state == draft`）も参照できる。
 * とはいえ「対象が存在するか」を判定するのはエンジンではなく呼び出し側（読み取りの結果）であり、
 * ここには遷移の `invalid_from` に当たる拒否は存在しない。
 */

import { evaluateGuard, unresolvedPaths } from './guard';
import type { DeleteContext, DeleteRejected, DeleteRuleDef, DeleteTable } from './types';

/** 削除が許可されたことを表す結果。 */
export interface DeleteAllowed {
  readonly allowed: true;
  /** 許可の根拠になった規則のロールID（`deletes[].by`）。診断・監査用。 */
  readonly by: string;
}

/** `canDelete` の結果。許可か、分類付きの拒否か。 */
export type DeleteDecision = DeleteAllowed | DeleteRejected;

/** 実行者のロールで発動しうる規則だけを残す。 */
function rulesFor(table: DeleteTable, actorRoles: readonly string[]): readonly DeleteRuleDef[] {
  return table.rules.filter((rule) => actorRoles.includes(rule.by));
}

/**
 * 実行者のロールとガードのもとで、その対象を削除してよいかを判定する。
 *
 * 判定は次の順に短絡する。先に落ちた理由だけが返る（診断を1つに絞るため）。
 *
 * 1. `role_forbidden` — 実行者のロールに対応する規則が 1 本も無い（deny by default）
 * 2. `guard_unsatisfied` — 対応する規則はあるが、どのガードも成立しなかった
 * 3. `guard_unknown` — ガードを評価できなかった（envの値が無い・型が食い違う）
 *
 * 複数の規則が実行者に対応する場合は「どれか1本でも成立すれば許可」とする（許可の和）。
 * **`'unknown'` は拒否として扱う**（安全側に倒す）。ただし `guard_unsatisfied` とは別の理由コードで
 * 返し、「仕様上の正常な拒否」と「呼び出し側がenvを組み立て損ねた事故」を区別できるようにする。
 *
 * @param table - 削除規則の表（生成物、またはテスト用の手書き表）
 * @param context - 実行者のロールとガード評価に使う値
 * @returns 許可なら根拠のロール、拒否なら分類と診断情報
 */
export function canDelete(table: DeleteTable, context: DeleteContext): DeleteDecision {
  const candidates = rulesFor(table, context.actorRoles);
  if (candidates.length === 0) {
    return {
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: table.rules.map((rule) => rule.by),
      actorRoles: context.actorRoles,
    };
  }

  let unknown: DeleteRuleDef | undefined;
  for (const rule of candidates) {
    const guard = rule.guard;
    if (guard === undefined) return { allowed: true, by: rule.by };
    const result = evaluateGuard(guard, context.env);
    if (result === true) return { allowed: true, by: rule.by };
    if (result === 'unknown' && unknown === undefined) unknown = rule;
  }

  // 評価できなかった規則が1本でもあれば、それを診断として返す（偽に潰さない）。
  if (unknown?.guard !== undefined) {
    return {
      allowed: false,
      reason: 'guard_unknown',
      guardSource: unknown.guardSource,
      unresolvedPaths: unresolvedPaths(unknown.guard, context.env),
    };
  }
  const first = candidates[0];
  return { allowed: false, reason: 'guard_unsatisfied', guardSource: first?.guardSource };
}
