/**
 * UX 経験則の検査(U 群)の実行口。
 *
 * CLI(pipeline)はこの 1 関数だけを呼べばよく、検査が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。
 *
 * ここが担うのは検査そのものではなく、**受け入れ(画面の `ux:`)の適用**である。
 * 照合を各検証器に配らないのは、受け入れの規則が 1 つであること(画面 + 原則の ID + subject の一致)を
 * 形として保つためで、用済みの宣言を拾えるのも「全指摘を見終えた場所」がここだけだからである。
 */

import type { SpecModel } from '../model/types.js';
import { makeFinding, type Finding } from '../kernel/finding.js';
import type { ScreenSpec, ScreenSpecModel, ScreenUxAccept } from '../model/screen/types.js';
import type { UxInput, UxIssue } from '../model/ux/types.js';
import type { UxContext } from './context.js';
import { ALL_UX_VERIFIERS } from './verifiers/index.js';

/** 受け入れ宣言そのものの検査(用済み・綴り違い・重複)に使う検証器 ID。 */
export const U0_VERIFIER_ID = 'U0';

/** runUxVerification の入力。 */
export interface UxRunOptions {
  /** 構築済みのドメイン仕様モデル。 */
  readonly domain: SpecModel;
  /** 読み込み済みの screen_spec / chrome_spec(各画面の `ux:` を含む)。`available: false` なら検査しない。 */
  readonly screens: ScreenSpecModel;
  /** ガード式の共有サービス(U4 / U5 が使う)。 */
  readonly context: UxContext;
}

/** runUxVerification の結果。 */
export interface UxRunResult {
  /** 受け入れを適用したあとに残った指摘(すべて warning)+ 受け入れ宣言自体への警告。 */
  readonly findings: Finding[];
  /** specs/frontend/screens を読めたか。false なら U 群は実行していない。 */
  readonly available: boolean;
  /** 検査した画面の数(CLI のサマリ表示用)。 */
  readonly screenCount: number;
  /** 受け入れられずに残った指摘の数。 */
  readonly warningCount: number;
  /** 受け入れ宣言そのものの掃除漏れ(用済み・存在しない原則・重複)の数。 */
  readonly staleCount: number;
  /** 受け入れで消した指摘の数。 */
  readonly acceptedCount: number;
}

/**
 * UX 経験則の検査を実行し、受け入れを適用する。
 *
 * @param options ドメインモデル・画面仕様・共有サービス
 * @returns 残った指摘と、どこまで実行できたかの情報
 */
export function runUxVerification(options: UxRunOptions): UxRunResult {
  const screens = options.screens;
  if (!screens.available) {
    return {
      findings: [],
      available: false,
      screenCount: 0,
      warningCount: 0,
      staleCount: 0,
      acceptedCount: 0,
    };
  }

  const input: UxInput = { domain: options.domain, screens };
  const issues: UxIssue[] = [];
  for (const verifier of ALL_UX_VERIFIERS) issues.push(...verifier.verify(input, options.context));

  const declared = new Map(
    screens.screens.flatMap((screen) => screen.ux.map((decl) => [keyOf(screen.id, decl), decl] as const)),
  );
  const used = new Set<string>();
  const findings: Finding[] = [];
  for (const issue of issues) {
    const accepted = issue.screens.map((screenId) => keyOf(screenId, { principle: issue.check, subject: issue.subject }));
    const hit = accepted.filter((key) => declared.has(key));
    if (hit.length > 0) {
      for (const key of hit) used.add(key);
      continue;
    }
    findings.push(issue.finding);
  }
  const warningCount = findings.length;
  const hygiene = acceptanceHygiene(screens.screens, used);
  findings.push(...hygiene);

  return {
    findings,
    available: true,
    screenCount: screens.screens.length,
    warningCount,
    staleCount: hygiene.length,
    acceptedCount: issues.filter((issue) =>
      issue.screens.some((screenId) => used.has(keyOf(screenId, { principle: issue.check, subject: issue.subject }))),
    ).length,
  };
}

/** 受け入れの突合キー。画面・原則の ID・subject の 3 つが一致して初めて受け入れになる。 */
function keyOf(screenId: string, decl: Pick<ScreenUxAccept, 'principle' | 'subject'>): string {
  return `${screenId}\u0000${decl.principle}\u0000${decl.subject}`;
}

