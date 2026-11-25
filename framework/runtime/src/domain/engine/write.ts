/**
 * 編集規則の解釈（状態を変えないフィールド更新の可否判定）。
 *
 * `canCreate` / `canDelete` と対になる 3 本目。判定は**すべてここに集約**され、
 * Server Action にも operation にも `if` として書かれない（ARCH-BE-0013）。エンジンは表を持たず、
 * `access_spec` の `writes` から生成された `WriteTable` を読むだけの純粋関数である（ADR-0004）。
 *
 * 作成・削除との違いは「候補の絞り込みにフィールドが入る」ことだけである。`writes` の 1 本は
 * （ロール, フィールド集合, 条件）の組であり、同じロールでもフィールドによって条件が変わりうる。
 * そのため候補は「ロールが一致し、かつそのフィールドを含む規則」に限られる。
 */

import { evaluateGuard, unresolvedPaths } from './guard';
import type { WriteContext, WriteRejected, WriteRuleDef, WriteTable } from './types';

/** 編集が許可されたことを表す結果。 */
export interface WriteAllowed {
  readonly allowed: true;
  /** 許可の根拠になった規則のロールID（`writes[].by`）。診断・監査用。 */
  readonly by: string;
  /** 許可の根拠になった規則の副作用（`writes[].effects`）。宣言が無ければ省略。 */
  readonly effects?: readonly string[];
}

/** `canWrite` の結果。許可か、分類付きの拒否か。 */
export type WriteDecision = WriteAllowed | WriteRejected;

/** 実行者のロールで発動し、かつ対象フィールドを許している規則だけを残す。 */
function rulesFor(table: WriteTable, context: WriteContext): readonly WriteRuleDef[] {
  return table.rules.filter(
    (rule) => context.actorRoles.includes(rule.by) && rule.fields.includes(context.field),
  );
}

/** そのフィールドを編集してよいロール一覧（拒否の診断に載せる）。 */
function rolesAllowedFor(table: WriteTable, field: string): string[] {
  return table.rules.filter((rule) => rule.fields.includes(field)).map((rule) => rule.by);
}

/**
 * 実行者のロールとガードのもとで、そのフィールドを更新してよいかを判定する。
 *
 * 判定は次の順に短絡する。先に落ちた理由だけが返る（診断を1つに絞るため）。
 *
 * 1. `role_forbidden` — （ロール × フィールド）に対応する規則が 1 本も無い（deny by default）
 * 2. `guard_unsatisfied` — 対応する規則はあるが、どのガードも成立しなかった
 * 3. `guard_unknown` — ガードを評価できなかった（envの値が無い・型が食い違う）
 *
 * 「ロールが違う」と「そのフィールドは対象外」を分けないのは、どちらも `forbidden` に写るため
 * （ARCH-BE-0013 のエラー3分類）。診断には「そのフィールドを編集してよいロール」を載せる。
 *
 * @param table - 編集規則の表（生成物、またはテスト用の手書き表）
 * @param context - 対象フィールド・実行者のロール・ガード評価に使う値
 * @returns 許可なら根拠のロール、拒否なら分類と診断情報
 */
export function canWrite(table: WriteTable, context: WriteContext): WriteDecision {
  const candidates = rulesFor(table, context);
  if (candidates.length === 0) {
    return {
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: rolesAllowedFor(table, context.field),
      actorRoles: context.actorRoles,
    };
  }

  let unknown: WriteRuleDef | undefined;
  for (const rule of candidates) {
    const allowed = (): WriteAllowed =>
      rule.effects === undefined ? { allowed: true, by: rule.by } : { allowed: true, by: rule.by, effects: rule.effects };
    const guard = rule.guard;
    if (guard === undefined) return allowed();
    const result = evaluateGuard(guard, context.env);
    if (result === true) return allowed();
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
