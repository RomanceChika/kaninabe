/**
 * 生成器の**前提が破れたとき**の最後の砦(3 点セットを運ぶ 1 つの口)。
 *
 * 規約: scripts-code-quality.md §生成器は throw しない。前提は検査器へ。
 *
 * 生成器は「検査を通った入力しか来ない」前提で書いてよい。前提が破れたときに素の
 * `throw new Error('…')` を書くと、**仕様の問題がスタックトレースとして出る** ——
 * 「どのファイルの・何が・どう直せばよいか」が読めず、`verify` は緑のままなので
 * 「仕様は正しいのに生成器が壊れている」と読めてしまう(束 ⑱ の 4 題材が 4 件実測した)。
 *
 * そこでこのモジュールが唯一の出口になる。呼び側は**その前提を先に見るべき検査器の ID**を
 * 示し、Finding(場所・対処・反例つき)の形で止める。CLI はこれを verify と同じ字面で
 * 印字する。`lib/generate/**` に素の `throw` を書けないことは ESLint が執行する。
 *
 * **ここに来るのは仕様の問題ではなく、検査の穴である。** 前提を破る仕様が verify を通って
 * しまったということなので、示した検査器にその判定を足すのが正しい直し方になる。
 */

import type { Finding } from './finding.js';

/** 前提が破れた 1 件(Finding と同じ 3 点セット + 場所)。 */
export interface PreconditionProblem {
  readonly message: string;
  readonly suggestion: string;
  readonly counterexample: Readonly<Record<string, string>>;
  readonly location: Finding['location'];
}

/** 生成器の前提が破れたことを運ぶ例外。CLI が捕まえて Finding として印字する。 */
export class GeneratorPreconditionError extends Error {
  /** 破れた前提(severity: error の Finding)。 */
  readonly findings: readonly Finding[];

  constructor(findings: readonly Finding[]) {
    super(
      `生成器の前提が破れています(検査 ${[...new Set(findings.map((f) => f.verifier))].join(' / ')} が先に止めるはず):\n` +
        findings.map((f) => `  - ${f.message}\n    対処: ${f.suggestion}`).join('\n'),
    );
    this.name = 'GeneratorPreconditionError';
    this.findings = findings;
  }
}

/**
 * 生成を中止する。**生成器が例外を自分で作る唯一の経路**である。
 *
 * @param verifier その前提を先に見るべき検査器の ID(例: 'Y12')
 * @param problems 破れた前提(1 件以上)
 * @returns 返らない(必ず GeneratorPreconditionError を投げる)
 */
export function preconditionFailure(verifier: string, problems: readonly PreconditionProblem[]): never {
  const findings: Finding[] = problems.map((problem) => ({
    verifier,
    severity: 'error',
    message: problem.message,
    location: problem.location,
    suggestion: problem.suggestion,
    counterexample: problem.counterexample,
  }));
  throw new GeneratorPreconditionError(findings);
}
