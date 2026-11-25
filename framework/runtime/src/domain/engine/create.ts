/**
 * 作成規則の解釈（作成可否の判定）。
 *
 * 遷移の判定（`machine.ts` の `canFire`）と対になる。ロール × ガードの判定は**すべてここに集約**され、
 * Server Action にも operation にも `if` として書かれない（ARCH-BE-0013）。エンジンは表を持たず、
 * `access_spec` の `creates` から生成された `CreateTable` を読むだけの純粋関数である（ADR-0004）。
 *
 * 遷移との違いは 2 つだけである。
 * 1. 遷移元の状態が無いので、`invalid_from` に当たる拒否が存在しない。
 * 2. 許可に中身（from / to / effects）が無いので、`canFire` のような証明の型を持たない。
 *    生まれる行の状態は `MachineTable.initial` が決めるため、許可が運ぶべき情報がそもそも無い。
 */

import { evaluateGuard, unresolvedPaths } from './guard';
import type { CreateContext, CreateRejected, CreateRuleDef, CreateTable } from './types';

/** 作成が許可されたことを表す結果。 */
export interface CreateAllowed {
  readonly allowed: true;
  /** 許可の根拠になった規則のロールID（`creates[].by`）。診断・監査用。 */
  readonly by: string;
}

/** `canCreate` の結果。許可か、分類付きの拒否か。 */
export type CreateDecision = CreateAllowed | CreateRejected;

/** 環境で実行者の id を指す変数。 */
const ACTOR_ID = 'actor.id';

/**
 * 規則の縛り（`self`）が成り立つか。実行者の id と各変数の値が、どちらも文字列で等しいときだけ成り立つ
 * （値が無い・型が違うは不成立。縛りは「この値で作ってよい人か」の判定なので、不明を許可に倒さない）。
 */
function selfHolds(rule: CreateRuleDef, env: CreateContext['env']): boolean {
  const self = rule.self ?? [];
  if (self.length === 0) return true;
  const actor = env[ACTOR_ID];
  if (typeof actor !== 'string' || actor === '') return false;
  return self.every((variable) => env[variable] === actor);
}

/** 実行者のロール（と、規則の縛り）で発動しうる規則だけを残す。 */
function rulesFor(table: CreateTable, context: CreateContext): readonly CreateRuleDef[] {
  return table.rules.filter((rule) => context.actorRoles.includes(rule.by) && selfHolds(rule, context.env));
}

/**
 * 実行者のロールとガードのもとで、そのエンティティを作成してよいかを判定する。
 *
 * 判定は次の順に短絡する。先に落ちた理由だけが返る（診断を1つに絞るため）。
 *
 * 1. `role_forbidden` — 実行者のロールに対応する規則が 1 本も無い（deny by default）。規則の縛り（`self` =
 *    実行者の参照の欄が実行者そのものであること）が成り立たない規則も「対応しない」に数える（`by` の段の一部）
 * 2. `guard_unsatisfied` — 対応する規則はあるが、どのガードも成立しなかった
 * 3. `guard_unknown` — ガードを評価できなかった（envの値が無い・型が食い違う）
 *
 * 複数の規則が実行者に対応する場合は「どれか1本でも成立すれば許可」とする（許可の和）。
 * **`'unknown'` は拒否として扱う**（安全側に倒す）。ただし `guard_unsatisfied` とは別の理由コードで
 * 返し、「仕様上の正常な拒否」と「呼び出し側がenvを組み立て損ねた事故」を区別できるようにする。
 *
 * @param table - 作成規則の表（生成物、またはテスト用の手書き表）
 * @param context - 実行者のロールとガード評価に使う値
 * @returns 許可なら根拠のロール、拒否なら分類と診断情報
 */
export function canCreate(table: CreateTable, context: CreateContext): CreateDecision {
  const candidates = rulesFor(table, context);
  if (candidates.length === 0) {
    return {
      allowed: false,
      reason: 'role_forbidden',
      allowedRoles: table.rules.map((rule) => rule.by),
      actorRoles: context.actorRoles,
    };
  }

  let unknown: CreateRuleDef | undefined;
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
