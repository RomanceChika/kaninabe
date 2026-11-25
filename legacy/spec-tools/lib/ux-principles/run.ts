/**
 * U8 台帳の整合(スキーマ適合は parse-ux-principles.ts、ここは**検査器の一覧との突合**)。
 *
 * 台帳が嘘をつく道は 3 つある — 存在しない検査を「見張っている」と書く / 既存の検査の行が欠けて
 * 見張られている原則が目録から消える / 数字を持つのに誰も読まない(閾値が飾りになる)。
 * どれも**目録として読めなくなる**ことなので、warning ではなく error にする(U 群の他の検査と違い、
 * ここが問うのは経験則ではなく台帳が自分の宣言と食い違っていないかという真偽である)。
 */

import type { Finding } from '../kernel/finding.js';
import { makeFinding } from '../kernel/finding.js';
import { U8_VERIFIER_ID } from '../model/ux-principles/loader.js';
import { usecaseMetricRowIds } from './limits.js';
import type { UxPrincipleDecl, UxPrinciplesModel } from '../model/ux-principles/types.js';
import { UX_PRINCIPLE_ADVISORY } from '../model/ux-principles/types.js';

/** 検査器の一覧(台帳の `enforced_by` が指せる検査 ID)。 */
export interface KnownEnforcers {
  /** U 群の検証器の ID(台帳に 1 行ずつ載っていなければならない)。 */
  readonly ux: readonly string[];
  /** 台帳の `budget` を読む U 群以外の検査(ユースケースの予算 = Y5)。 */
  readonly usecase: readonly string[];
}

/** 閾値を台帳から読む検査(`budget` が要る)。U 群は U4 / U5 だけ。 */
const BUDGET_READERS: readonly string[] = ['U4', 'U5'];

/** 台帳が閾値を持つ Y5 の検査 ID。 */
const USECASE_BUDGET_CHECK = 'Y5';

/**
 * 台帳の整合を検査する。台帳が無い(`available: false`)・構築できていない(スキーマ違反は loader が積んだ)ときは何も言わない。
 *
 * @param model 読み込み済みの台帳
 * @param known 検査器の一覧
 * @returns U8 の違反(すべて error)
 */
export function verifyUxPrinciples(model: UxPrinciplesModel, known: KnownEnforcers): Finding[] {
  const spec = model.spec;
  if (spec === null) return [];
  const real = new Set([...known.ux, ...known.usecase]);
  const findings: Finding[] = [];

  for (const principle of spec.principles) {
    findings.push(
      ...checkEnforcer(principle, real),
      ...checkBudget(principle),
      ...checkAffects(principle),
      ...checkLeftoverRow(principle),
    );
  }
  findings.push(...missingRows(spec.principles, spec.location.file, known));
  return findings;
}

/** `enforced_by` が `advisory` か実在する検査 ID であること。 */
function checkEnforcer(principle: UxPrincipleDecl, real: ReadonlySet<string>): Finding[] {
  if (principle.enforcedBy === UX_PRINCIPLE_ADVISORY || real.has(principle.enforcedBy)) return [];
  return [
    u8(principle, 'enforced_by', {
      message: `原則 ${principle.id} の enforced_by ${principle.enforcedBy} は実在する検査 ID ではありません`,
      suggestion: `実在する検査 ID(${[...real].join(' / ')})に直す。見張る検査がまだ無い原則なら ${UX_PRINCIPLE_ADVISORY} と書く`,
      counterexample: { principle: principle.id, enforced_by: principle.enforcedBy },
    }),
  ];
}

/** 閾値を読む検査の行は `budget` を持ち、読まない行(advisory)は持たない(誰も読まない数字を目録に置かない)。 */
function checkBudget(principle: UxPrincipleDecl): Finding[] {
  const readsBudget = BUDGET_READERS.includes(principle.enforcedBy) || principle.enforcedBy === USECASE_BUDGET_CHECK;
  if (readsBudget && principle.budget === undefined) {
    return [
      u8(principle, 'budget', {
        message: `原則 ${principle.id} は ${principle.enforcedBy} が閾値を台帳から読むのに budget がありません`,
        suggestion: 'budget: { limit: 正の整数 } を書く(検査器の定数は台帳が無いときの既定値にすぎない)',
        counterexample: { principle: principle.id, enforced_by: principle.enforcedBy },
      }),
    ];
  }
  if (!readsBudget && principle.budget !== undefined) {
    return [
      u8(principle, 'budget', {
        message: `原則 ${principle.id} の budget は、見張る検査(${principle.enforcedBy})が読みません`,
        suggestion: 'budget を消す。数字を持つ原則は、その数字を読む検査(U4 / U5 / Y5)が見張る行にする',
        counterexample: { principle: principle.id, enforced_by: principle.enforcedBy },
      }),
    ];
  }
  return [];
}