/**
 * 受け入れ宣言そのものの掃除漏れを洗い出す(U0)。
 *
 * 3 つある。**存在しない検査 ID**・**指摘が出ていないのに残っている宣言**・**重複した宣言**。
 * どれも仕様の矛盾ではなく掃除漏れなので warning にする(S10 の `unexposed` と同じ)。
 * **受け入れの一覧がそのまま「原則から意図的に外れた場所の一覧」である**ことが、この方式の価値であり、
 * 用済みや重複が混ざるとその一覧が読めなくなる(ハンドブックの「UX 原則」の章がこの一覧を載せる)。
 *
 * 1 つの宣言に対して出す指摘は最大 1 つである(重複した宣言に「用済み」まで重ねて言わない)。
 */
function acceptanceHygiene(screens: readonly ScreenSpec[], used: ReadonlySet<string>): Finding[] {
  const known = ALL_UX_VERIFIERS.map((verifier) => verifier.id);
  const findings: Finding[] = [];
  for (const screen of screens) {
    const seen = new Set<string>();
    for (const decl of screen.ux) {
      const key = keyOf(screen.id, decl);
      if (seen.has(key)) {
        findings.push(duplicated(screen, decl));
        continue;
      }
      seen.add(key);
      if (!known.includes(decl.principle)) {
        findings.push(unknownPrinciple(screen, decl, known));
        continue;
      }
      if (used.has(key)) continue;
      findings.push(stale(screen, decl));
    }
  }
  return findings;
}

/** 対象の書き方(画面そのものへの受け入れは subject を省略)。 */
function target(decl: ScreenUxAccept): string {
  return decl.subject === '' ? '(画面そのもの)' : decl.subject;
}

/** 指摘が出ていないのに残っている受け入れ。直し方は 2 つに分かれる。 */
function stale(screen: ScreenSpec, decl: ScreenUxAccept): Finding {
  return makeFinding(U0_VERIFIER_ID, {
    severity: 'warning',
    message: `画面 ${screen.name} の ux の ${decl.principle} / ${target(decl)} は、いま指摘が出ていません`,
    location: decl.location,
    suggestion:
      `画面を直して指摘が消えたのなら、${screen.relPath} の ux からこの項目を削除する。` +
      `まだ指摘が出ているつもりなら subject の綴り違いなので、` +
      `その指摘の「反例: subject=...」と見比べて直す`,
    counterexample: { screen: screen.name, principle: decl.principle, subject: decl.subject, reason: decl.reason },
  });
}

/** 存在しない検査 ID を書いた受け入れ。 */
function unknownPrinciple(screen: ScreenSpec, decl: ScreenUxAccept, known: readonly string[]): Finding {
  return makeFinding(U0_VERIFIER_ID, {
    severity: 'warning',
    message: `画面 ${screen.name} の ux に書かれた原則 ${decl.principle} は存在しません`,
    location: decl.location,
    suggestion: `実在する原則の ID(${known.join(' / ')})へ直すか、項目を削除する`,
    counterexample: { screen: screen.name, principle: decl.principle, subject: decl.subject },
  });
}

/**
 * 同じ画面に、同じ原則・同じ subject の受け入れが 2 つ以上ある。
 *
 * 受け入れは 1 つあれば効くので後続は無害に見えるが、**理由が食い違う重複は
 * 「どちらの判断が生きているか」を読めなくする**。受け入れの価値は理由の一覧にあり、
 * 二重の理由はその一覧を壊す。
 */
function duplicated(screen: ScreenSpec, decl: ScreenUxAccept): Finding {
  return makeFinding(U0_VERIFIER_ID, {
    severity: 'warning',
    message: `画面 ${screen.name} の ux に ${decl.principle} / ${target(decl)} の受け入れが重複しています`,
    location: decl.location,
    suggestion:
      `${screen.relPath} の ux で重複した項目を 1 つに畳む。` +
      `理由が食い違っているなら、どちらの判断が生きているかを決めてから残すほうを書く`,
    counterexample: { screen: screen.name, principle: decl.principle, subject: decl.subject, reason: decl.reason },
  });
}