/** `affects: confirm_required` は、その属性を導く検査 U1 の行にだけ書く(原則が生成物の形に効く口を U1 に限る)。 */
function checkAffects(principle: UxPrincipleDecl): Finding[] {
  const isU1 = principle.enforcedBy === 'U1';
  if (isU1 && principle.affects !== 'confirm_required') {
    return [
      u8(principle, 'affects', {
        message: `原則 ${principle.id}(U1)に affects: confirm_required がありません`,
        suggestion: 'U1 は操作の確認の要否(confirm_required)に効く原則なので、affects: confirm_required を書く',
        counterexample: { principle: principle.id },
      }),
    ];
  }
  if (!isU1 && principle.affects !== undefined) {
    return [
      u8(principle, 'affects', {
        message: `原則 ${principle.id} の affects ${principle.affects} は、U1 以外の行には書けません`,
        suggestion: 'affects を消す。生成物の形に効く原則は、属性の導出と同じ式を見張る U1 の 1 行だけ',
        counterexample: { principle: principle.id, enforced_by: principle.enforcedBy },
      }),
    ];
  }
  return [];
}

/**
 * Y5 を見張る行の `id` は `Y5-{指標}`(6 指標)のどれかであること。
 *
 * Y5 は指標の名前で台帳の行を引くので、どの指標でもない `id` の行は誰にも読まれない(余り行)。
 * 余った行の `budget` は、読まれないのに閾値に見える数字になるため、未知の原則 id として error にする。
 */
function checkLeftoverRow(principle: UxPrincipleDecl): Finding[] {
  if (principle.enforcedBy !== USECASE_BUDGET_CHECK || usecaseMetricRowIds().includes(principle.id)) return [];
  return [
    u8(principle, 'id', {
      message: `原則 ${principle.id} は ${USECASE_BUDGET_CHECK} を見張る行ですが、id が指標の行(${usecaseMetricRowIds().join(' / ')})のどれでもありません`,
      suggestion: `id を指標の行に直すか、行を消す。${USECASE_BUDGET_CHECK} が台帳から引くのは ${usecaseMetricRowIds().join(' / ')} の 6 行だけ`,
      counterexample: { principle: principle.id, enforced_by: principle.enforcedBy },
    }),
  ];
}

/** U 群の検証器すべてと、Y5 の 6 指標が台帳に 1 行ずつあること。 */
function missingRows(principles: readonly UxPrincipleDecl[], file: string, known: KnownEnforcers): Finding[] {
  const findings: Finding[] = [];
  for (const check of known.ux) {
    if (principles.some((principle) => principle.enforcedBy === check)) continue;
    findings.push(missing(file, `検査 ${check} を見張る原則の行`, `enforced_by: ${check} の行を足す`, check));
  }
  if (known.usecase.includes(USECASE_BUDGET_CHECK)) {
    for (const id of usecaseMetricRowIds()) {
      if (principles.some((principle) => principle.id === id && principle.enforcedBy === USECASE_BUDGET_CHECK)) continue;
      findings.push(missing(file, `Y5 の指標の行 ${id}`, `id: ${id} / enforced_by: Y5 / budget の行を足す`, id));
    }
  }
  return findings;
}

/** 欠けた行の指摘。 */
function missing(file: string, what: string, suggestion: string, key: string): Finding {
  return makeFinding(U8_VERIFIER_ID, {
    message: `台帳に ${what}がありません`,
    location: { file, pointer: 'principles' },
    suggestion,
    counterexample: { missing: key },
  });
}

/** 行に紐づく U8 の指摘を組み立てる。 */
function u8(
  principle: UxPrincipleDecl,
  key: string,
  args: { readonly message: string; readonly suggestion: string; readonly counterexample: Record<string, string> },
): Finding {
  return makeFinding(U8_VERIFIER_ID, {
    message: args.message,
    location: { file: principle.location.file, pointer: `principles.${principle.id}.${key}` },
    suggestion: args.suggestion,
    counterexample: args.counterexample,
  });
}
